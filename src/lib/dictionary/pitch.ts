/*
 * Pitch-accent helpers ported from Yomitan (ja/japanese.js). Layout-independent
 * (no DOM) so the pitch graph can be derived and unit-tested.
 * Copyright (C) Yomitan Authors, GPL-3.0-or-later.
 */

// Small kana attach to the preceding mora (e.g. きょ is one mora, not two).
const SMALL_KANA_SET = new Set("ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ");

/** Splits a kana reading into morae (small kana fold into the previous mora). */
export function getKanaMorae(text: string): string[] {
  const morae: string[] = [];
  for (const c of text) {
    if (SMALL_KANA_SET.has(c) && morae.length > 0) {
      morae[morae.length - 1] += c;
    } else {
      morae.push(c);
    }
  }
  return morae;
}

/**
 * Whether the mora at `moraIndex` is high-pitched. `pitch` is either a downstep
 * position (0 = heiban, 1 = atamadaka, n = drop after mora n) or an explicit
 * "HLHL…" string.
 */
export function isMoraPitchHigh(moraIndex: number, pitch: number | string): boolean {
  if (typeof pitch === "string") return pitch[moraIndex] === "H";
  switch (pitch) {
    case 0:
      return moraIndex > 0;
    case 1:
      return moraIndex < 1;
    default:
      return moraIndex > 0 && moraIndex < pitch;
  }
}

/** Downstep mora positions encoded in an explicit "HLHL…" pitch string. */
export function getDownstepPositions(pitchString: string): number[] {
  const downsteps: number[] = [];
  for (let i = 0; i < pitchString.length; i++) {
    if (i > 0 && pitchString[i - 1] === "H" && pitchString[i] === "L") downsteps.push(i);
  }
  if (downsteps.length === 0) downsteps.push(pitchString.startsWith("L") ? 0 : -1);
  return downsteps;
}

/** The downstep number to show in the `[n]` notation for a pitch position. */
export function downstepNumber(position: number | string): number {
  return typeof position === "string" ? getDownstepPositions(position)[0] : position;
}
