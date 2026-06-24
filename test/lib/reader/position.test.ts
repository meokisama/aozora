// @vitest-environment jsdom
//
// Only collectAnchors is unit-testable here: it derives character offsets from
// the DOM and is layout-independent. The scroll/centre helpers
// (currentCharAtCenter, scrollToChar, scrollToElementId) depend on real
// getBoundingClientRect geometry that jsdom does not compute, so they need a
// browser-level harness and are not covered here.
import { describe, it, expect } from "vitest";
import { collectAnchors } from "@/lib/reader/position";

function content(html: string) {
  const el = document.createElement("div");
  el.className = "aozora-content";
  el.innerHTML = html;
  return el;
}

describe("collectAnchors", () => {
  it("returns no anchors and zero total for empty content", () => {
    const { anchors, total } = collectAnchors(content(""));
    expect(anchors).toEqual([]);
    expect(total).toBe(0);
  });

  it("records cumulative charBefore per anchor element", () => {
    const { anchors, total } = collectAnchors(content("<p>あいう</p><p>えお</p>"));
    expect(anchors).toHaveLength(2);
    expect(anchors[0].charBefore).toBe(0);
    expect(anchors[1].charBefore).toBe(3); // after あいう
    expect(total).toBe(5);
  });

  it("charBefore is non-decreasing (binary-search invariant)", () => {
    const { anchors } = collectAnchors(content("<p>あ</p><p>いうえ</p><p>お</p>"));
    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i].charBefore).toBeGreaterThanOrEqual(anchors[i - 1].charBefore);
    }
  });

  it("excludes ruby readings from the character total", () => {
    const { total } = collectAnchors(content("<p><ruby>漢<rt>かん</rt></ruby></p>"));
    expect(total).toBe(1);
  });
});
