import { getManifestItems } from "./opf";

/**
 * Concatenates every CSS file declared in the manifest into one stylesheet
 * string. The book's own styles are preserved (JP light novels rely on the
 * 電書協 template's `.vrtl` writing-mode + gaiji sizing); the reader scopes them
 * under its container rather than overriding them.
 */
export function generateStyleSheet(data, contents) {
  const cssHrefs = getManifestItems(contents)
    .filter((item) => item["@_media-type"] === "text/css")
    .map((item) => item["@_href"]);

  const unique = [...new Set(cssHrefs)];
  return unique.reduce((acc, href) => acc + (data[href] || ""), "");
}
