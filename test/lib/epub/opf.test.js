import { describe, it, expect } from "vitest";
import {
  xmlParser,
  isOpfPrefixed,
  getManifestItems,
  getSpineItemRefs,
  getMetadata,
  getMetaKey,
  getPageProgressionDirection,
  asArray,
  firstText,
} from "@/lib/epub/opf";

// Minimal EPUB3 OPF (unprefixed <package>) with two manifest items and a spine.
const OPF_PLAIN = `<?xml version="1.0"?>
<package version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>テスト本</dc:title>
    <dc:creator>著者</dc:creator>
    <dc:language>ja</dc:language>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="ch1"/>
  </spine>
</package>`;

// Same document but with the `opf:` namespace prefix on package/manifest/etc.
const OPF_PREFIXED = `<?xml version="1.0"?>
<opf:package version="3.0" xmlns:opf="http://www.idpf.org/2007/opf">
  <opf:metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>接頭辞</dc:title>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="ch1"/>
  </opf:spine>
</opf:package>`;

const plain = xmlParser.parse(OPF_PLAIN);
const prefixed = xmlParser.parse(OPF_PREFIXED);

describe("asArray", () => {
  it("wraps a single value", () => {
    expect(asArray("x")).toEqual(["x"]);
  });
  it("passes arrays through", () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
  });
  it("returns [] for null/undefined", () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
  });
  it("does not treat 0 / empty string as nullish", () => {
    expect(asArray(0)).toEqual([0]);
    expect(asArray("")).toEqual([""]);
  });
});

describe("firstText", () => {
  it("returns the first non-empty trimmed string", () => {
    expect(firstText(["  ", "hello "])).toBe("hello");
  });
  it("reads #text from object form", () => {
    expect(firstText({ "#text": " ja ", "@_id": "x" })).toBe("ja");
  });
  it("handles mixed arrays of string + object", () => {
    expect(firstText([{ "#text": "" }, "二番目"])).toBe("二番目");
  });
  it("returns empty string when nothing matches", () => {
    expect(firstText(undefined)).toBe("");
    expect(firstText([])).toBe("");
  });
});

describe("isOpfPrefixed", () => {
  it("detects the namespaced root", () => {
    expect(isOpfPrefixed(prefixed)).toBe(true);
    expect(isOpfPrefixed(plain)).toBe(false);
  });
});

describe("getManifestItems", () => {
  it("reads items from an unprefixed package", () => {
    const items = getManifestItems(plain);
    expect(items).toHaveLength(2);
    expect(items[0]["@_id"]).toBe("ch1");
  });
  it("reads items from a prefixed package", () => {
    const items = getManifestItems(prefixed);
    expect(items).toHaveLength(1);
    expect(items[0]["@_href"]).toBe("ch1.xhtml");
  });
  it("returns [] when manifest is missing", () => {
    expect(getManifestItems({ package: {} })).toEqual([]);
  });
});

describe("getSpineItemRefs", () => {
  it("normalizes a single itemref to an array", () => {
    const refs = getSpineItemRefs(plain);
    expect(refs).toHaveLength(1);
    expect(refs[0]["@_idref"]).toBe("ch1");
  });
});

describe("getMetadata / getMetaKey", () => {
  it("returns the metadata block and meta key for plain docs", () => {
    expect(getMetaKey(plain)).toBe("meta");
    const meta = getMetadata(plain);
    expect(firstText(meta["dc:title"])).toBe("テスト本");
  });
  it("returns the opf-prefixed meta key", () => {
    expect(getMetaKey(prefixed)).toBe("opf:meta");
  });
});

describe("getPageProgressionDirection", () => {
  it("reads rtl from the spine", () => {
    expect(getPageProgressionDirection(plain)).toBe("rtl");
  });
  it("returns empty string when unset", () => {
    expect(getPageProgressionDirection(prefixed)).toBe("");
  });
});
