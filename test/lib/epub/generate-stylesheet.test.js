import { describe, it, expect } from "vitest";
import { xmlParser } from "@/lib/epub/opf";
import { generateStyleSheet } from "@/lib/epub/generate-stylesheet";

function opfWithCss(hrefs) {
  const items = hrefs
    .map((h, i) => `<item id="c${i}" href="${h}" media-type="text/css"/>`)
    .join("");
  return xmlParser.parse(
    `<package><manifest>${items}<item id="x" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest></package>`,
  );
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
});
