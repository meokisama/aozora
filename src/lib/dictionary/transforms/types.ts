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

// Types for the language-transformer deinflection engine, ported to TypeScript
// from Yomitan's language-transformer.d.ts / language-transformer-internal.d.ts.

// --- Descriptor (authoring) shapes -----------------------------------------

export type LanguageTransformDescriptor<TCondition extends string = string> = {
  language: string;
  conditions: ConditionMapObject<TCondition>;
  transforms: TransformMapObject<TCondition>;
};

export type ConditionMapObject<TCondition extends string> = {
  [type in TCondition]: Condition;
};

export type ConditionMapEntry = [type: string, condition: Condition];
export type ConditionMapEntries = ConditionMapEntry[];

export type Condition = {
  name: string;
  isDictionaryForm: boolean;
  i18n?: RuleI18n[];
  subConditions?: string[];
};

export type RuleI18n = {
  language: string;
  name: string;
};

export type TransformMapObject<TCondition> = {
  [name: string]: Transform<TCondition>;
};

export type Transform<TCondition> = {
  name: string;
  description?: string;
  i18n?: TransformI18n[];
  rules: Rule<TCondition>[];
};

export type TransformI18n = {
  language: string;
  name: string;
  description?: string;
};

export type DeinflectFunction = (inflectedWord: string) => string;

export type Rule<TCondition = string> = {
  type: "suffix" | "prefix" | "wholeWord" | "other";
  isInflected: RegExp; // if it matches, deinflection is attempted
  deinflect: DeinflectFunction;
  conditionsIn: TCondition[];
  conditionsOut: TCondition[];
};

export type SuffixRule<TCondition = string> = {
  type: "suffix";
  isInflected: RegExp;
  deinflected: string;
  deinflect: DeinflectFunction;
  conditionsIn: TCondition[];
  conditionsOut: TCondition[];
};

// --- Internal (compiled) shapes --------------------------------------------

export type InternalTransform = {
  id: string;
  name: string;
  rules: InternalRule[];
  heuristic: RegExp;
  description?: string;
};

export type InternalRule = {
  type: "suffix" | "prefix" | "wholeWord" | "other";
  isInflected: RegExp;
  deinflect: (inflectedWord: string) => string;
  conditionsIn: number;
  conditionsOut: number;
};

export type TransformedText = {
  text: string;
  conditions: number;
  trace: Trace;
};

export type Trace = TraceFrame[];

export type TraceFrame = {
  text: string;
  transform: string;
  ruleIndex: number;
};
