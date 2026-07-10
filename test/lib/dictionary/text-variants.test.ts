import { describe, it, expect } from "vitest";
import { convertHiraganaToKatakana, lookupVariants } from "@/lib/dictionary/text-variants";

describe("convertHiraganaToKatakana", () => {
  it("folds hiragana onto katakana", () => {
    expect(convertHiraganaToKatakana("さぼる")).toBe("サボル");
    expect(convertHiraganaToKatakana("よみちゃん")).toBe("ヨミチャン");
  });

  it("leaves katakana, kanji and ascii untouched", () => {
    expect(convertHiraganaToKatakana("コーヒー")).toBe("コーヒー");
    expect(convertHiraganaToKatakana("食べる")).toBe("食ベル"); // only the kana folds; kanji stays
    expect(convertHiraganaToKatakana("abc123")).toBe("abc123");
  });
});

describe("lookupVariants", () => {
  it("always starts with the original text", () => {
    expect(lookupVariants("サボる")[0]).toBe("サボる");
  });

  it("offers a hiragana fold for katakana input (matches a hiragana reading)", () => {
    expect(lookupVariants("サボる")).toContain("さぼる");
  });

  it("offers a katakana fold for hiragana input (matches a katakana headword)", () => {
    expect(lookupVariants("さぼる")).toContain("サボル");
  });

  it("keeps every variant the same length as the source (highlight stays aligned)", () => {
    for (const text of ["サボる", "コーヒー", "食べた", "すごい"]) {
      for (const v of lookupVariants(text)) expect(v.length).toBe(text.length);
    }
  });

  it("dedupes so all-kanji / ascii text yields just the original", () => {
    expect(lookupVariants("漢字")).toEqual(["漢字"]);
    expect(lookupVariants("test")).toEqual(["test"]);
  });

  it("handles empty input", () => {
    expect(lookupVariants("")).toEqual([""]);
  });
});
