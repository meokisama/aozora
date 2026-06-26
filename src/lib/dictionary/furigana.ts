/*
 * Furigana distribution ported from Yomitan (ja/japanese.js). Aligns a reading
 * to its term so only the kanji segments carry furigana
 * (e.g. 食べる → [{食, た}, {べる, ""}]); falls back to one whole-word segment
 * when the reading can't be split unambiguously. Layout-independent (no DOM).
 * Copyright (C) Yomitan Authors, GPL-3.0-or-later.
 */

/** One run of the term with the reading that floats above it ("" = no furigana). */
export interface FuriganaSegment {
  text: string;
  reading: string;
}

interface FuriganaGroup {
  isKana: boolean;
  text: string;
  textNormalized: string | null;
}

type CodepointRange = [number, number];

const HIRAGANA_RANGE: CodepointRange = [0x3040, 0x309f];
const KATAKANA_RANGE: CodepointRange = [0x30a0, 0x30ff];
const KANA_RANGES: CodepointRange[] = [HIRAGANA_RANGE, KATAKANA_RANGE];

const HIRAGANA_CONVERSION_RANGE: CodepointRange = [0x3041, 0x3096];
const KATAKANA_CONVERSION_RANGE: CodepointRange = [0x30a1, 0x30f6];

const KATAKANA_SMALL_KA_CODE_POINT = 0x30f5;
const KATAKANA_SMALL_KE_CODE_POINT = 0x30f6;
const KANA_PROLONGED_SOUND_MARK_CODE_POINT = 0x30fc;

function isCodePointInRange(codePoint: number, [min, max]: CodepointRange): boolean {
  return codePoint >= min && codePoint <= max;
}

function isCodePointInRanges(codePoint: number, ranges: CodepointRange[]): boolean {
  for (const [min, max] of ranges) {
    if (codePoint >= min && codePoint <= max) return true;
  }
  return false;
}

function isCodePointKana(codePoint: number): boolean {
  return isCodePointInRanges(codePoint, KANA_RANGES);
}

// Vowel that a long-vowel mark (ー) lengthens, keyed by the preceding kana.
const VOWEL_TO_KANA_MAPPING = new Map<string, string>([
  ["a", "ぁあかがさざただなはばぱまゃやらゎわヵァアカガサザタダナハバパマャヤラヮワヵヷ"],
  ["i", "ぃいきぎしじちぢにひびぴみりゐィイキギシジチヂニヒビピミリヰヸ"],
  ["u", "ぅうくぐすずっつづぬふぶぷむゅゆるゥウクグスズッツヅヌフブプムュユルヴ"],
  ["e", "ぇえけげせぜてでねへべぺめれゑヶェエケゲセゼテデネヘベペメレヱヶヹ"],
  ["o", "ぉおこごそぞとどのほぼぽもょよろをォオコゴソゾトドノホボポモョヨロヲヺ"],
  ["", "のノ"],
]);

const KANA_TO_VOWEL_MAPPING = new Map<string, string>();
for (const [vowel, characters] of VOWEL_TO_KANA_MAPPING) {
  for (const character of characters) KANA_TO_VOWEL_MAPPING.set(character, vowel);
}

function getProlongedHiragana(previousCharacter: string): string | null {
  switch (KANA_TO_VOWEL_MAPPING.get(previousCharacter)) {
    case "a":
      return "あ";
    case "i":
      return "い";
    case "u":
      return "う";
    case "e":
      return "え";
    case "o":
      return "う";
    default:
      return null;
  }
}

/** Folds katakana onto hiragana so the reading and term-kana compare equal. */
function convertKatakanaToHiragana(text: string, keepProlongedSoundMarks = false): string {
  let result = "";
  const offset = HIRAGANA_CONVERSION_RANGE[0] - KATAKANA_CONVERSION_RANGE[0];
  for (let char of text) {
    const codePoint = char.codePointAt(0) as number;
    switch (codePoint) {
      case KATAKANA_SMALL_KA_CODE_POINT:
      case KATAKANA_SMALL_KE_CODE_POINT:
        break; // no hiragana equivalent
      case KANA_PROLONGED_SOUND_MARK_CODE_POINT:
        if (!keepProlongedSoundMarks && result.length > 0) {
          const char2 = getProlongedHiragana(result[result.length - 1]);
          if (char2 !== null) char = char2;
        }
        break;
      default:
        if (isCodePointInRange(codePoint, KATAKANA_CONVERSION_RANGE)) {
          char = String.fromCodePoint(codePoint + offset);
        }
        break;
    }
    result += char;
  }
  return result;
}

