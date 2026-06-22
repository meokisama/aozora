// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { xmlParser } from "@/lib/epub/opf";
import { generateHtml, PREPEND } from "@/lib/epub/generate-html";

const OPF = `<?xml version="1.0"?>
<package>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img1" href="images/a.png" media-type="image/png"/>
    <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

const contents = xmlParser.parse(OPF);

function baseData() {
  return {
    "text/ch1.xhtml": "<html><body><p>あいう</p></body></html>",
    "text/ch2.xhtml": '<html><body><p>えお<img src="../images/a.png"/></p></body></html>',
    "images/a.png": new Blob(["x"], { type: "image/png" }),
  };
}

describe("generateHtml (no TOC)", () => {
  const { element, characters, sections } = generateHtml(baseData(), contents, ".");

  it("wraps each spine item in an aoz-<idref> div", () => {
    expect(element.querySelector(`#${PREPEND}ch1`)).toBeTruthy();
    expect(element.querySelector(`#${PREPEND}ch2`)).toBeTruthy();
  });

  it("preserves spine order", () => {
    const ids = Array.from(element.children).map((c) => c.id);
    expect(ids).toEqual([`${PREPEND}ch1`, `${PREPEND}ch2`]);
  });

  it("sums Japanese character counts across the spine", () => {
    expect(characters).toBe(5); // あいう (3) + えお (2)
  });

  it("rewrites the image src to a dummy placeholder carrying the blob key", () => {
    const img = element.querySelector(`#${PREPEND}ch2 img`);
    expect(img.getAttribute("src")).toContain("aoz:images/a.png");
  });

  it("produces no sections without a parsed TOC", () => {
    expect(sections).toEqual([]);
  });

  it("tags text-free wrappers, but ch1/ch2 have text", () => {
    expect(element.querySelector(`#${PREPEND}ch1 .aoz-no-text`)).toBeNull();
  });
});

describe("generateHtml (NCX TOC)", () => {
  const ncx = `<?xml version="1.0"?>
  <ncx><navMap>
    <navPoint><navLabel><text>Chapter 1</text></navLabel><content src="text/ch1.xhtml"/></navPoint>
    <navPoint><navLabel><text>Chapter 2</text></navLabel><content src="text/ch2.xhtml"/></navPoint>
  </navMap></ncx>`;

  const data = { ...baseData(), "toc.ncx": ncx };
  const { sections } = generateHtml(data, contents, ".");

  it("derives a section per matched chapter, referencing the wrapper id", () => {
    expect(sections.length).toBeGreaterThanOrEqual(2);
    for (const s of sections) {
      expect(s.reference.startsWith(PREPEND)).toBe(true);
    }
  });

  it("records cumulative startCharacter offsets for top-level chapters", () => {
    const top = sections.filter((s) => s.startCharacter !== undefined);
    expect(top[0].startCharacter).toBe(0);
  });
});
