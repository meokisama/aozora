import { describe, expect, it } from "vitest";
import { getKanaMorae, isMoraPitchHigh, getDownstepPositions, downstepNumber } from "@/lib/dictionary/pitch";

describe("getKanaMorae", () => {
  it("treats each full kana as its own mora", () => {
    expect(getKanaMorae("はし")).toEqual(["は", "し"]);
    expect(getKanaMorae("ともだち")).toEqual(["と", "も", "だ", "ち"]);
  });

  it("folds small kana into the preceding mora", () => {
    expect(getKanaMorae("きょう")).toEqual(["きょ", "う"]); // 2 morae, not 3
    expect(getKanaMorae("しゃしん")).toEqual(["しゃ", "し", "ん"]);
  });

  it("does not fold a leading small kana", () => {
    expect(getKanaMorae("ょ")).toEqual(["ょ"]);
  });
});

describe("isMoraPitchHigh (numeric downstep position)", () => {
  // 0 = heiban: low on mora 0, high thereafter (and stays high on the particle).
  it("heiban (0): low first, then high", () => {
    expect(isMoraPitchHigh(0, 0)).toBe(false);
    expect(isMoraPitchHigh(1, 0)).toBe(true);
    expect(isMoraPitchHigh(2, 0)).toBe(true);
  });

  // 1 = atamadaka: high on mora 0 only.
  it("atamadaka (1): high first, then low", () => {
    expect(isMoraPitchHigh(0, 1)).toBe(true);
    expect(isMoraPitchHigh(1, 1)).toBe(false);
  });

  // n = drop after mora n: low on 0, high through n-1, low from n.
  it("nakadaka/odaka (n): high between mora 1 and n-1", () => {
    expect(isMoraPitchHigh(0, 3)).toBe(false);
    expect(isMoraPitchHigh(1, 3)).toBe(true);
    expect(isMoraPitchHigh(2, 3)).toBe(true);
    expect(isMoraPitchHigh(3, 3)).toBe(false); // dropped
  });
});

describe("isMoraPitchHigh (explicit HL string)", () => {
  it("reads the high/low pattern directly", () => {
    expect(isMoraPitchHigh(0, "LHHL")).toBe(false);
    expect(isMoraPitchHigh(1, "LHHL")).toBe(true);
    expect(isMoraPitchHigh(3, "LHHL")).toBe(false);
  });
});

describe("getDownstepPositions", () => {
  it("finds the mora index where H drops to L", () => {
    expect(getDownstepPositions("LHHL")).toEqual([3]);
    expect(getDownstepPositions("HLL")).toEqual([1]);
  });

  it("returns 0 for an all-rising (heiban) pattern starting low", () => {
    expect(getDownstepPositions("LHH")).toEqual([0]);
  });
});

describe("downstepNumber", () => {
  it("passes a numeric position through", () => {
    expect(downstepNumber(2)).toBe(2);
    expect(downstepNumber(0)).toBe(0);
  });

  it("derives the first downstep from an HL string", () => {
    expect(downstepNumber("LHHL")).toBe(3);
  });
});
