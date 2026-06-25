import { describe, it, expect } from "vitest";
import { distributeFurigana } from "@/lib/dictionary/furigana";

// Compact a segment list to "text:reading|text:reading" for terse assertions
// (empty reading shown as bare text).
const fmt = (term: string, reading: string) =>
  distributeFurigana(term, reading)
    .map((s) => (s.reading ? `${s.text}:${s.reading}` : s.text))
    .join("|");

describe("distributeFurigana", () => {
  it("puts furigana only over the kanji, leaving okurigana bare", () => {
    expect(fmt("食べる", "たべる")).toBe("食:た|べる");
  });

  it("keeps a multi-kanji compound as one ruby segment", () => {
    expect(fmt("言葉", "ことば")).toBe("言葉:ことば");
  });

  it("splits kanji separated by okurigana", () => {
    expect(fmt("美味しい", "おいしい")).toBe("美味:おい|しい");
  });

  it("handles leading kana then kanji (お+金)", () => {
    expect(fmt("お金", "おかね")).toBe("お|金:かね");
  });

  it("returns a single bare segment when reading equals term (kana word)", () => {
    expect(fmt("ことば", "ことば")).toBe("ことば");
  });

  it("aligns kanji via kana normalisation, keeping the reading's kana form", () => {
    // 食 aligns because べる≈ベル under normalisation, but the okurigana keeps the
    // reading's (katakana) form since it differs from the term's hiragana.
    expect(fmt("食べる", "タベル")).toBe("食:タ|べる:ベル");
  });

  it("falls back to whole-word ruby when the reading can't be aligned", () => {
    // 今日 → きょう is irregular (can't be split per-char) — one fallback segment.
    expect(fmt("今日", "きょう")).toBe("今日:きょう");
  });

  it("distributes across kanji split by a kana boundary (取り消す)", () => {
    expect(fmt("取り消す", "とりけす")).toBe("取:と|り|消:け|す");
  });
});
