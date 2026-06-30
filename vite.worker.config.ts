import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

// Build config for the dictionary-import utility process. A plain Node bundle
// (no React/Tailwind); better-sqlite3 stays external (native, unpacked from the
// asar at runtime), everything else (zip.js, parse/insert) is bundled.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src"),
    },
  },
  build: {
    rollupOptions: {
      external: ["better-sqlite3"],
      output: {
        format: "cjs",
      },
    },
  },
});
