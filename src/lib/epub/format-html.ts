import { buildDummyImage } from "./dummy-image";

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function mimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  return (ext && EXT_TO_MIME[ext]) || "image/jpeg";
}

/**
 * Swaps dummy image placeholders for live object URLs built from the stored
 * blobs. Returns the object URLs too so the caller can revoke them on unmount,
 * plus a key→URL map so other features (e.g. the illustration gallery) can
 * resolve an image path to its live URL without re-creating it.
 */
export function buildReaderHtml(
  elementHtml: string,
  blobs: Record<string, Blob>,
): { html: string; objectUrls: string[]; keyToUrl: Map<string, string> } {
  const objectUrls: string[] = [];
  const keyToUrl = new Map<string, string>();
  let html = elementHtml;

  for (const [key, blob] of Object.entries(blobs)) {
    const typed = blob.type ? blob : new Blob([blob], { type: mimeFromKey(key) });
    const url = URL.createObjectURL(typed);
    objectUrls.push(url);
    keyToUrl.set(key, url);
    html = html.replaceAll(buildDummyImage(key), url).replaceAll(`aoz:${key}`, url);
  }

  return { html, objectUrls, keyToUrl };
}
