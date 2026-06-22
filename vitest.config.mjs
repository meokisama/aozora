import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vitest reuses the project's `@` alias. Default to the lightweight `node`
// environment; files that touch the DOM opt into jsdom with a
// `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.{test,spec}.{js,jsx}"],
    setupFiles: ["./test/setup.js"],
  },
});
