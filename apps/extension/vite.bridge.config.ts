import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({ publicDir: false, build: { outDir: "dist", emptyOutDir: false, lib: { entry: fileURLToPath(new URL("./src/bridge.ts", import.meta.url)), formats: ["iife"], name: "BugReplayBridge", fileName: () => "bridge.js" }, rollupOptions: { output: { inlineDynamicImports: true } } } });
