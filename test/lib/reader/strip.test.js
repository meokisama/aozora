import { describe, it, expect } from "vitest";
import { ordinalAtCenter } from "@/lib/reader/strip";

// Three pages of size 100, separated by a 10px gap, starting at the leading pad.
const boxes = [
  { ordinal: 0, start: 10, size: 100 }, // 10..110
  { ordinal: 1, start: 120, size: 100 }, // 120..220
  { ordinal: 2, start: 230, size: 100 }, // 230..330
];

describe("ordinalAtCenter", () => {
  it("returns 0 for an empty layout", () => {
    expect(ordinalAtCenter([], 500)).toBe(0);
  });

  it("clamps to the first page before it starts", () => {
    expect(ordinalAtCenter(boxes, 0)).toBe(0);
    expect(ordinalAtCenter(boxes, 10)).toBe(0);
  });

  it("resolves the page under the centre", () => {
    expect(ordinalAtCenter(boxes, 60)).toBe(0);
    expect(ordinalAtCenter(boxes, 170)).toBe(1);
    expect(ordinalAtCenter(boxes, 300)).toBe(2);
  });

  it("resolves a gap to the page just before it", () => {
    expect(ordinalAtCenter(boxes, 115)).toBe(0); // in the 110..120 gap
    expect(ordinalAtCenter(boxes, 225)).toBe(1); // in the 220..230 gap
  });

  it("clamps to the last page past the end", () => {
    expect(ordinalAtCenter(boxes, 9999)).toBe(2);
  });

  it("honours ordinals that are not array indices (e.g. RTL reverse order)", () => {
    // RTL horizontal: pages laid out last→first, so start ascends as ordinal
    // descends. The boxes stay sorted by start, so lookups still resolve.
    const rtl = [
      { ordinal: 2, start: 0, size: 50 },
      { ordinal: 1, start: 50, size: 50 },
      { ordinal: 0, start: 100, size: 50 },
    ];
    expect(ordinalAtCenter(rtl, 25)).toBe(2);
    expect(ordinalAtCenter(rtl, 75)).toBe(1);
    expect(ordinalAtCenter(rtl, 125)).toBe(0);
  });
});
