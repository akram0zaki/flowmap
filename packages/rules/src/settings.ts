/**
 * Rule settings and their validation — docs/spec/04-rules-radar.md §7.
 *
 * Every threshold has a permitted range, and an out-of-range value is rejected
 * *with the range in the error* rather than silently clamped. Silent clamping
 * is how a lead ends up believing they set a threshold to 400 and wondering why
 * nothing changed.
 */

import { RULES_BY_CODE } from './catalogue.js';
import {
  NO_RULE_SETTINGS,
  SEVERITY_ORDER,
  compareSeverity,
  type RuleCode,
  type RuleSettings,
  type Severity,
} from './types.js';

export type SettingsProblem =
  | {
      readonly kind: 'UNKNOWN_RULE';
      readonly ruleCode: string;
    }
  | {
      readonly kind: 'UNKNOWN_THRESHOLD';
      readonly ruleCode: RuleCode;
      readonly name: string;
    }
  | {
      readonly kind: 'OUT_OF_RANGE';
      readonly ruleCode: RuleCode;
      readonly name: string;
      readonly value: number;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: 'CANNOT_DISABLE';
      readonly ruleCode: RuleCode;
    }
  | {
      readonly kind: 'CANNOT_RAISE_SEVERITY';
      readonly ruleCode: RuleCode;
      readonly requested: Severity;
      readonly ceiling: Severity;
    };

/**
 * Checks a settings object against the catalogue.
 *
 * Returns every problem rather than the first, so a settings screen can mark
 * all the offending fields at once instead of making the user discover them one
 * save at a time.
 */
export function validateSettings(settings: RuleSettings): SettingsProblem[] {
  const problems: SettingsProblem[] = [];

  for (const [code, disabled] of Object.entries(settings.enabled)) {
    const rule = RULES_BY_CODE.get(code as RuleCode);
    if (!rule) {
      problems.push({ kind: 'UNKNOWN_RULE', ruleCode: code });
      continue;
    }
    // Integrity and high-severity capacity rules stay on. A workspace that
    // could hide its own overflow is not a workspace anyone can plan with.
    if (disabled === false && !rule.canDisable) {
      problems.push({ kind: 'CANNOT_DISABLE', ruleCode: rule.code });
    }
  }

  for (const [code, thresholds] of Object.entries(settings.thresholds)) {
    const rule = RULES_BY_CODE.get(code as RuleCode);
    if (!rule) {
      problems.push({ kind: 'UNKNOWN_RULE', ruleCode: code });
      continue;
    }

    for (const [name, value] of Object.entries(thresholds ?? {})) {
      const range = rule.ranges?.[name];
      if (!range) {
        problems.push({ kind: 'UNKNOWN_THRESHOLD', ruleCode: rule.code, name });
        continue;
      }
      const [min, max] = range;
      if (!Number.isFinite(value) || value < min || value > max) {
        problems.push({ kind: 'OUT_OF_RANGE', ruleCode: rule.code, name, value, min, max });
      }
    }
  }

  for (const [code, severity] of Object.entries(settings.severityOverrides)) {
    const rule = RULES_BY_CODE.get(code as RuleCode);
    if (!rule) {
      problems.push({ kind: 'UNKNOWN_RULE', ruleCode: code });
      continue;
    }
    if (severity && compareSeverity(severity, rule.severity) > 0) {
      problems.push({
        kind: 'CANNOT_RAISE_SEVERITY',
        ruleCode: rule.code,
        requested: severity,
        ceiling: rule.severity,
      });
    }
  }

  return problems;
}

/** What the settings screen renders per rule: definition, current value, range. */
export type RuleSetting = {
  readonly code: RuleCode;
  readonly category: string;
  readonly severity: Severity;
  readonly canDisable: boolean;
  readonly enabled: boolean;
  readonly thresholds: ReadonlyArray<{
    readonly name: string;
    readonly value: number;
    readonly defaultValue: number;
    readonly min: number;
    readonly max: number;
    readonly isDefault: boolean;
  }>;
  readonly severityOverride?: Severity;
};

export function describeSettings(settings: RuleSettings): RuleSetting[] {
  return [...RULES_BY_CODE.values()].map((rule) => {
    const overrides = settings.thresholds[rule.code] ?? {};

    return {
      code: rule.code,
      category: rule.category,
      severity: settings.severityOverrides[rule.code] ?? rule.severity,
      canDisable: rule.canDisable,
      enabled: !rule.canDisable || settings.enabled[rule.code] !== false,
      thresholds: Object.entries(rule.defaults ?? {}).map(([name, defaultValue]) => {
        const range = rule.ranges?.[name] ?? ([defaultValue, defaultValue] as const);
        const value = overrides[name] ?? defaultValue;
        return {
          name,
          value,
          defaultValue,
          min: range[0],
          max: range[1],
          isDefault: value === defaultValue,
        };
      }),
      ...(settings.severityOverrides[rule.code]
        ? { severityOverride: settings.severityOverrides[rule.code]! }
        : {}),
    };
  });
}

/** Reset one rule to its defaults, leaving every other rule alone. */
export function resetRule(settings: RuleSettings, code: RuleCode): RuleSettings {
  const thresholds = { ...settings.thresholds };
  const enabled = { ...settings.enabled };
  const severityOverrides = { ...settings.severityOverrides };
  delete thresholds[code];
  delete enabled[code];
  delete severityOverrides[code];
  return { thresholds, enabled, severityOverrides };
}

export function resetAll(): RuleSettings {
  return NO_RULE_SETTINGS;
}

/** Every severity a rule may be lowered to, for the settings dropdown. */
export function allowedSeverities(code: RuleCode): Severity[] {
  const rule = RULES_BY_CODE.get(code);
  if (!rule) return [];
  return SEVERITY_ORDER.filter((severity) => compareSeverity(severity, rule.severity) <= 0);
}
