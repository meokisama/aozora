import { describe, it, expect } from "vitest";
import {
  xmlParser,
  isOpfPrefixed,
  getManifestItems,
  getSpineItemRefs,
  getMetadata,
  getMetaKey,
  getPageProgressionDirection,
  getRenditionProperty,
  getMetaContentByName,
  getRenditionLayout,
  isFixedLayout,
  getBookViewport,
  parsePageSpread,
  parseItemLayout,
  getSpinePageSpreads,
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
    expect(firstText(meta!["dc:title"])).toBe("テスト本");
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

describe("parsePageSpread", () => {
  it("reads the bare form", () => {
    expect(parsePageSpread("page-spread-left")).toBe("left");
    expect(parsePageSpread("page-spread-right")).toBe("right");
    expect(parsePageSpread("page-spread-center")).toBe("center");
  });
  it("reads the rendition-prefixed form among other tokens", () => {
    expect(parsePageSpread("svg rendition:page-spread-center")).toBe("center");
  });
  it("returns null when absent", () => {
    expect(parsePageSpread("svg")).toBeNull();
    expect(parsePageSpread(undefined)).toBeNull();
  });
});

// Fixed-layout (pre-paginated, fixed-layout-jp template) book: image pages
// wrapped in XHTML+SVG, cover (center) then right/left pairs.
const FIXED_OPF = `<?xml version="1.0"?>
<package version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/# fixed-layout-jp: http://www.digital-comic.jp/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>固定レイアウト</dc:title>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">landscape</meta>
    <meta name="original-resolution" content="1303x2048"/>
    <meta property="fixed-layout-jp:viewport">width=1303, height=2048</meta>
  </metadata>
  <manifest>
    <item id="p-000a" href="xhtml/p-000a.xhtml" media-type="application/xhtml+xml" properties="svg"/>
    <item id="p-000b" href="xhtml/p-000b.xhtml" media-type="application/xhtml+xml" properties="svg"/>
    <item id="p-0001" href="xhtml/p-0001.xhtml" media-type="application/xhtml+xml" properties="svg"/>
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="p-000a" properties="rendition:page-spread-center" linear="yes"/>
    <itemref idref="p-000b" properties="page-spread-right" linear="yes"/>
    <itemref idref="p-0001" properties="page-spread-left" linear="yes"/>
  </spine>
</package>`;
const fixed = xmlParser.parse(FIXED_OPF);

describe("fixed-layout metadata", () => {
  it("detects pre-paginated layout", () => {
    expect(getRenditionLayout(fixed)).toBe("pre-paginated");
    expect(isFixedLayout(fixed)).toBe(true);
    expect(isFixedLayout(plain)).toBe(false);
    expect(getRenditionLayout(plain)).toBe("reflowable");
  });

  it("reads a rendition property's text", () => {
    expect(getRenditionProperty(fixed, "rendition:spread")).toBe("landscape");
  });

  it("reads a legacy name/content meta", () => {
    expect(getMetaContentByName(fixed, "original-resolution")).toBe("1303x2048");
  });

  it("resolves the base viewport", () => {
    expect(getBookViewport(fixed)).toEqual({ width: 1303, height: 2048 });
    expect(getBookViewport(plain)).toBeNull();
  });

  it("reads spine page-spread sides in order", () => {
    const spine = getSpinePageSpreads(fixed);
    expect(spine[0]).toEqual({ idref: "p-000a", pageSpread: "center", layout: null, linear: true });
    expect(spine[1]).toEqual({ idref: "p-000b", pageSpread: "right", layout: null, linear: true });
    expect(spine[2]).toEqual({ idref: "p-0001", pageSpread: "left", layout: null, linear: true });
  });
});

// Open Manga Format book: no rendition:layout, declares omf:version and
// references page images directly from the spine (no XHTML wrapper).
const OMF_OPF = `<?xml version="1.0"?>
<package version="3.0" prefix="omf: http://openmangaformat.org/schema/1.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>オープンマンガ</dc:title>
    <meta property="omf:version">omf.1.0</meta>
    <meta property="omf:viewport">width=1440, height=2048</meta>
  </metadata>
  <manifest>
    <item id="nav" href="navigation_standard.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="image001" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="image002" href="images/p01.jpg" media-type="image/jpeg"/>
    <item id="image003" href="images/p02.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine toc="ncx" page-progression-direction="rtl">
    <itemref idref="image001"/>
    <itemref idref="image002" properties="page-spread-right"/>
    <itemref idref="image003" properties="page-spread-left"/>
  </spine>
</package>`;
const omf = xmlParser.parse(OMF_OPF);

// Mixed book: globally reflowable light novel with embedded fixed-layout image
// pages declared via per-itemref rendition:layout-pre-paginated.
const MIXED_OPF = `<?xml version="1.0"?>
<package version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>混在</dc:title>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
    <item id="p-cover" href="xhtml/p-cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>
    <item id="p-001" href="xhtml/p-001.xhtml" media-type="application/xhtml+xml" properties="svg"/>
    <item id="p-002" href="xhtml/p-002.xhtml" media-type="application/xhtml+xml" properties="svg"/>
    <item id="p-021" href="xhtml/p-021.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref linear="yes" idref="p-cover" properties="rendition:layout-pre-paginated rendition:spread-none rendition:page-spread-center"/>
    <itemref linear="yes" idref="p-001" properties="rendition:layout-pre-paginated page-spread-right"/>
    <itemref linear="yes" idref="p-002" properties="rendition:layout-pre-paginated page-spread-left"/>
    <itemref linear="yes" idref="p-021"/>
  </spine>
</package>`;
const mixed = xmlParser.parse(MIXED_OPF);

describe("parseItemLayout", () => {
  it("reads a per-item layout override", () => {
    expect(parseItemLayout("rendition:layout-pre-paginated page-spread-right")).toBe("pre-paginated");
    expect(parseItemLayout("rendition:layout-reflowable")).toBe("reflowable");
    expect(parseItemLayout("page-spread-left")).toBeNull();
    expect(parseItemLayout(undefined)).toBeNull();
  });
});

describe("mixed book (reflowable + embedded fixed pages)", () => {
  it("is reflowable at the book level", () => {
    expect(getRenditionLayout(mixed)).toBe("reflowable");
    expect(isFixedLayout(mixed)).toBe(false);
  });

  it("exposes per-item pre-paginated overrides with their page-spread", () => {
    const byId = Object.fromEntries(getSpinePageSpreads(mixed).map((p) => [p.idref, p]));
    expect(byId["p-cover"]).toMatchObject({ layout: "pre-paginated", pageSpread: "center" });
    expect(byId["p-001"]).toMatchObject({ layout: "pre-paginated", pageSpread: "right" });
    expect(byId["p-002"]).toMatchObject({ layout: "pre-paginated", pageSpread: "left" });
    // A reflowable text page: no layout override, no page-spread.
    expect(byId["p-021"]).toMatchObject({ layout: null, pageSpread: null });
  });
});

describe("Open Manga Format (omf) detection", () => {
  it("treats omf:version as pre-paginated even without rendition:layout", () => {
    expect(getRenditionProperty(omf, "rendition:layout")).toBe("");
    expect(getRenditionLayout(omf)).toBe("pre-paginated");
    expect(isFixedLayout(omf)).toBe(true);
  });

  it("resolves the viewport from omf:viewport", () => {
    expect(getBookViewport(omf)).toEqual({ width: 1440, height: 2048 });
  });

  it("reads image idrefs and their page-spread sides from the spine", () => {
    const spine = getSpinePageSpreads(omf);
    expect(spine[0]).toEqual({ idref: "image001", pageSpread: null, layout: null, linear: true });
    expect(spine[1]).toEqual({ idref: "image002", pageSpread: "right", layout: null, linear: true });
    expect(spine[2]).toEqual({ idref: "image003", pageSpread: "left", layout: null, linear: true });
  });
});
