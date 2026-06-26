/**
 * Japanese deinflection — thin wrapper over the ported Yomitan language
 * transformer (substring-scan + rule approach, no tokenizer/MeCab). Owns one
 * configured transformer and exposes the candidate dictionary forms (with
 * grammatical conditions for POS validation) plus a readable inflection reason
 * per candidate. GPL-3.0 engine/rules from Yomitan (see transforms/).
 */

import { LanguageTransformer } from "./transforms/language-transformer";
import { japaneseTransforms } from "./transforms/japanese-transforms";
import type { TransformedText } from "./transforms/types";

const transformer = new LanguageTransformer();
transformer.addDescriptor(japaneseTransforms);

/** Maps each transform id to its display name (e.g. "-te" → "-て"). */
const transformNames = new Map<string, string>(Object.entries(japaneseTransforms.transforms).map(([id, t]) => [id, t.name]));

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
