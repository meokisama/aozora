import { vi } from "vitest";

// jsdom (and node) don't implement Blob URL helpers. format-html.js relies on
// URL.createObjectURL to swap dummy-image placeholders for live URLs, so stub
// it with a deterministic counter usable from any environment.
if (typeof URL !== "undefined" && typeof URL.createObjectURL !== "function") {
  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock/${counter++}`);
  URL.revokeObjectURL = vi.fn();
}
