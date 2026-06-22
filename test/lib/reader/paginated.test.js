// @vitest-environment jsdom
//
// PaginatedController's rendering (setSection, _measure, flipPage) depends on
// real multi-column layout + scroll geometry that jsdom does not compute, so it
// needs a browser-level harness. Covered here: the layout-independent pieces —
// the per-section character accounting derived in the constructor, the derived
// getters, and the page<->character mapping.
import { describe, it, expect, vi } from "vitest";
import { PaginatedController, PAGE_GAP } from "@/lib/reader/paginated";

function section(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

function makeController({ vertical = false } = {}) {
  // counts: 3, 2, 4  ->  cumulative 3, 5, 9
  const sections = [
    section("<p>あいう</p>"),
    section("<p>えお</p>"),
    section("<p>かきくけ</p>"),
  ];
  return new PaginatedController({
    scrollEl: document.createElement("div"),
    contentEl: document.createElement("div"),
    sections,
    vertical,
    onChange: vi.fn(),
  });
}

describe("PaginatedController character accounting", () => {
  it("computes cumulative per-section character counts and the book total", () => {
    const c = makeController();
    expect(c.sectionAccChar).toEqual([3, 5, 9]);
    expect(c.charCount).toBe(9);
  });

  it("sectionStart is 0 before any section is rendered", () => {
    const c = makeController();
    expect(c.sectionStart).toBe(0); // sectionIndex === -1
  });

  it("sectionStart is the cumulative count up to the previous section", () => {
    const c = makeController();
    c.sectionIndex = 2;
    expect(c.sectionStart).toBe(5); // sections 0+1 => 3+2
  });

  it("exploredChar adds the current page's start to the section start", () => {
    const c = makeController();
    c.sectionIndex = 2; // sectionStart 5
    c.pageStartChar = [0, 5];
    c.page = 1;
    expect(c.exploredChar).toBe(10);
  });
});

describe("PaginatedController._pageForCharWithin", () => {
  it("maps a section-local offset to the last page starting at or before it", () => {
    const c = makeController();
    c.pageStartChar = [0, 5, 12];
    expect(c._pageForCharWithin(0)).toBe(0);
    expect(c._pageForCharWithin(4)).toBe(0);
    expect(c._pageForCharWithin(5)).toBe(1);
    expect(c._pageForCharWithin(11)).toBe(1);
    expect(c._pageForCharWithin(12)).toBe(2);
    expect(c._pageForCharWithin(999)).toBe(2);
  });
});

describe("PaginatedController axis getters", () => {
  it("uses scrollWidth/scrollHeight per writing direction", () => {
    expect(makeController({ vertical: false }).scrollSizeProp).toBe("scrollWidth");
    expect(makeController({ vertical: true }).scrollSizeProp).toBe("scrollHeight");
  });

  it("screenSize is the viewport size plus the inter-page gap", () => {
    const c = makeController();
    c.contentW = 600;
    expect(c.gap).toBe(PAGE_GAP);
    expect(c.screenSize).toBe(640);
  });

  it("destroy() flips the destroyed flag", () => {
    const c = makeController();
    expect(c.destroyed).toBe(false);
    c.destroy();
    expect(c.destroyed).toBe(true);
  });
});
