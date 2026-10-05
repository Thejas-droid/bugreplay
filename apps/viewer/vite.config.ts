import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createCollector } from "./server/collector";
export default defineConfig({ plugins: [react(), { name: "bugreplay-local-inbox", configureServer(server) { server.middlewares.use(createCollector()); }, configurePreviewServer(server) { server.middlewares.use(createCollector()); } }], server: { host: "127.0.0.1", port: 5174, strictPort: true }, preview: { host: "127.0.0.1", port: 5174, strictPort: true } });
