/**
 * The rule catalogue.
 *
 * Rules are code-defined. There is no scripting, no expression language, and no
 * user-authored rule logic — a security decision as much as a product one
 * (spec 04 §7). A workspace tunes thresholds and can switch advisory rules off;
 * it cannot write new ones.
 */

import { CAPACITY_RULES } from './rules/capacity.js';
import { DEPENDENCY_RULES } from './rules/dependency.js';
import { TIMING_RULES } from './rules/timing.js';
import { HEALTH_RULES, READINESS_RULES } from './rules/readiness.js';
import { PRODUCT_RULES } from './rules/product.js';
import { INTEGRITY_RULES } from './rules/integrity.js';
import { RULE_CODES, type Rule, type RuleCode } from './types.js';

export const ALL_RULES: readonly Rule[] = [
  ...CAPACITY_RULES,
  ...DEPENDENCY_RULES,
  ...TIMING_RULES,
  ...READINESS_RULES,
  ...HEALTH_RULES,
  ...PRODUCT_RULES,
  ...INTEGRITY_RULES,
];

export const RULES_BY_CODE: ReadonlyMap<RuleCode, Rule> = new Map(
  ALL_RULES.map((rule) => [rule.code, rule]),
);

/**
 * Codes declared in `RULE_CODES` with no implementation behind them.
 *
 * Asserted empty by a test. History rules are the deliberate exception — they
 * evaluate against closed-quarter reviews, which arrive with quarter close in
 * M5 — so they are absent from `RULE_CODES` rather than listed and unimplemented.
 */
export function missingImplementations(): RuleCode[] {
  return RULE_CODES.filter((code) => !RULES_BY_CODE.has(code));
}

export {
  CAPACITY_RULES,
  DEPENDENCY_RULES,
  TIMING_RULES,
  READINESS_RULES,
  HEALTH_RULES,
  PRODUCT_RULES,
  INTEGRITY_RULES,
};
