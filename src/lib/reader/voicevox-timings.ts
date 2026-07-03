/**
 * Aligns a VOICEVOX AudioQuery's mora timeline onto the characters of the text
 * it synthesized, so the karaoke highlight tracks the voice instead of drifting.
 *
 * A proportional map (fraction of moras spoken → fraction of characters) drifts
 * because mora density is uneven: a kana is exactly one mora, a kanji one to
 * four, punctuation none. Instead each character is charged its own mora budget:
 * kana one each (small ゃゅょ merge into the preceding character's mora),
 * punctuation zero, and anything else (kanji, digits, Latin) an equal share of
 * the moras left over in its clause. When the query's pauses match the text's
 * commas one-to-one, each clause is aligned independently so estimation error
 * never crosses a pause; a silent character inherits the clock as of the
 * preceding character, so the highlight rests on the comma through the pause
 * rather than creeping onto the next clause.
 */

import type { VoicevoxTimings } from "@/lib/types";

/** One mora's phoneme lengths (seconds, at speed 1) from the AudioQuery. */
interface Mora {
  consonant_length?: number | null;
  vowel_length?: number | null;
}
interface AccentPhrase {
  moras?: Mora[];
  pause_mora?: Mora | null;
}

// Small kana never carry their own mora — they merge into the preceding kana
// (きゃ is one mora). っ/ッ do carry one and are deliberately absent here.
const SMALL_KANA = "ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ";
// Characters the engine pauses at, used to anchor clause boundaries.
const PAUSE_CHARS = "、，,";
// Whitespace and punctuation: no mora, inherits the preceding character's time.
const SILENT_RE = /[\s\p{P}]/u;

/** One mora per character: kana including っ and the long-vowel mark ー. */
const isKana = (c: string): boolean => (c >= "ぁ" && c <= "ゖ") || (c >= "ァ" && c <= "ヺ") || c === "ー";

/**
 * Turns an AudioQuery into per-character end times (seconds on the synthesized
 * WAV's clock) for the exact `text` it was built from. The engine divides every
 * phoneme length (including the pre/post silence and the inter-phrase pauses)
 * by `speedScale`, so we mirror that; pauses are first stretched by
 * `pauseLengthScale`, then sped up like everything else.
 */
export function buildCharTimings(query: Record<string, unknown>, text: string, speed: number, pauseScale: number): VoicevoxTimings {
  const s = speed || 1;
  const p = pauseScale || 1;
  const phrases = (query.accent_phrases as AccentPhrase[] | undefined) ?? [];

  // Absolute mora start/end times; pauses advance the clock between phrases
  // but add no mora, and are remembered as clause anchors.
  const starts: number[] = [];
  const ends: number[] = [];
  const pauseAt: number[] = []; // mora count at each pause
  let t = Number(query.prePhonemeLength ?? 0) / s;
  for (const phrase of phrases) {
    for (const m of phrase.moras ?? []) {
      starts.push(t);
      t += ((m.consonant_length ?? 0) + (m.vowel_length ?? 0)) / s;
      ends.push(t);
    }
    if (phrase.pause_mora) {
      pauseAt.push(ends.length);
      t += ((phrase.pause_mora.vowel_length ?? 0) * p) / s;
    }
  }
  const total = t + Number(query.postPhonemeLength ?? 0) / s;

  // Seconds at which `c` (a possibly fractional mora count) has been spoken.
  // Integer counts land exactly on a mora's end — before any pause that follows
  // it — which is what lets the highlight hold still through the pause. Snap
  // near-integers first: float accumulation drift (e.g. 3.0000000000000004)
  // would otherwise tip a boundary char into the next mora, past the pause.
  const timeAt = (c: number): number => {
    if (ends.length === 0 || c <= 0) return starts[0] ?? 0;
    const snapped = Math.abs(c - Math.round(c)) < 1e-6 ? Math.round(c) : c;
    const clamped = Math.min(snapped, ends.length);
    const i = Math.ceil(clamped) - 1;
    return starts[i] + (clamped - i) * (ends[i] - starts[i]);
  };

  // Charge each character in chars[c0,c1) its share of moras [m0,m1).
  const chars = new Array<number>(text.length);
  const fill = (c0: number, c1: number, m0: number, m1: number): void => {
    let kana = 0;
    let opaque = 0;
    for (let i = c0; i < c1; i++) {
      const ch = text[i];
      if (SMALL_KANA.includes(ch) || SILENT_RE.test(ch)) continue;
      if (isKana(ch)) kana++;
      else opaque++;
    }
    const budget = m1 - m0;
    let perKana = 1;
    let perOpaque = opaque > 0 ? (budget - kana) / opaque : 0;
    if (perOpaque < 0 || (opaque === 0 && kana !== budget)) {
      // Counting failed (the engine merged or split differently than we
      // guessed) — fall back to an even spread over the voiced characters.
      const voiced = kana + opaque;
      perKana = perOpaque = voiced > 0 ? budget / voiced : 0;
    }
    let c = m0;
    for (let i = c0; i < c1; i++) {
      const ch = text[i];
      if (!SMALL_KANA.includes(ch) && !SILENT_RE.test(ch)) c += isKana(ch) ? perKana : perOpaque;
      chars[i] = timeAt(Math.min(c, m1));
    }
  };

  // Clause anchoring: only when the engine's pauses map one-to-one onto the
  // text's commas (a trailing pause has no clause after it, so it never
  // anchors). Otherwise align the whole text as a single clause.
  const pauseIdx: number[] = [];
  for (let i = 0; i < text.length; i++) if (PAUSE_CHARS.includes(text[i])) pauseIdx.push(i);
  const anchors = pauseAt.filter((m) => m < ends.length);
  const anchored = anchors.length > 0 && anchors.length === pauseIdx.length;

  const clauses = anchored ? anchors.length + 1 : 1;
  for (let k = 0; k < clauses; k++) {
    const c0 = anchored && k > 0 ? pauseIdx[k - 1] + 1 : 0;
    const c1 = anchored && k < anchors.length ? pauseIdx[k] + 1 : text.length;
    const m0 = anchored && k > 0 ? anchors[k - 1] : 0;
    const m1 = anchored && k < anchors.length ? anchors[k] : ends.length;
    fill(c0, c1, m0, m1);
  }

  return { total, chars };
}
