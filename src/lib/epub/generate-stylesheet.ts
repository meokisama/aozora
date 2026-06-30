import { getManifestItems, type OpfContents } from "./opf";

/**
 * Concatenates every manifest CSS file into one stylesheet string. The book's
 * own styles are preserved (JP light novels rely on the 電書協 template's `.vrtl`
 * writing-mode + gaiji sizing); the reader scopes rather than overrides them.
 * Exception: `line-height` is stripped so the reader's own setting governs (see
 * stripLineHeight).
 */
export function generateStyleSheet(data: Record<string, string | Blob>, contents: OpfContents): string {
  const cssHrefs = getManifestItems(contents)
    .filter((item) => item["@_media-type"] === "text/css")
    .map((item) => item["@_href"]);

  const unique = [...new Set(cssHrefs)];
  const combined = unique.reduce((acc, href) => acc + (data[href] || ""), "");

  // After concatenation, a @charset/@import not at the top is dropped by the
  // engine with a console warning. The import targets (fonts/sibling CSS via bare
  // relative URLs) don't resolve here anyway, so strip both to avoid broken rules.
  return stripLineHeight(combined.replace(/@charset\s+["'][^"']*["']\s*;/gi, "").replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;/gi, ""));
}

/**
 * Drops `line-height` declarations from the book's own CSS so the reader's
 * setting (an inherited var on `.aozora-content`) always reaches the text.
 * Otherwise a book that pins line-height on an element — notably Calibre exports
 * carrying it on the `<body>` class, preserved on `.aoz-book-body-wrapper` — wins
 * over the inherited value and the line-height control does nothing. Mirrors ttsu
 * (references/ttsu/.../format-style-sheet.ts), which strips it the same way.
 *
 * Matched as a declaration: at a `{`/`;`/whitespace boundary, then `:value` up to
 * the next `;`/`}`. The boundary char is kept so neighbouring rules survive.
 */
function stripLineHeight(css: string): string {
  return css.replace(/([{;\s])line-height\s*:[^;{}]*;?/gi, "$1");
}
