// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { xmlParser } from "@/lib/epub/opf";
import { generateHtml, PREPEND } from "@/lib/epub/generate-html";
import { buildDummyImage } from "@/lib/epub/dummy-image";

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
    expect(characters).toBe(6); // あいう (3) + えお (2) + inline gaiji glyph (1)
  });

  it("rewrites the image src to a dummy placeholder carrying the blob key", () => {
    const img = element.querySelector(`#${PREPEND}ch2 img`);
    expect(img!.getAttribute("src")).toContain("aoz:images/a.png");
  });

  it("tags an image inline with text as a gaiji glyph", () => {
    const img = element.querySelector(`#${PREPEND}ch2 img`);
    expect(img!.classList.contains("aoz-gaiji")).toBe(true);
  });

  it("produces no sections without a parsed TOC", () => {
    expect(sections).toEqual([]);
  });

  it("tags text-free wrappers, but ch1/ch2 have text", () => {
    expect(element.querySelector(`#${PREPEND}ch1 .aoz-no-text`)).toBeNull();
  });
});

describe("generateHtml (image-in-spine / OMF)", () => {
  // OMF / fixed-layout manga reference images directly from the spine.
  const omfOpf = `<?xml version="1.0"?>
  <package>
    <manifest>
      <item id="image001" href="images/cover.jpg" media-type="image/jpeg"/>
      <item id="image002" href="images/p01.jpg" media-type="image/jpeg"/>
    </manifest>
    <spine page-progression-direction="rtl">
      <itemref idref="image001"/>
      <itemref idref="image002" properties="page-spread-right"/>
    </spine>
  </package>`;
  const omf = xmlParser.parse(omfOpf);
  const data = {
    "images/cover.jpg": new Blob(["x"], { type: "image/jpeg" }),
    "images/p01.jpg": new Blob(["y"], { type: "image/jpeg" }),
  };
  const { element, characters } = generateHtml(data, omf, ".");

  it("wraps each image-in-spine item in an aoz-<idref> div", () => {
    expect(element.querySelector(`#${PREPEND}image001`)).toBeTruthy();
    expect(element.querySelector(`#${PREPEND}image002`)).toBeTruthy();
  });

  it("emits an <img> whose src is a dummy placeholder for the blob key", () => {
    const img = element.querySelector(`#${PREPEND}image002 img.aoz-spine-item-image`);
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src")).toContain("aoz:images/p01.jpg");
  });

  it("counts no characters and tags the wrappers text-free", () => {
    expect(characters).toBe(0);
    expect(element.querySelector(`#${PREPEND}image001 .aoz-no-text`)).toBeTruthy();
  });
});

describe("generateHtml (flat numeric filenames — substring collision)", () => {
  // Calibre/hako books name images by bare numbers at the root, so "1.jpg" is a
  // substring of "11.jpg"/"21.jpg" and "10.jpg" of "110.jpg". A global string
  // replace nested the dummies into broken URLs; per-element matching must not.
  const numOpf = `<?xml version="1.0"?>
  <package>
    <manifest>
      <item id="c" href="ch.html" media-type="application/xhtml+xml"/>
      <item id="i1" href="1.jpg" media-type="image/jpeg"/>
      <item id="i11" href="11.jpg" media-type="image/jpeg"/>
      <item id="i110" href="110.jpg" media-type="image/jpeg"/>
    </manifest>
    <spine><itemref idref="c"/></spine>
  </package>`;
  const num = xmlParser.parse(numOpf);
  const data = {
    "ch.html": '<html><body><p>あ<img src="1.jpg"/><img src="11.jpg"/><img src="110.jpg"/></p></body></html>',
    "1.jpg": new Blob(["a"], { type: "image/jpeg" }),
    "11.jpg": new Blob(["b"], { type: "image/jpeg" }),
    "110.jpg": new Blob(["c"], { type: "image/jpeg" }),
  };
  const { element } = generateHtml(data, num, ".");
  const imgs = Array.from(element.querySelectorAll(`#${PREPEND}c img`));

  it("gives each colliding filename its own intact dummy (no nesting)", () => {
    const srcs = imgs.map((i) => i.getAttribute("src"));
    expect(srcs).toEqual([buildDummyImage("1.jpg"), buildDummyImage("11.jpg"), buildDummyImage("110.jpg")]);
    // A nested/corrupted dummy would carry the marker twice.
    for (const src of srcs) expect(src!.match(/data:image\/gif/g)!.length).toBe(1);
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
