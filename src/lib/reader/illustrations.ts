/**
 * Builds the illustration gallery payload from the flattened book HTML.
 *
 * Walks the whole document once, accumulating the Japanese character count with
 * the same rules as the reading-position model (`countJapanese` for text, gaiji
 * = 1 char). Each non-gaiji image records the running count as its `charOffset`,
 * so clicking it can `jumpToChar` to the right spot in either reading mode —
 * this is derived from the parsed HTML, not the live (mode-dependent) DOM.
 */

import { countJapanese, isElementGaiji } from "@/lib/epub/dom-utils";

export interface Illustration {
  /** Image path (blob key), used as a stable React key. */
  key: string;
  /** Live object URL for the thumbnail. */
  url: string;
  /** Cumulative Japanese characters before the image — the reader's nav offset. */
  charOffset: number;
  /** The image's alt text, if any (for the tooltip/label). */
  alt: string;
}

/** Pulls the `aoz:<key>` image path out of a flattened src/href value (either a
 *  bare `aoz:path` or the dummy `data:image/gif;aoz:path;base64,…` placeholder). */
function extractKey(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/aoz:([^;]+)/);
  return match ? match[1] : null;
}

export function collectIllustrations(elementHtml: string, keyToUrl: Map<string, string>): Illustration[] {
  const doc = new DOMParser().parseFromString(elementHtml, "text/html");
  const out: Illustration[] = [];
  let chars = 0;

  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        chars += countJapanese(child.textContent);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child as Element;
      // Skip ruby readings and hidden subtrees, matching getParagraphNodes.
      if (el.nodeName === "RT") continue;
      if (el.hasAttribute("hidden") || el.hasAttribute("aria-hidden")) continue;

      const tag = el.tagName.toLowerCase();
      if (tag === "img" || tag === "image") {
        if (isElementGaiji(el)) {
          chars += 1; // inline glyph: one character, not a gallery image
          continue;
        }
        const key = extractKey(el.getAttribute("src") || el.getAttribute("href"));
        const url = key ? keyToUrl.get(key) : undefined;
        if (key && url) out.push({ key, url, charOffset: chars, alt: el.getAttribute("alt") || "" });
        continue; // images carry no countable text
      }

      walk(el);
    }
  };

  walk(doc.body);
  return out;
}
