import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
/** Local fixtures make the demo independent of external services. */
function fixtureApi(): Plugin {
  const middleware: import("vite").Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return next();
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/timeout") { const timer = setTimeout(() => { if (!res.destroyed) res.end('{"ok":true}'); }, 3000); res.on("close", () => clearTimeout(timer)); return; }
    if (url.pathname === "/api/order") { res.statusCode = 500; res.end('{"error":"Order service unavailable","retryable":true}'); return; }
    if (url.pathname === "/api/coupon") {
      let body = ""; req.on("data", chunk => { body += String(chunk); if (body.length > 64000) req.destroy(); });
      req.on("end", () => { let coupon = ""; try { coupon = JSON.parse(body).coupon ?? ""; } catch {} const delay = url.searchParams.get("delay") === "1500" ? 1500 : 120; const timer = setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ coupon, discount: coupon === "SAVE20" ? 9.6 : coupon === "SLOW" ? 2 : 0 })); }, delay); res.on("close", () => clearTimeout(timer)); }); return;
    }
    res.statusCode = 404; res.end('{"error":"Unknown fixture endpoint"}');
  };
  return { name: "bugreplay-fixture-api", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
export default defineConfig({ plugins: [react(), fixtureApi()], server: { port: 5173, strictPort: true }, preview: { port: 5173, strictPort: true } });
