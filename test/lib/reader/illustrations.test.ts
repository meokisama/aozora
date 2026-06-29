// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { collectIllustrations } from "@/lib/reader/illustrations";

describe("collectIllustrations", () => {
  const keyToUrl = new Map([
    ["images/a.jpg", "blob:a"],
    ["images/b.png", "blob:b"],
  ]);

  const html = [
    "<p>あいう</p>", // 3 chars
    '<img class="gaiji" src="aoz:g.png" />', // gaiji: +1 char, not a gallery image
    "<p>えお</p>", // 2 chars
    '<img src="data:image/gif;aoz:images/a.jpg;base64,R0l=" alt="pic" />', // dummy placeholder
    "<p>かき</p>", // 2 chars
    '<img src="aoz:images/b.png" />', // bare aoz: ref
    '<img src="aoz:missing.png" />', // no blob → skipped
  ].join("");

  it("records non-gaiji images with cumulative char offsets and resolved URLs", () => {
    const out = collectIllustrations(html, keyToUrl);
    expect(out).toEqual([
      { key: "images/a.jpg", url: "blob:a", charOffset: 6, alt: "pic" }, // 3 + gaiji(1) + 2
      { key: "images/b.png", url: "blob:b", charOffset: 8, alt: "" }, // + 2
    ]);
  });

  it("skips images whose blob is missing", () => {
    const out = collectIllustrations(html, keyToUrl);
    expect(out.some((i) => i.key === "missing.png")).toBe(false);
  });

  it("skips ruby readings and hidden subtrees when counting", () => {
    const ruby = "<ruby>漢<rt>かん</rt></ruby>" + '<img src="aoz:images/a.jpg" />';
    const out = collectIllustrations(ruby, keyToUrl);
    // Only 漢 (1 char) counts; the rt reading is ignored.
    expect(out[0].charOffset).toBe(1);
  });
});
