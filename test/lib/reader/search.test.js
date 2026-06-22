// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalize, buildSearchIndex, searchIndex } from "@/lib/reader/search";

describe("normalize", () => {
  it("folds full-width ASCII to half-width and lower-cases", () => {
    expect(normalize("ＡＢＣ１２３")).toBe("abc123");
    expect(normalize("Hello")).toBe("hello");
  });

  it("unifies whitespace (incl. the ideographic space) to a single space", () => {
    expect(normalize("a\tb　c\nd")).toBe("a b c d");
  });

  it("preserves length so indices stay aligned, and leaves Japanese intact", () => {
    const s = "今日Ａは　です";
    expect(normalize(s)).toHaveLength(s.length);
    expect(normalize("漢字")).toBe("漢字");
  });
});

describe("buildSearchIndex", () => {
  // Two spine sections; the first paragraph carries ruby (furigana on 漢字) and a
  // trailing full-width period (counts as 0 Japanese characters).
  const html =
    '<div id="aoz-c1"><p>今日は<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>。</p></div>' +
    '<div id="aoz-c2"><p>明日</p></div>';

  it("groups each paragraph into one block with ruby readings excluded", () => {
    const index = buildSearchIndex(html);
    expect(index).toHaveLength(2);
    expect(index[0].text).toBe("今日は漢字。"); // <rt> readings dropped
    expect(index[1].text).toBe("明日");
  });

  it("records cumulative Japanese-character offsets (matching the reader)", () => {
    const index = buildSearchIndex(html);
    expect(index[0].charBefore).toBe(0);
    // 今(1)日(1)は(1)漢(1)字(1)、period counts 0 → next block starts at 5
    expect(index[1].charBefore).toBe(5);
  });
});

describe("searchIndex", () => {
  const html =
    '<div id="aoz-c1"><p>今日は<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>。</p></div>' +
    '<div id="aoz-c2"><p>明日も漢字</p></div>';
  const index = buildSearchIndex(html);

  it("returns no results for an empty query", () => {
    expect(searchIndex(index, "")).toEqual({ results: [], total: 0, capped: false });
    expect(searchIndex(index, "   ")).toEqual({ results: [], total: 0, capped: false });
  });

  it("matches across ruby and reports the correct character offset", () => {
    const { results, total } = searchIndex(index, "漢字");
    expect(total).toBe(2);
    // first hit: after 今日は → offset 3; second hit: 今日は漢字。(5) + 明日も(3) = 8
    expect(results.map((r) => r.charOffset)).toEqual([3, 8]);
  });

  it("builds a snippet with the matched run separated out", () => {
    const { results } = searchIndex(index, "漢字");
    expect(results[0].hit).toBe("漢字");
    expect(results[0].pre).toBe("今日は");
    expect(results[0].post).toBe("。");
  });

  it("matches case- and width-insensitively", () => {
    const idx = buildSearchIndex('<div id="aoz-c1"><p>ＡＢＣです</p></div>');
    const { total } = searchIndex(idx, "abc");
    expect(total).toBe(1);
  });

  it("caps the returned results while still counting the true total", () => {
    const idx = buildSearchIndex('<div id="aoz-c1"><p>ああああ</p></div>');
    const { results, total, capped } = searchIndex(idx, "あ", 2);
    expect(total).toBe(4);
    expect(results).toHaveLength(2);
    expect(capped).toBe(true);
  });
});
