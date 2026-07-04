// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { charOffsetAt, rangeToCharSpan, charSpanToRange, annotationAtOffset } from "@/lib/reader/annotations";
import type { Annotation } from "@/lib/types";

/** Builds a detached content root from HTML. */
function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "aozora-content";
  el.innerHTML = html;
  return el;
}

/** All text nodes in document order (used to address selection boundaries). */
function textNodes(el: Element): Text[] {
  const out: Text[] = [];
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) out.push(c as Text);
      else walk(c);
    }
  };
  walk(el);
  return out;
}

/** A minimal annotation carrying just the span the mapper produces. */
function anno(startChar: number, endChar: number): Annotation {
  return { id: "x", bookId: "b", startChar, endChar, color: "yellow", note: null, snippet: null, progress: 0, createdAt: 0 };
}

describe("charOffsetAt", () => {
  it("counts only Japanese chars before a text-node boundary", () => {
    const el = root("<p>これは漢字です。</p>");
    const t = textNodes(el)[0];
    expect(charOffsetAt(el, t, 0, 0)).toBe(0); // before これ
    expect(charOffsetAt(el, t, 3, 0)).toBe(3); // before 漢 (これは = 3)
    expect(charOffsetAt(el, t, 5, 0)).toBe(5); // after 字
  });

  it("skips furigana readings, counting the base text across ruby", () => {
    // getParagraphNodes drops <rt>, so 漢字's reading contributes nothing.
    const el = root("<p>これは<ruby>漢字<rt>かんじ</rt></ruby>です</p>");
    const base = textNodes(el).find((n) => n.data === "漢字")!;
    expect(charOffsetAt(el, base, 0, 0)).toBe(3); // これは before the base
    expect(charOffsetAt(el, base, 2, 0)).toBe(5); // through 漢字
  });

  it("accumulates across earlier blocks", () => {
    const el = root("<p>あいう</p><p>えお</p>");
    const second = textNodes(el).find((n) => n.data === "えお")!;
    expect(charOffsetAt(el, second, 1, 0)).toBe(4); // あいう(3) + え(1)
  });

  it("adds the region base offset (paginated section start)", () => {
    const el = root("<p>あいう</p>");
    const t = textNodes(el)[0];
    expect(charOffsetAt(el, t, 2, 100)).toBe(102);
  });
});

describe("rangeToCharSpan", () => {
  it("maps a selection over base text to its character span", () => {
    const el = root("<p>これは<ruby>漢字<rt>かんじ</rt></ruby>です</p>");
    const base = textNodes(el).find((n) => n.data === "漢字")!;
    const range = document.createRange();
    range.setStart(base, 0);
    range.setEnd(base, 2);
    expect(rangeToCharSpan(el, range, 0)).toEqual({ startChar: 3, endChar: 5, text: "漢字" });
  });

  it("returns null for a collapsed or zero-length (punctuation-only) selection", () => {
    const el = root("<p>これは、です</p>");
    const t = textNodes(el)[0];
    const collapsed = document.createRange();
    collapsed.setStart(t, 1);
    collapsed.collapse(true);
    expect(rangeToCharSpan(el, collapsed, 0)).toBeNull();

    const punct = document.createRange(); // just the 、 (weight 0)
    punct.setStart(t, 3);
    punct.setEnd(t, 4);
    expect(rangeToCharSpan(el, punct, 0)).toBeNull();
  });
});

describe("charSpanToRange", () => {
  it("starts the wash on the first glyph, skipping a leading quote/period", () => {
    // 「そして (opening quote is zero-weight); a highlight of そして starts at offset 0.
    const el = root("<p>「そして</p>");
    const range = charSpanToRange(el, 0, 3, 0);
    expect(range?.toString()).toBe("そして"); // not 「そして
  });

  it("ends on the last glyph, excluding a trailing period", () => {
    const el = root("<p>そして。次</p>");
    const range = charSpanToRange(el, 0, 3, 0);
    expect(range?.toString()).toBe("そして"); // 。excluded
  });

  it("round-trips a mid-sentence selection built from a range", () => {
    const el = root("<p>これは「漢字」です</p>");
    const t = textNodes(el)[0];
    const sel = document.createRange();
    sel.setStart(t, 4); // start at 漢 (これは「 = 3 jp + zero-weight quote)
    sel.setEnd(t, 6); // end after 字
    const span = rangeToCharSpan(el, sel, 0)!;
    expect(charSpanToRange(el, span.startChar, span.endChar, 0)?.toString()).toBe("漢字");
  });
});

describe("annotationAtOffset", () => {
  it("finds the annotation whose [start, end) span contains the offset", () => {
    const a = anno(3, 5);
    expect(annotationAtOffset([a], 3)).toBe(a); // inclusive start
    expect(annotationAtOffset([a], 4)).toBe(a);
    expect(annotationAtOffset([a], 5)).toBeNull(); // exclusive end
    expect(annotationAtOffset([a], 2)).toBeNull();
  });

  it("returns the last (topmost) of overlapping annotations", () => {
    const under = anno(0, 10);
    const over = anno(4, 6);
    expect(annotationAtOffset([under, over], 5)).toBe(over);
  });
});
