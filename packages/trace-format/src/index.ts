import { encode, decode } from "@msgpack/msgpack";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { z } from "zod";
import type { BugReplayTrace } from "@bugreplay/shared";

export const TRACE_LIMITS = { maxArchiveBytes: 100 * 1024 * 1024, maxEntryBytes: 25 * 1024 * 1024, maxExpandedBytes: 150 * 1024 * 1024, maxEntries: 1000, maxEvents: 100_000 };
const path = z.string().min(1).max(250).refine(p => !p.startsWith("/") && !p.includes("\\") && !p.split("/").includes(".."), "Unsafe archive path");
const dimension = z.number().int().min(0).max(100_000);
const environmentSchema = z.object({ userAgent: z.string().max(4000), browser: z.string().optional(), browserVersion: z.string().optional(), os: z.string().optional(), viewport: z.object({ width: dimension, height: dimension }), screen: z.object({ width: dimension, height: dimension }), devicePixelRatio: z.number().finite().min(0).max(100), language: z.string(), timezone: z.string(), colorScheme: z.string(), reducedMotion: z.boolean(), online: z.boolean(), hardwareConcurrency: dimension.optional() });
const count = z.number().int().min(0).max(1_000_000_000);
const privacySchema = z.object({ inputValues: count, headers: count, queryParams: count, jsonValues: count, domTextNodes: count, tokenStrings: count, total: z.number().int().nonnegative() });
const manifestSchema = z.object({ traceVersion: z.literal("1.0"), sessionId: z.string().max(250), project: z.string().min(1).max(250), startedAt: z.string().datetime(), durationMs: z.number().finite().nonnegative(), eventCount: z.number().int().min(0).max(TRACE_LIMITS.maxEvents + 1), replayConfidence: z.enum(["high", "medium", "low", "unsupported"]), incomplete: z.boolean().optional(), marker: z.object({ timestamp: z.number().finite().nonnegative(), description: z.string().max(2000).optional() }).optional(), files: z.object({ events: path, environment: path, privacy: path, network: path.optional(), snapshots: z.array(path).max(500).optional(), screenshots: z.array(path).max(200).optional() }) });
const targetSchema = z.object({ selector: z.string().optional(), fallbackSelector: z.string().optional(), bugReplayId: z.string().optional(), testId: z.string().optional(), id: z.string().optional(), role: z.string().optional(), name: z.string().optional(), tag: z.string().optional(), textHint: z.string().optional() }).passthrough();
const eventSchema = z.object({ id: z.string().min(1).max(250), type: z.string().regex(/^(interaction|navigation|console|error|network|performance|dom|storage|application|environment|recorder)\.[\w-]+$/), timestamp: z.number().finite().nonnegative(), sequence: z.number().int().nonnegative(), severity: z.enum(["info", "warning", "error"]).optional(), target: targetSchema.optional(), message: z.string().optional(), url: z.string().optional(), to: z.string().optional(), name: z.string().optional(), snapshotId: z.string().optional(), html: z.string().optional(), durationMs: z.number().finite().nonnegative().optional(), redacted: z.boolean().optional(), stack: z.string().optional(), method: z.string().optional(), requestId: z.string().optional(), status: z.number().int().min(0).max(599).optional(), requestHeaders: z.record(z.string()).optional(), responseHeaders: z.record(z.string()).optional(), key: z.string().optional() }).passthrough().superRefine((event, context) => {
  const requireString = (key: string) => { if (typeof event[key] !== "string") context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Missing ${key}` }); };
  if (event.type.startsWith("network.")) { requireString("url"); requireString("method"); requireString("requestId"); }
  if (event.type.startsWith("navigation.")) requireString("to");
  if (event.type.startsWith("error.") || event.type.startsWith("console.")) requireString("message");
});
function validateShape(value: unknown) {
  const queue: { value: unknown; depth: number }[] = [{ value, depth: 0 }]; let count = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (++count > 2_000_000 || item.depth > 24) throw new Error("TRACE_INVALID: data is too complex");
    if (item.value && typeof item.value === "object") {
      for (const [key, child] of Object.entries(item.value)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("TRACE_INVALID: unsafe property");
        queue.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
}
export function encodeTrace(trace: BugReplayTrace): Uint8Array {
  const manifest = manifestSchema.parse({ ...trace.manifest, eventCount: trace.events.length });
  const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)), [manifest.files.events]: encode(trace.events), [manifest.files.environment]: strToU8(JSON.stringify(trace.environment)), [manifest.files.privacy]: strToU8(JSON.stringify(trace.privacy)) };
  for (const [id, html] of Object.entries(trace.snapshots ?? {})) { path.parse(`snapshots/${id}.html`); files[`snapshots/${id}.html`] = strToU8(html); }
  for (const [name, bytes] of Object.entries(trace.screenshots ?? {})) { path.parse(`screenshots/${name}`); files[`screenshots/${name}`] = bytes; }
  let expanded = 0;
  for (const bytes of Object.values(files)) { expanded += bytes.length; if (bytes.length > TRACE_LIMITS.maxEntryBytes) throw new Error("TRACE_SIZE_LIMIT"); }
  if (expanded > TRACE_LIMITS.maxExpandedBytes || Object.keys(files).length > TRACE_LIMITS.maxEntries) throw new Error("TRACE_SIZE_LIMIT");
  const result = zipSync(files, { level: 6 }); if (result.length > TRACE_LIMITS.maxArchiveBytes) throw new Error("TRACE_SIZE_LIMIT"); return result;
}
export function decodeTrace(bytes: Uint8Array): BugReplayTrace {
  if (bytes.length > TRACE_LIMITS.maxArchiveBytes) throw new Error("TRACE_SIZE_LIMIT: choose a file smaller than 100 MB");
  try {
    let expanded = 0, entries = 0;
    const files = unzipSync(bytes, { filter: file => {
      path.parse(file.name); expanded += file.originalSize; entries++;
      if (file.originalSize > TRACE_LIMITS.maxEntryBytes || expanded > TRACE_LIMITS.maxExpandedBytes || entries > TRACE_LIMITS.maxEntries) throw new Error("TRACE_SIZE_LIMIT: expanded archive exceeds the supported limit");
      return true;
    } });
    const json = (name: string) => { if (!files[name]) throw new Error(`TRACE_INVALID: ${name} is missing`); const data = JSON.parse(strFromU8(files[name]!)); validateShape(data); return data; };
    const rawManifest = json("manifest.json");
    if (rawManifest.traceVersion !== "1.0") throw new Error("TRACE_VERSION_UNSUPPORTED: this viewer supports version 1.0");
    const manifest = manifestSchema.parse(rawManifest);
    if (!files[manifest.files.events]) throw new Error("TRACE_INVALID: events are missing");
    const decoded = decode(files[manifest.files.events]!, { maxStrLength: TRACE_LIMITS.maxEntryBytes, maxBinLength: TRACE_LIMITS.maxEntryBytes, maxArrayLength: TRACE_LIMITS.maxEvents + 1, maxMapLength: 1000 });
    validateShape(decoded);
    const events = z.array(eventSchema).max(TRACE_LIMITS.maxEvents + 1).parse(decoded).sort((a, b) => a.sequence - b.sequence);
    const snapshots: Record<string, string> = Object.create(null), screenshots: Record<string, Uint8Array> = Object.create(null);
    for (const name of Object.keys(files)) {
      if (name.startsWith("snapshots/") && name.endsWith(".html")) snapshots[name.slice(10, -5)] = strFromU8(files[name]!);
      if (/^screenshots\/[\w.-]+\.(png|jpe?g|webp)$/i.test(name)) screenshots[name.slice(12)] = files[name]!;
    }
    return { manifest: { ...manifest, eventCount: events.length }, events, environment: environmentSchema.parse(json(manifest.files.environment)), privacy: privacySchema.parse(json(manifest.files.privacy)), snapshots, screenshots } as BugReplayTrace;
  } catch (error) {
    if (error instanceof Error && /^TRACE_/.test(error.message)) throw error;
    throw new Error("TRACE_INVALID: this file is damaged or does not contain a supported BugReplay recording");
  }
}
export function downloadTrace(bytes: Uint8Array, name = "trace.bugreplay") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.bugreplay+zip" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
