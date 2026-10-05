import { defineConfig } from "vite";
export default defineConfig({ build: { ssr: "server/start.ts", outDir: "server-dist", rollupOptions: { output: { entryFileNames: "server.js" } } }, ssr: { noExternal: true } });
