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

// Rule-builder helpers, ported to TypeScript from Yomitan's language-transforms.js.

import type { Rule, SuffixRule } from "./types";

export function suffixInflection<TCondition extends string>(
  inflectedSuffix: string,
  deinflectedSuffix: string,
  conditionsIn: TCondition[],
  conditionsOut: TCondition[],
): SuffixRule<TCondition> {
  const suffixRegExp = new RegExp(inflectedSuffix + "$");
  return {
    type: "suffix",
    isInflected: suffixRegExp,
    deinflected: deinflectedSuffix,
    deinflect: (text) => text.slice(0, -inflectedSuffix.length) + deinflectedSuffix,
    conditionsIn,
    conditionsOut,
  };
}

export function prefixInflection<TCondition extends string>(
  inflectedPrefix: string,
  deinflectedPrefix: string,
  conditionsIn: TCondition[],
  conditionsOut: TCondition[],
): Rule<TCondition> {
  const prefixRegExp = new RegExp("^" + inflectedPrefix);
  return {
    type: "prefix",
    isInflected: prefixRegExp,
    deinflect: (text) => deinflectedPrefix + text.slice(inflectedPrefix.length),
    conditionsIn,
    conditionsOut,
  };
}

export function wholeWordInflection<TCondition extends string>(
  inflectedWord: string,
  deinflectedWord: string,
  conditionsIn: TCondition[],
  conditionsOut: TCondition[],
): Rule<TCondition> {
  const regex = new RegExp("^" + inflectedWord + "$");
  return {
    type: "wholeWord",
    isInflected: regex,
    deinflect: () => deinflectedWord,
    conditionsIn,
    conditionsOut,
  };
}
