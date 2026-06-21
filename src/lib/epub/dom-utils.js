/**
 * DOM helpers for character counting (used to weight chapters for the
 * reading-position model) and for cleaning up image references.
 */

export function isElementGaiji(el) {
  return Array.from(el.classList).some((c) => c.includes("gaiji"));
}

export function isNodeGaiji(node) {
  return node instanceof HTMLImageElement && isElementGaiji(node);
}

// A gaiji image counts as one character; everything else counts only the
// Japanese codepoints (kana, kanji, fullwidth alnum, iteration marks).
const isNotJapaneseRegex =
  /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]+/gimu;

export function getCharacterCount(node) {
  if (isNodeGaiji(node)) return 1;
  if (!node.textContent) return 0;
  return Array.from(node.textContent.replace(isNotJapaneseRegex, "")).length;
}

/** Collects text nodes (and gaiji images), skipping ruby readings + hidden nodes. */
export function getParagraphNodes(node) {
  const keep = (n) => {
    if (n.nodeName === "RT") return false;
    if (
      n instanceof HTMLElement &&
      (n.attributes.getNamedItem("aria-hidden") ||
        n.attributes.getNamedItem("hidden"))
    ) {
      return false;
    }
    return true;
  };

  const collect = (n) => {
    if (!n.hasChildNodes() || !keep(n)) return [];
    return Array.from(n.childNodes)
      .flatMap((child) => {
        if (child.nodeType === Node.TEXT_NODE) return [child];
        if (isNodeGaiji(child)) return [child];
        return collect(child);
      })
      .filter(keep);
  };

  return collect(node).filter(
    (n) => isNodeGaiji(n) || n.textContent?.replace(/\s/g, "").length
  );
}

export function countCharacters(containerEl) {
  return getParagraphNodes(containerEl).reduce(
    (sum, node) => sum + getCharacterCount(node),
    0
  );
}

/**
 * Drops image references that weren't packed into the book (bad input file /
 * unexpected extension) so they don't render as broken images.
 */
export function clearAllBadImageRef(el) {
  const clear = (tag, attr) => {
    const value = tag.getAttribute(attr);
    if (
      value &&
      !(value.startsWith("aoz:") || value.startsWith("data:image/gif;aoz:"))
    ) {
      tag.setAttribute(`data-aoz-${attr}`, value);
      tag.removeAttribute(attr);
    }
  };
  Array.from(el.getElementsByTagName("image")).forEach((t) => clear(t, "href"));
  Array.from(el.getElementsByTagName("img")).forEach((t) => clear(t, "src"));
}

/** Normalizes xlink:href (and friends) on SVG <image> elements to plain href. */
export function fixXHtmlHref(el) {
  Array.from(el.getElementsByTagName("image"))
    .filter((tag) => !tag.getAttributeNames().some((x) => x === "href"))
    .forEach((tag) => {
      const attr = Array.from(tag.attributes).find((a) => a.name.endsWith("href"));
      if (attr) tag.setAttribute("href", attr.value);
    });
}
