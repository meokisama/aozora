import { extractEpub } from "./extract";
import { generateHtml } from "./generate-html";
import { generateStyleSheet } from "./generate-stylesheet";
import { getPageProgressionDirection } from "./opf";

/**
 * Parses an EPUB blob into the reader payload: one flattened HTML string, the
 * book's combined stylesheet, the image blobs (keyed by path), the chapter
 * sections, and the total character count. This is the expensive step; results
 * are cached in IndexedDB by the caller.
 *
 * @param {Blob} blob
 * @returns {Promise<{ elementHtml: string, styleSheet: string,
 *   blobs: Record<string, Blob>, sections: object[], characters: number,
 *   vertical: boolean }>}
 */
export async function parseBook(blob) {
  const { contents, contentsDirectory, result } = await extractEpub(blob);
  const { element, characters, sections } = generateHtml(result, contents, contentsDirectory);
  const styleSheet = generateStyleSheet(result, contents);

  const blobs = {};
  for (const [key, value] of Object.entries(result)) {
    if (value instanceof Blob) blobs[key] = value;
  }

  const elementHtml = element.innerHTML;
  const vertical = getPageProgressionDirection(contents) === "rtl" || /\bvrtl\b/.test(elementHtml);

  return { elementHtml, styleSheet, blobs, sections, characters, vertical };
}
