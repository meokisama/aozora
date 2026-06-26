/*
 * Copyright (C) 2024-2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// The deinflection engine, ported to TypeScript from Yomitan's
// language-transformer.js. Reduced to the single-language case (Aozora only
// needs Japanese), so the language parameter and MultiLanguageTransformer
// wrapper are dropped; otherwise the algorithm is unchanged.

import type { ConditionMapEntries, InternalRule, InternalTransform, LanguageTransformDescriptor, Trace, TraceFrame, TransformedText } from "./types";

export class LanguageTransformer {
  private _nextFlagIndex = 0;
  private _transforms: InternalTransform[] = [];
  private _conditionTypeToConditionFlagsMap = new Map<string, number>();
  private _partOfSpeechToConditionFlagsMap = new Map<string, number>();

  clear(): void {
    this._nextFlagIndex = 0;
    this._transforms = [];
    this._conditionTypeToConditionFlagsMap.clear();
    this._partOfSpeechToConditionFlagsMap.clear();
  }

  addDescriptor(descriptor: LanguageTransformDescriptor): void {
    const { conditions, transforms } = descriptor;
    const conditionEntries = Object.entries(conditions) as ConditionMapEntries;
    const { conditionFlagsMap, nextFlagIndex } = this._getConditionFlagsMap(conditionEntries, this._nextFlagIndex);

    const transforms2: InternalTransform[] = [];

    for (const [transformId, transform] of Object.entries(transforms)) {
      const { name, description, rules } = transform;
      const rules2: InternalRule[] = [];
      for (let j = 0, jj = rules.length; j < jj; ++j) {
        const { type, isInflected, deinflect, conditionsIn, conditionsOut } = rules[j];
        const conditionFlagsIn = this._getConditionFlagsStrict(conditionFlagsMap, conditionsIn);
        if (conditionFlagsIn === null) {
          throw new Error(`Invalid conditionsIn for transform ${transformId}.rules[${j}]`);
        }
        const conditionFlagsOut = this._getConditionFlagsStrict(conditionFlagsMap, conditionsOut);
        if (conditionFlagsOut === null) {
          throw new Error(`Invalid conditionsOut for transform ${transformId}.rules[${j}]`);
        }
        rules2.push({ type, isInflected, deinflect, conditionsIn: conditionFlagsIn, conditionsOut: conditionFlagsOut });
      }
      const isInflectedTests = rules.map((rule) => rule.isInflected);
      const heuristic = new RegExp(isInflectedTests.map((regExp) => regExp.source).join("|"));
      transforms2.push({ id: transformId, name, description, rules: rules2, heuristic });
    }

    this._nextFlagIndex = nextFlagIndex;
    for (const transform of transforms2) {
      this._transforms.push(transform);
    }

    for (const [type, { isDictionaryForm }] of conditionEntries) {
      const flags = conditionFlagsMap.get(type);
      if (typeof flags === "undefined") {
        continue;
      } // This case should never happen
      this._conditionTypeToConditionFlagsMap.set(type, flags);
      if (isDictionaryForm) {
        this._partOfSpeechToConditionFlagsMap.set(type, flags);
      }
    }
  }

  getConditionFlagsFromPartsOfSpeech(partsOfSpeech: string[]): number {
    return this._getConditionFlags(this._partOfSpeechToConditionFlagsMap, partsOfSpeech);
  }

  getConditionFlagsFromConditionTypes(conditionTypes: string[]): number {
    return this._getConditionFlags(this._conditionTypeToConditionFlagsMap, conditionTypes);
  }

  getConditionFlagsFromConditionType(conditionType: string): number {
    return this._getConditionFlags(this._conditionTypeToConditionFlagsMap, [conditionType]);
  }

  transform(sourceText: string): TransformedText[] {
    const results = [LanguageTransformer.createTransformedText(sourceText, 0, [])];
    for (let i = 0; i < results.length; ++i) {
      const { text, conditions, trace } = results[i];
      for (const transform of this._transforms) {
        if (!transform.heuristic.test(text)) {
          continue;
        }

        const { id, rules } = transform;
        for (let j = 0, jj = rules.length; j < jj; ++j) {
          const rule = rules[j];
          if (!LanguageTransformer.conditionsMatch(conditions, rule.conditionsIn)) {
            continue;
          }
          const { isInflected, deinflect } = rule;
          if (!isInflected.test(text)) {
            continue;
          }

          const isCycle = trace.some((frame) => frame.transform === id && frame.ruleIndex === j && frame.text === text);
          if (isCycle) {
            console.warn(new Error(`Cycle detected in transform[${id}] rule[${j}] for text: ${text}`));
            continue;
          }

          results.push(
            LanguageTransformer.createTransformedText(
              deinflect(text),
              rule.conditionsOut,
              this._extendTrace(trace, { transform: id, ruleIndex: j, text }),
            ),
          );
        }
      }
    }
    return results;
  }

  static createTransformedText(text: string, conditions: number, trace: Trace): TransformedText {
    return { text, conditions, trace };
  }

  /**
   * If `currentConditions` is `0`, then `nextConditions` is ignored and `true` is returned.
   * Otherwise, there must be at least one shared condition between `currentConditions` and `nextConditions`.
   */
  static conditionsMatch(currentConditions: number, nextConditions: number): boolean {
    return currentConditions === 0 || (currentConditions & nextConditions) !== 0;
  }

  private _getConditionFlagsMap(
    conditions: ConditionMapEntries,
    nextFlagIndex: number,
  ): { conditionFlagsMap: Map<string, number>; nextFlagIndex: number } {
    const conditionFlagsMap = new Map<string, number>();
    let targets: ConditionMapEntries = conditions;
    while (targets.length > 0) {
      const nextTargets: ConditionMapEntries = [];
      for (const target of targets) {
        const [type, condition] = target;
        const { subConditions } = condition;
        let flags: number;
        if (typeof subConditions === "undefined") {
          if (nextFlagIndex >= 32) {
            // Flags >= 32 don't work because JavaScript only supports up to 32-bit integer operations
            throw new Error("Maximum number of conditions was exceeded");
          }
          flags = 1 << nextFlagIndex;
          ++nextFlagIndex;
        } else {
          const multiFlags = this._getConditionFlagsStrict(conditionFlagsMap, subConditions);
          if (multiFlags === null) {
            nextTargets.push(target);
            continue;
          } else {
            flags = multiFlags;
          }
        }
        conditionFlagsMap.set(type, flags);
      }
      if (nextTargets.length === targets.length) {
        // Cycle in subRule declaration
        throw new Error("Maximum number of conditions was exceeded");
      }
      targets = nextTargets;
    }
    return { conditionFlagsMap, nextFlagIndex };
  }

  private _getConditionFlagsStrict(conditionFlagsMap: Map<string, number>, conditionTypes: string[]): number | null {
    let flags = 0;
    for (const conditionType of conditionTypes) {
      const flags2 = conditionFlagsMap.get(conditionType);
      if (typeof flags2 === "undefined") {
        return null;
      }
      flags |= flags2;
    }
    return flags;
  }

  private _getConditionFlags(conditionFlagsMap: Map<string, number>, conditionTypes: string[]): number {
    let flags = 0;
    for (const conditionType of conditionTypes) {
      let flags2 = conditionFlagsMap.get(conditionType);
      if (typeof flags2 === "undefined") {
        flags2 = 0;
      }
      flags |= flags2;
    }
    return flags;
  }

  private _extendTrace(trace: Trace, newFrame: TraceFrame): Trace {
    const newTrace = [newFrame];
    for (const { transform, ruleIndex, text } of trace) {
      newTrace.push({ transform, ruleIndex, text });
    }
    return newTrace;
  }
}
