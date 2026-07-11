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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The constant prefix/suffix around the key in a dummy data-URI, sourced from
// buildDummyImage (split on its single-space placeholder) so the base64 blob is
// never duplicated here.
const [DUMMY_PREFIX, DUMMY_SUFFIX] = buildDummyImage(" ").split(" ");

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
  const keys = Object.keys(blobs);

  for (const [key, blob] of Object.entries(blobs)) {
    const typed = blob.type ? blob : new Blob([blob], { type: mimeFromKey(key) });
    const url = URL.createObjectURL(typed);
    objectUrls.push(url);
    keyToUrl.set(key, url);
  }

  // One pass for the dummy data-URIs, one for bare `aoz:<key>` refs — instead of
  // two full-string replaceAll scans per blob (2×N passes over the whole HTML).
  // Keys are matched longest-first so an alternation never stops short on a key
  // that prefixes another (e.g. `1.jpg` vs `11.jpg`).
  let html = elementHtml;
  if (keys.length) {
    const alt = keys
      .slice()
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|");
    const dummyRe = new RegExp(`${escapeRegExp(DUMMY_PREFIX)}(${alt})${escapeRegExp(DUMMY_SUFFIX)}`, "g");
    const bareRe = new RegExp(`aoz:(${alt})`, "g");
    html = html.replace(dummyRe, (m, k) => keyToUrl.get(k) ?? m).replace(bareRe, (m, k) => keyToUrl.get(k) ?? m);
  }

  return { html, objectUrls, keyToUrl };
}
