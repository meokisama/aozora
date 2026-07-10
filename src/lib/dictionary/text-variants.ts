/*
 * Lookup text variants for the hover dictionary. Yomitan runs the scanned text
 * through a set of "text processors" and tries each variant, so a word written
 * in katakana still matches a hiragana dictionary reading (and vice versa) — see
 * references/yomitan/ext/js/language/ja/japanese-text-preprocessors.js.
 *
 * We keep ONLY length-preserving folds (katakana↔hiragana). The lookup reports
 * how many source characters a match consumed so the reader can highlight that
 * run; a length-changing transform (half-width kana, collapsing すっっごい→すごい)
 * would break that char-for-char mapping, so those are intentionally left out.
 * Kana conversion ported from Yomitan (ja/japanese.js), GPL-3.0-or-later.
 */

import { convertKatakanaToHiragana } from "./furigana";

const HIRAGANA_CONVERSION_RANGE: [number, number] = [0x3041, 0x3096];
const KATAKANA_CONVERSION_RANGE: [number, number] = [0x30a1, 0x30f6];

/** Folds hiragana onto katakana (1:1 within the conversion range, length-preserving). */
export function convertHiraganaToKatakana(text: string): string {
  const offset = KATAKANA_CONVERSION_RANGE[0] - HIRAGANA_CONVERSION_RANGE[0];
  let result = "";
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    result += cp >= HIRAGANA_CONVERSION_RANGE[0] && cp <= HIRAGANA_CONVERSION_RANGE[1] ? String.fromCodePoint(cp + offset) : char;
  }
  return result;
}

/**
 * Distinct source-text variants to try for a lookup, the original first. Only
 * length-preserving kana folds are applied (katakana↔hiragana), so a variant's
 * character positions still line up with the original text one-for-one — the
 * matched length a variant yields is valid for highlighting the original run.
 */
export function lookupVariants(text: string): string[] {
  if (!text) return [text];
  const candidates = [
    text,
    convertKatakanaToHiragana(text, true), // katakana → hiragana, keep the ー mark
    convertKatakanaToHiragana(text, false), // …and fold ー onto its vowel (こーひー → こおひい)
    convertHiraganaToKatakana(text),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of candidates) {
    // Drop any transform that changed the length (must not happen for the folds
    // above) so the caller can trust variant offsets against the source.
    if (v.length !== text.length || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