function createFuriganaSegment(text: string, reading: string): FuriganaSegment {
  return { text, reading };
}

/** Splits a same-length kana run into matched (no furigana) / differing (furigana) parts. */
function getFuriganaKanaSegments(text: string, reading: string): FuriganaSegment[] {
  const textLength = text.length;
  const newSegments: FuriganaSegment[] = [];
  let start = 0;
  let state = reading[0] === text[0];
  for (let i = 1; i < textLength; ++i) {
    const newState = reading[i] === text[i];
    if (state === newState) continue;
    newSegments.push(createFuriganaSegment(text.substring(start, i), state ? "" : reading.substring(start, i)));
    state = newState;
    start = i;
  }
  newSegments.push(createFuriganaSegment(text.substring(start, textLength), state ? "" : reading.substring(start, textLength)));
  return newSegments;
}

/** Recursively assigns slices of `reading` to each kana/kanji group; null if ambiguous. */
function segmentizeFurigana(reading: string, readingNormalized: string, groups: FuriganaGroup[], groupsStart: number): FuriganaSegment[] | null {
  const groupCount = groups.length - groupsStart;
  if (groupCount <= 0) {
    return reading.length === 0 ? [] : null;
  }

  const group = groups[groupsStart];
  const { isKana, text } = group;
  const textLength = text.length;
  if (isKana) {
    const { textNormalized } = group;
    if (textNormalized !== null && readingNormalized.startsWith(textNormalized)) {
      const segments = segmentizeFurigana(reading.substring(textLength), readingNormalized.substring(textLength), groups, groupsStart + 1);
      if (segments !== null) {
        if (reading.startsWith(text)) {
          segments.unshift(createFuriganaSegment(text, ""));
        } else {
          segments.unshift(...getFuriganaKanaSegments(text, reading));
        }
        return segments;
      }
    }
    return null;
  } else {
    let result: FuriganaSegment[] | null = null;
    for (let i = reading.length; i >= textLength; --i) {
      const segments = segmentizeFurigana(reading.substring(i), readingNormalized.substring(i), groups, groupsStart + 1);
      if (segments !== null) {
        if (result !== null) {
          return null; // more than one way to split the tail; ambiguous
        }
        const segmentReading = reading.substring(0, i);
        segments.unshift(createFuriganaSegment(text, segmentReading));
        result = segments;
      }
      // There is only one way to segmentize the last non-kana group.
      if (groupCount === 1) break;
    }
    return result;
  }
}

/**
 * Distributes `reading` over `term`, returning segments where only the kanji
 * runs carry a (non-empty) reading. Falls back to a single whole-term segment
 * when the reading can't be aligned unambiguously.
 */
export function distributeFurigana(term: string, reading: string): FuriganaSegment[] {
  if (reading === term) {
    return [createFuriganaSegment(term, "")];
  }

  const groups: FuriganaGroup[] = [];
  let groupPre: FuriganaGroup | null = null;
  let isKanaPre: boolean | null = null;
  for (const c of term) {
    const codePoint = c.codePointAt(0) as number;
    const isKana = isCodePointKana(codePoint);
    if (isKana === isKanaPre) {
      (groupPre as FuriganaGroup).text += c;
    } else {
      groupPre = { isKana, text: c, textNormalized: null };
      groups.push(groupPre);
      isKanaPre = isKana;
    }
  }
  for (const group of groups) {
    if (group.isKana) group.textNormalized = convertKatakanaToHiragana(group.text);
  }

  const readingNormalized = convertKatakanaToHiragana(reading);
  const segments = segmentizeFurigana(reading, readingNormalized, groups, 0);
  if (segments !== null) return segments;

  // Fallback: whole-word ruby.
  return [createFuriganaSegment(term, reading)];
}
