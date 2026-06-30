import { describe, it, expect } from "vitest";
import { xmlParser } from "@/lib/epub/opf";
import { generateStyleSheet } from "@/lib/epub/generate-stylesheet";

function opfWithCss(hrefs: string[]) {
  const items = hrefs.map((h: string, i: number) => `<item id="c${i}" href="${h}" media-type="text/css"/>`).join("");
  return xmlParser.parse(`<package><manifest>${items}<item id="x" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest></package>`);
}

describe("generateStyleSheet", () => {
  it("concatenates only the css manifest items", () => {
    const contents = opfWithCss(["a.css", "b.css"]);
    const data = { "a.css": ".a{color:red}", "b.css": ".b{color:blue}", "ch1.xhtml": "<p/>" };
    expect(generateStyleSheet(data, contents)).toBe(".a{color:red}.b{color:blue}");
  });

  it("deduplicates repeated css hrefs", () => {
    const contents = opfWithCss(["a.css", "a.css"]);
    const data = { "a.css": ".a{}" };
    expect(generateStyleSheet(data, contents)).toBe(".a{}");
  });

  it("tolerates a missing css blob (treats as empty)", () => {
    const contents = opfWithCss(["a.css", "missing.css"]);
    const data = { "a.css": ".a{}" };
    expect(generateStyleSheet(data, contents)).toBe(".a{}");
  });

  it("strips @charset declarations", () => {
    const contents = opfWithCss(["a.css"]);
    const data = { "a.css": `@charset "UTF-8";\n.a{color:red}` };
    expect(generateStyleSheet(data, contents)).toBe("\n.a{color:red}");
  });

  it("strips @import rules (url() and quoted forms)", () => {
    const contents = opfWithCss(["a.css"]);
    const data = {
      "a.css": `@import url(fonts.css);@import "other.css";\n.a{}`,
    };
    expect(generateStyleSheet(data, contents)).toBe("\n.a{}");
  });

  it("returns empty string when no css items exist", () => {
    const contents = opfWithCss([]);
    expect(generateStyleSheet({}, contents)).toBe("");
  });

  describe("line-height stripping (so the reader's setting governs)", () => {
    function css(input: string) {
      const contents = opfWithCss(["a.css"]);
      return generateStyleSheet({ "a.css": input }, contents);
    }

    it("drops line-height but keeps surrounding declarations", () => {
      // Calibre body class: line-height between other props (the reported bug).
      expect(css(".class1{display:block;line-height:1.2;margin:0 5pt}")).toBe(".class1{display:block;margin:0 5pt}");
    });

    it("drops a line-height that is the only/last declaration in a rule", () => {
      expect(css("body{line-height:1.75}")).toBe("body{}");
      expect(css(".a{color:red;line-height:1.6}")).toBe(".a{color:red;}");
    });

    it("tolerates whitespace around the colon and value", () => {
      // The boundary char (here the leading space) is preserved by design.
      expect(css(".a{ line-height:    1.6 ;color:red}")).toBe(".a{ color:red}");
    });

    it("leaves unrelated properties untouched", () => {
      expect(css(".a{height:1.6em;max-width:10px}")).toBe(".a{height:1.6em;max-width:10px}");
    });
  });
});
