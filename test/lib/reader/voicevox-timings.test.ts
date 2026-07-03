import { describe, it, expect } from "vitest";
import { buildCharTimings } from "@/lib/reader/voicevox-timings";

/** A mora with no consonant, `len` seconds of vowel. */
const mora = (len = 0.1) => ({ consonant_length: 0, vowel_length: len });

/** An AudioQuery skeleton: phrases as arrays of mora counts, optional pauses. */
function query(phrases: Array<{ moras: number; pause?: number }>, pre = 0.1, post = 0.1) {
  return {
    prePhonemeLength: pre,
    postPhonemeLength: post,
    accent_phrases: phrases.map((p) => ({
      moras: Array.from({ length: p.moras }, () => mora()),
      pause_mora: p.pause != null ? mora(p.pause) : null,
    })),
  };
}

describe("buildCharTimings", () => {
  it("gives each kana its own mora's end time", () => {
    const t = buildCharTimings(query([{ moras: 5 }]), "かきくけこ", 1, 1);
    expect(t.chars.map((c) => c.toFixed(1))).toEqual(["0.2", "0.3", "0.4", "0.5", "0.6"]);
    expect(t.total).toBeCloseTo(0.7);
  });

  it("holds the comma at the clause end through the pause", () => {
    const t = buildCharTimings(query([{ moras: 2, pause: 0.3 }, { moras: 2 }]), "かき、くけ", 1, 1);
    // か き end their moras; 、 inherits き's time (before the 0.3s pause);
    // く only completes after the pause has elapsed.
    expect(t.chars.map((c) => c.toFixed(1))).toEqual(["0.2", "0.3", "0.3", "0.7", "0.8"]);
  });

  it("charges kanji the moras left over after the kana are pinned", () => {
    // 漢字だ → カンジダ: 4 moras, だ takes 1, 漢/字 split the remaining 3.
    const t = buildCharTimings(query([{ moras: 4 }]), "漢字だ", 1, 1);
    expect(t.chars.map((c) => c.toFixed(2))).toEqual(["0.25", "0.40", "0.50"]);
  });

  it("merges small kana into the preceding character's mora", () => {
    // きゃく → キャ・ク: 2 moras; ゃ adds none and inherits き's end.
    const t = buildCharTimings(query([{ moras: 2 }]), "きゃく", 1, 1);
    expect(t.chars.map((c) => c.toFixed(1))).toEqual(["0.2", "0.2", "0.3"]);
  });

  it("lights leading punctuation at voice onset, trailing at the last mora", () => {
    const t = buildCharTimings(query([{ moras: 2 }]), "「かき」", 1, 1);
    expect(t.chars.map((c) => c.toFixed(1))).toEqual(["0.1", "0.2", "0.3", "0.3"]);
  });

  it("still pins kana when pauses don't match the text's commas", () => {
    // Engine produced no pause for the comma — one clause, counting still exact.
    const t = buildCharTimings(query([{ moras: 4 }]), "かき、くけ", 1, 1);
    expect(t.chars.map((c) => c.toFixed(1))).toEqual(["0.2", "0.3", "0.3", "0.4", "0.5"]);
  });

  it("spreads evenly when the mora count defies per-character accounting", () => {
    // 2 kana but 3 moras: fall back to 1.5 moras per voiced character.
    const t = buildCharTimings(query([{ moras: 3 }]), "かき", 1, 1);
    expect(t.chars.map((c) => c.toFixed(2))).toEqual(["0.25", "0.40"]);
  });

  it("mirrors the engine's speedScale over moras, silences and pauses", () => {
    const t = buildCharTimings(query([{ moras: 2 }]), "かき", 2, 1);
    expect(t.chars.map((c) => c.toFixed(2))).toEqual(["0.10", "0.15"]);
    expect(t.total).toBeCloseTo(0.2);
  });

  it("stretches pauses by pauseLengthScale before speeding them up", () => {
    const t = buildCharTimings(query([{ moras: 1, pause: 0.2 }, { moras: 1 }]), "か、き", 1, 2);
    expect(t.chars.map((c) => c.toFixed(1))).toEqual(["0.2", "0.2", "0.7"]);
  });

  it("returns an empty timeline for empty text", () => {
    const t = buildCharTimings(query([{ moras: 1 }]), "", 1, 1);
    expect(t.chars).toEqual([]);
  });
});
