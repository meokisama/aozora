/**
 * Japanese deinflection — thin wrapper over the ported Yomitan language
 * transformer.
 *
 * The hover dictionary takes the text run at the cursor and, for each prefix,
 * walks it back to candidate dictionary forms (no tokenizer/MeCab — same
 * substring-scan + rule approach Yomitan uses). This module owns a single
 * configured transformer instance and exposes the two things the lookup needs:
 * the candidate forms (with grammatical conditions, for part-of-speech
 * validation against each dictionary entry) and the human-readable inflection
 * reason for each candidate.
 *
 * The engine, rules and condition system are GPL-3.0 code ported from Yomitan
 * (see src/lib/dictionary/transforms/). Pure, layout-independent logic.
 */

import { LanguageTransformer } from "./transforms/language-transformer";
import { japaneseTransforms } from "./transforms/japanese-transforms";
import type { TransformedText } from "./transforms/types";

const transformer = new LanguageTransformer();
transformer.addDescriptor(japaneseTransforms);

/** Maps each transform id to its display name (e.g. "-te" → "-て"). */
const transformNames = new Map<string, string>(
  Object.entries(japaneseTransforms.transforms).map(([id, t]) => [id, t.name]),
);

export interface Deinflection {
  /** Candidate dictionary form to look up. */
  term: string;
  /** Grammatical condition flags of the candidate (0 = the uninflected source). */
  conditions: number;
  /** Inflection reasons applied, outermost (most recently stripped) first. */
  reasons: string[];
}

/** Turns a transform trace into outermost-first human-readable reason names. */
function traceToReasons(trace: TransformedText["trace"]): string[] {
  return trace.map((frame) => transformNames.get(frame.transform) ?? frame.transform);
}

/**
 * Returns every candidate dictionary form for a surface form, including the
 * surface form itself (conditions 0, no reasons). Each carries the grammatical
 * conditions the lookup uses to filter by part of speech.
 */
export function deinflect(word: string): Deinflection[] {
  return transformer.transform(word).map((t) => ({
    term: t.text,
    conditions: t.conditions,
    reasons: traceToReasons(t.trace),
  }));
}

/** Resolves a dictionary entry's part-of-speech tags to condition flags. */
export function conditionFlagsForPartsOfSpeech(partsOfSpeech: string[]): number {
  return transformer.getConditionFlagsFromPartsOfSpeech(partsOfSpeech);
}

/** True if a candidate's conditions are compatible with a dictionary entry's POS flags. */
export function conditionsMatch(candidateConditions: number, definitionConditions: number): boolean {
  return LanguageTransformer.conditionsMatch(candidateConditions, definitionConditions);
}
