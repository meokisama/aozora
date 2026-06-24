import { getManifestItems, type OpfContents } from "./opf";

/**
 * Concatenates every CSS file declared in the manifest into one stylesheet
 * string. The book's own styles are preserved (JP light novels rely on the
 * 電書協 template's `.vrtl` writing-mode + gaiji sizing); the reader scopes them
 * under its container rather than overriding them.
 */
export function generateStyleSheet(data: Record<string, string | Blob>, contents: OpfContents): string {
  const cssHrefs = getManifestItems(contents)
    .filter((item) => item["@_media-type"] === "text/css")
    .map((item) => item["@_href"]);

  const unique = [...new Set(cssHrefs)];
  const combined = unique.reduce((acc, href) => acc + (data[href] || ""), "");

  // Once several sheets are concatenated and injected into the shadow root, any
  // @charset / @import that isn't at the very top is dropped by the engine with
  // a console warning ("@import rule was ignored because it wasn't defined at
  // the top of the stylesheet"). The imported targets are packaged fonts/sibling
  // CSS referenced by bare relative URLs that don't resolve here anyway, so strip
  // both rather than leave broken rules behind.
  return combined.replace(/@charset\s+["'][^"']*["']\s*;/gi, "").replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;/gi, "");
}
