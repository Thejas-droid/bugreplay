import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { createCollector } from "./collector";

const root = fileURLToPath(new URL("../dist", import.meta.url));
const collector = createCollector(process.env.BUGREPLAY_DATA_DIR || fileURLToPath(new URL("../../../.bugreplay-data", import.meta.url)));
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
createServer((req, res) => {
  void collector(req, res, () => {
    void (async () => {
      if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; res.end(); return; }
      try {
        const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost:5174").pathname);
        const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
        if (!file.startsWith(root + sep)) { res.statusCode = 403; res.end(); return; }
        const bytes = await readFile(file); res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff"); res.end(req.method === "HEAD" ? undefined : bytes);
      } catch { res.statusCode = 404; res.end("Not found"); }
    })();
  });
}).listen(5174, "127.0.0.1", () => console.log("BugReplay local dashboard: http://localhost:5174 (no cloud services)"));
