import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({ publicDir: false, build: { outDir: "dist", emptyOutDir: false, lib: { entry: fileURLToPath(new URL("./src/content.ts", import.meta.url)), name: "BugReplayRecorder", formats: ["iife"], fileName: () => "recorder.js" }, rollupOptions: { output: { inlineDynamicImports: true } } } });
