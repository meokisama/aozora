import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSpreads } from "@/lib/reader/spreads";
import { xmlParser, getSpinePageSpreads, getPageProgressionDirection } from "@/lib/epub/opf";

/** Compact helper: build pages from a list of page-spread sides. */
const pages = (...sides) => sides.map((pageSpread, i) => ({ id: `p${i}`, pageSpread }));
/** Render a spread as the page ids it contains, in DOM order. */
const ids = (spread) => spread.items.map((p) => p.id);

describe("buildSpreads", () => {
  it("pairs an opening page with the following closing page (rtl)", () => {
    // rtl: right opens, left closes → [right, left] share a spread.
    const spreads = buildSpreads(pages("right", "left"), "rtl");
    expect(spreads).toHaveLength(1);
    expect(spreads[0].single).toBe(false);
    expect(ids(spreads[0])).toEqual(["p0", "p1"]); // right kept first, left second
  });

  it("pairs left→right for ltr", () => {
    const spreads = buildSpreads(pages("left", "right"), "ltr");
    expect(spreads).toHaveLength(1);
    expect(ids(spreads[0])).toEqual(["p0", "p1"]);
  });

  it("keeps a center page (cover) as a single spread", () => {
    const spreads = buildSpreads(pages("center"), "rtl");
    expect(spreads).toHaveLength(1);
    expect(spreads[0].single).toBe(true);
    expect(spreads[0].pageSpread).toBe("center");
  });

  it("models the standard manga sequence: cover, then right/left pairs", () => {
    // cover(center) p0(right) p1(left) p2(right) p3(left)
    const spreads = buildSpreads(pages("center", "right", "left", "right", "left"), "rtl");
    expect(spreads.map(ids)).toEqual([["p0"], ["p1", "p2"], ["p3", "p4"]]);
    expect(spreads.map((s) => s.single)).toEqual([true, false, false]);
  });

  it("does not pair two openers or two closers in a row", () => {
    // right right left: first right is lone, second right pairs with the left.
    const spreads = buildSpreads(pages("right", "right", "left"), "rtl");
    expect(spreads.map(ids)).toEqual([["p0"], ["p1", "p2"]]);
  });

  it("leaves a lone closing page as a single spread", () => {
    // a `left` with no preceding `right` stays single (aligned to the left half).
    const spreads = buildSpreads(pages("left"), "rtl");
    expect(spreads).toHaveLength(1);
    expect(spreads[0].single).toBe(true);
    expect(spreads[0].pageSpread).toBe("left");
  });

  it("falls back to one page per spread when no sides are declared", () => {
    const spreads = buildSpreads(pages(null, null, null), "rtl");
    expect(spreads).toHaveLength(3);
    expect(spreads.every((s) => s.single)).toBe(true);
  });

  it("only pairs fixed-layout pages — reflowable text never pairs", () => {
    // A mixed book: a pre-paginated right page followed by a reflowable text
    // page that happens to carry page-spread-left. They must NOT pair.
    const list = [
      { id: "img", pageSpread: "right", prePaginated: true },
      { id: "text", pageSpread: "left", prePaginated: false },
    ];
    const spreads = buildSpreads(list, "rtl");
    expect(spreads.map(ids)).toEqual([["img"], ["text"]]);
    expect(spreads.every((s) => s.single)).toBe(true);
  });

  it("pairs consecutive pre-paginated pages within a mixed book", () => {
    const list = [
      { id: "t1", pageSpread: null, prePaginated: false },
      { id: "r", pageSpread: "right", prePaginated: true },
      { id: "l", pageSpread: "left", prePaginated: true },
      { id: "t2", pageSpread: null, prePaginated: false },
    ];
    const spreads = buildSpreads(list, "rtl");
    expect(spreads.map(ids)).toEqual([["t1"], ["r", "l"], ["t2"]]);
  });

  it("skips non-linear pages", () => {
    const list = [
      { id: "a", pageSpread: "right" },
      { id: "skip", pageSpread: "left", linear: false },
      { id: "b", pageSpread: "left" },
    ];
    const spreads = buildSpreads(list, "rtl");
    // The non-linear page is dropped; a then pairs with the next linear left.
    expect(spreads.map(ids)).toEqual([["a", "b"]]);
  });
});

describe("buildSpreads on the real sample OPF (manga-2)", () => {
  const opfPath = fileURLToPath(new URL("../../../sample/manga-2/item/standard.opf", import.meta.url));
  const contents = xmlParser.parse(readFileSync(opfPath, "utf8"));
  const ppd = getPageProgressionDirection(contents);
  const spinePages = getSpinePageSpreads(contents).filter((p) => p.linear);
  const spreads = buildSpreads(spinePages, ppd);

  it("reads rtl progression", () => {
    expect(ppd).toBe("rtl");
  });

  it("starts with the cover (center) alone", () => {
    expect(spreads[0].single).toBe(true);
    expect(spreads[0].items[0].idref).toBe("p-000a");
    expect(spreads[0].pageSpread).toBe("center");
  });

  it("orders each pair opener-first (right then left for rtl)", () => {
    expect(spreads[1].items.map((p) => p.idref)).toEqual(["p-000b", "p-0001"]);
    expect(spreads[1].single).toBe(false);
  });

  it("never places more than two pages in a spread", () => {
    expect(spreads.every((s) => s.items.length <= 2)).toBe(true);
  });

  it("accounts for every page exactly once", () => {
    const flat = spreads.flatMap((s) => s.items.map((p) => p.idref));
    expect(flat).toHaveLength(spinePages.length);
    expect(new Set(flat).size).toBe(spinePages.length);
  });
});
