import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Second line behind `lib/epub/sanitize.ts`: markup that slips through still
 * can't reach the network — no remote script, no `@import`, no tracking pixel.
 *
 * `file:` rides along with `'self'` because the packaged app loads over `file://`,
 * where `'self'` doesn't reliably match an opaque origin. `'unsafe-inline'` is for
 * styles only (shadow-root `<style>`, React style attrs), never scripts.
 */
const CSP = [
  "default-src 'self' file:",
  "script-src 'self' file:",
  "style-src 'self' file: 'unsafe-inline'",
  "img-src 'self' file: data: blob:",
  "font-src 'self' file: data: blob:",
  "media-src 'self' file: data: blob:",
  "connect-src 'self' file: data: blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * Injects the CSP into the built index.html. Build-only: the dev server needs
 * inline scripts and an HMR websocket.
 *
 * Anchored to the charset tag by hand rather than `injectTo`, because both are
 * positional: a meta CSP governs only what follows it (so it must precede every
 * script/stylesheet), and charset must stay in the first 1024 bytes.
 */
const csp = (): Plugin => ({
  name: "aozora-csp",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: (html) => {
      const charset = /<meta\s+charset=[^>]*>/i;
      if (!charset.test(html)) throw new Error("aozora-csp: no <meta charset> to anchor the policy to");
      return html.replace(charset, (tag) => `${tag}\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
    },
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), csp()],
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src"),
    },
  },
});
