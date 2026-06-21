import { buildDummyImage } from "./dummy-image";

const EXT_TO_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function mimeFromKey(key) {
  const ext = key.split(".").pop()?.toLowerCase();
  return EXT_TO_MIME[ext] || "image/jpeg";
}

/**
 * Swaps the dummy image placeholders in the flattened HTML for live object URLs
 * built from the stored blobs. Returns the rewritten HTML plus the created
 * object URLs so the caller can revoke them on unmount.
 *
 * @param {string} elementHtml
 * @param {Record<string, Blob>} blobs
 * @returns {{ html: string, objectUrls: string[] }}
 */
export function buildReaderHtml(elementHtml, blobs) {
  const objectUrls = [];
  let html = elementHtml;

  for (const [key, blob] of Object.entries(blobs)) {
    const typed = blob.type ? blob : new Blob([blob], { type: mimeFromKey(key) });
    const url = URL.createObjectURL(typed);
    objectUrls.push(url);
    html = html.replaceAll(buildDummyImage(key), url).replaceAll(`aoz:${key}`, url);
  }

  return { html, objectUrls };
}
