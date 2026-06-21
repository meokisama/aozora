import { XMLParser } from "fast-xml-parser";

/**
 * Shared helpers for reading an EPUB's OPF package document. Most EPUBs use an
 * unprefixed root (`<package>`), but some namespace it as `<opf:package>`; these
 * accessors normalize over both forms so callers don't branch everywhere.
 */
export const xmlParser = new XMLParser({ ignoreAttributes: false });

export function isOpfPrefixed(contents) {
  return contents["opf:package"] !== undefined;
}

function root(contents) {
  return isOpfPrefixed(contents)
    ? contents["opf:package"]
    : contents.package;
}

const key = (contents, base) => (isOpfPrefixed(contents) ? `opf:${base}` : base);

export function getManifestItems(contents) {
  const manifest = root(contents)[key(contents, "manifest")];
  return asArray(manifest?.[key(contents, "item")]);
}

export function getSpineItemRefs(contents) {
  const spine = root(contents)[key(contents, "spine")];
  return asArray(spine?.[key(contents, "itemref")]);
}

export function getMetadata(contents) {
  return root(contents)[key(contents, "metadata")];
}

export function getMetaKey(contents) {
  return key(contents, "meta");
}

/** Spine `page-progression-direction` ("rtl" for vertical/RTL books, else ""). */
export function getPageProgressionDirection(contents) {
  const spine = root(contents)[key(contents, "spine")];
  return spine?.["@_page-progression-direction"] || "";
}

export function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** dc:* fields may be a string, an object with `#text`, or an array of either. */
export function firstText(value) {
  for (const entry of asArray(value)) {
    if (typeof entry === "string" && entry.trim()) return entry.trim();
    if (entry && typeof entry === "object" && entry["#text"]) {
      return String(entry["#text"]).trim();
    }
  }
  return "";
}
