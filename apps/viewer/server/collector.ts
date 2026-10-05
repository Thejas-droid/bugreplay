import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { decodeTrace } from "@bugreplay/trace-format";

const MAX_BYTES = 15_000_000;
const MAX_RECORDINGS = 200;
const MAX_DISK_BYTES = 500_000_000;
export function createCollector(directory = resolve(process.env.BUGREPLAY_DATA_DIR || "../../.bugreplay-data")) {
  let serial = Promise.resolve();
  const metadata = new Map<string, { mtime: number; value: unknown }>();
  const ready = (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "pairing-token");
    try { return (await readFile(path, "utf8")).trim(); }
    catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      const token = randomBytes(32).toString("hex");
      await writeFile(path, token, { mode: 0o600, flag: "wx" }); return token;
    }
  })();
  const entries = async () => {
    const names = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.bugreplay$/.test(name));
    return (await Promise.all(names.map(async name => { const info = await stat(join(directory, name)); return { name, size: info.size, mtimeMs: info.mtimeMs }; }))).sort((a, b) => b.mtimeMs - a.mtimeMs);
  };
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/local")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const json = (status: number, value: unknown) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    // Reject DNS rebinding, hostile browser origins, and cross-origin dashboard reads.
    if (!/^(localhost|127\.0\.0\.1):5174$/.test(req.headers.host || "")) return json(403, { error: "Local access only" });
    const origin = req.headers.origin;
    const localOrigin = origin === "http://localhost:5174" || origin === "http://127.0.0.1:5174";
    const extensionOrigin = typeof origin === "string" && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    if (origin && !localOrigin && !extensionOrigin) return json(403, { error: "Origin rejected" });
    const dashboard = req.headers["x-bugreplay-local"] === "1" && (!origin || localOrigin) && !extensionOrigin;
    const path = new URL(req.url, "http://localhost:5174").pathname;
    try {
      const token = await ready;
      if (path === "/api/local" && req.method === "GET" && dashboard) return json(200, { token, maxRecordings: MAX_RECORDINGS, maxDiskBytes: MAX_DISK_BYTES });
      const provided = String(req.headers.authorization || "").replace(/^Bearer /, "");
      const authorized = Buffer.byteLength(provided) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(provided), Buffer.from(token));
      if (!dashboard && !authorized) return json(401, { error: "Pair this extension with the local dashboard first" });
      if (path === "/api/local/incidents" && req.method === "POST") {
        if (!authorized) return json(401, { error: "Pairing token required" });
        if (req.headers["content-type"] !== "application/vnd.bugreplay+zip") return json(415, { error: "Expected a BugReplay archive" });
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { size += chunk.length; if (size > MAX_BYTES) { json(413, { error: "Incident exceeds 15 MB" }); req.resume(); return; } chunks.push(Buffer.from(chunk)); }
        const bytes = Buffer.concat(chunks); const trace = decodeTrace(bytes);
        const id = createHash("sha256").update(trace.manifest.sessionId).digest("hex");
        // Serialize disk mutations and deduplicate retries even after a process restart.
        const operation = serial.then(async () => {
          const target = join(directory, `${id}.bugreplay`);
          try { await stat(target); return; } catch (error: any) { if (error.code !== "ENOENT") throw error; }
          const temporary = `${target}.tmp`;
          await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, target);
          const rows = await entries(); let total = rows.reduce((sum, row) => sum + row.size, 0);
          for (let i = rows.length - 1; i >= 0 && (i >= MAX_RECORDINGS || total > MAX_DISK_BYTES); i--) { const row = rows[i]!; await unlink(join(directory, row.name)); metadata.delete(row.name); total -= row.size; }
        });
        serial = operation.catch(() => {}); await operation;
        return json(201, { id });
      }
      if (path === "/api/local/incidents" && req.method === "GET") {
        await serial;
        const rows = await entries(); const incidents = [];
        for (const row of rows) {
          try {
            const cached = metadata.get(row.name);
            if (cached?.mtime === row.mtimeMs) { incidents.push(cached.value); continue; }
            const trace = decodeTrace(await readFile(join(directory, row.name)));
            const problem = trace.events.find((event: any) => event.severity === "error") as any;
            const value = { id: row.name.slice(0, -10), project: trace.manifest.project, title: trace.manifest.marker?.description || problem?.message || problem?.error || "Automatically captured incident", receivedAt: new Date(row.mtimeMs).toISOString(), events: trace.events.length, size: row.size, screenshot: !!Object.keys(trace.screenshots || {}).length };
            metadata.set(row.name, { mtime: row.mtimeMs, value }); incidents.push(value);
          } catch { /* A damaged recording must not prevent access to other incidents. */ }
        }
        return json(200, incidents);
      }
      const match = /^\/api\/local\/incidents\/([a-f0-9]{64})$/.exec(path);
      if (match && (req.method === "GET" || req.method === "DELETE")) {
        const file = join(directory, `${match[1]}.bugreplay`);
        if (req.method === "DELETE") {
          const operation = serial.then(async () => { await unlink(file); metadata.delete(`${match[1]}.bugreplay`); }); serial = operation.catch(() => {}); await operation;
          return json(200, { deleted: true });
        }
        await serial;
        const bytes = await readFile(file); res.setHeader("Content-Type", "application/vnd.bugreplay+zip"); res.end(bytes); return;
      }
      return json(404, { error: "Endpoint not found" });
    } catch (error: any) { return json(error.code === "ENOENT" ? 404 : /^TRACE_/.test(error.message) ? 400 : 500, { error: /^TRACE_/.test(error.message) ? error.message : "Local storage request failed" }); }
  };
}
