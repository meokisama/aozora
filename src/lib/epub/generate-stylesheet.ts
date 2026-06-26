import { getManifestItems, type OpfContents } from "./opf";

/**
 * Concatenates every manifest CSS file into one stylesheet string. The book's
 * own styles are preserved (JP light novels rely on the 電書協 template's `.vrtl`
 * writing-mode + gaiji sizing); the reader scopes rather than overrides them.
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
  return combined.replace(/@charset\s+["'][^"']*["']\s*;/gi, "").replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;/gi, "");
}
