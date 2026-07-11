/** DOM helpers for character counting (weights chapters for the reading-position
 *  model) and for cleaning up image references. */

export function isElementGaiji(el: Element): boolean {
  return Array.from(el.classList).some((c) => c.includes("gaiji"));
}

export function isNodeGaiji(node: Node): node is HTMLImageElement {
  return node instanceof HTMLImageElement && isElementGaiji(node);
}

// Inline wrappers a glyph image may sit inside while still being "inline with text".
const INLINE_WRAPPERS = new Set(["SPAN", "A", "B", "I", "EM", "STRONG", "SUP", "SUB", "SMALL", "U", "RB", "RUBY"]);

function hasTextSibling(el: Element): boolean {
  const parent = el.parentElement;
  if (!parent) return false;
  return Array.from(parent.childNodes).some((n) => n !== el && n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim());
}

/** A glyph image (gaiji) sits inline among text: used as a ruby base, or sharing
 *  its line with a text sibling (climbing out through inline wrappers). A block's
 *  lone standalone image is an illustration, not a glyph. */
function isInlineGlyphImage(img: Element): boolean {
  let el: Element = img;
  while (el.parentElement) {
    const parent = el.parentElement;
    if (parent.tagName === "RUBY" || parent.tagName === "RB") return true;
    if (hasTextSibling(el)) return true;
    if (!INLINE_WRAPPERS.has(parent.tagName)) break; // reached a block — stop climbing
    el = parent;
  }
  return false;
}

/**
 * Tags context-detected gaiji with `aoz-gaiji`. Calibre/KFX give gaiji arbitrary
 * class names (`class_s8x`, sized by book CSS), so `isElementGaiji` misses them and
 * the illustration cap blows them up + pollutes the gallery. The marker makes every
 * consumer correct at once: the reader's `img:not([class*="gaiji"])` rule skips them,
 * the gallery excludes them, they count as one character. Mirrors bibi, which never
 * overrides inline image sizing.
 */
export function tagGaijiImages(root: Element): void {
  for (const img of Array.from(root.querySelectorAll("img,image"))) {
    if (isElementGaiji(img)) continue; // already class-tagged
    if (isInlineGlyphImage(img)) img.classList.add("aoz-gaiji");
  }
}

// A gaiji image counts as one character; everything else counts only the
// Japanese codepoints (kana, kanji, fullwidth alnum, iteration marks).
const isNotJapaneseRegex = /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]+/gimu;

/** Counts Japanese codepoints, matching the reading-position model so a substring
 *  offset lines up with the offsets the reader navigates by. */
export function countJapanese(str: string | null | undefined): number {
  if (!str) return 0;
  return Array.from(str.replace(isNotJapaneseRegex, "")).length;
}

export function getCharacterCount(node: Node): number {
  if (isNodeGaiji(node)) return 1;
  return countJapanese(node.textContent);
}

/** Collects text nodes (and gaiji images), skipping ruby readings + hidden nodes. */
export function getParagraphNodes(node: Node): Node[] {
  const keep = (n: Node): boolean => {
    if (n.nodeName === "RT") return false;
    if (n instanceof HTMLElement && (n.attributes.getNamedItem("aria-hidden") || n.attributes.getNamedItem("hidden"))) {
      return false;
    }
    return true;
  };

  const collect = (n: Node): Node[] => {
    if (!n.hasChildNodes() || !keep(n)) return [];
    return Array.from(n.childNodes)
      .flatMap((child) => {
        if (child.nodeType === Node.TEXT_NODE) return [child];
        if (isNodeGaiji(child)) return [child];
        return collect(child);
      })
      .filter(keep);
  };

  return collect(node).filter((n) => isNodeGaiji(n) || n.textContent?.replace(/\s/g, "").length);
}

export function countCharacters(containerEl: Node): number {
  return getParagraphNodes(containerEl).reduce((sum, node) => sum + getCharacterCount(node), 0);
}

/** Drops image references not packed into the book so they don't render broken. */
export function clearAllBadImageRef(el: Element): void {
  const clear = (tag: Element, attr: string) => {
    const value = tag.getAttribute(attr);
    if (value && !(value.startsWith("aoz:") || value.startsWith("data:image/gif;aoz:"))) {
      tag.setAttribute(`data-aoz-${attr}`, value);
      tag.removeAttribute(attr);
    }
  };
  Array.from(el.getElementsByTagName("image")).forEach((t) => clear(t, "href"));
  Array.from(el.getElementsByTagName("img")).forEach((t) => clear(t, "src"));
}

/** Normalizes xlink:href (and friends) on SVG <image> elements to plain href. */
export function fixXHtmlHref(el: Element): void {
  Array.from(el.getElementsByTagName("image"))
    .filter((tag) => !tag.getAttributeNames().some((x) => x === "href"))
    .forEach((tag) => {
      const attr = Array.from(tag.attributes).find((a) => a.name.endsWith("href"));
      if (attr) tag.setAttribute("href", attr.value);
    });
}
