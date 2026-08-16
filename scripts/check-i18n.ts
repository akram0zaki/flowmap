/**
 * i18n contract check. Run by `pnpm i18n:check` and by CI.
 *
 * Three things must hold:
 *   1. Every declared locale has every key that the default locale has.
 *   2. Every closed enum that the UI renders has a catalogue entry — the error
 *      codes, lifecycle states, classes, importances, impact types, reserve
 *      types, severities, and pattern ids.
 *   3. No key interpolates a placeholder the default locale does not use, so a
 *      translation cannot silently drop a number out of a sentence.
 *
 * Failing here is cheap. Shipping a blank string into a QBR is not.
 */

import {
  DOMAIN_ERROR_CODES,
  GATE_ADVISORIES,
  GATE_BLOCKERS,
  RELATIVE_SIZES,
  CONFIDENCE_VALUES,
} from '../packages/domain/src/index.js';
import {
  DEFAULT_LOCALE,
  NAMESPACES,
  SUPPORTED_LOCALES,
  allKeys,
  catalogues,
  type Locale,
} from '../packages/i18n/src/index.js';

const problems: string[] = [];

function report(message: string): void {
  problems.push(message);
}

// ── 1. Locale parity ───────────────────────────────────────────────────────

const referenceKeys = new Set(allKeys(DEFAULT_LOCALE));

for (const locale of SUPPORTED_LOCALES) {
  if (locale === DEFAULT_LOCALE) continue;
  const localeKeys = new Set(allKeys(locale as Locale));

  for (const key of referenceKeys) {
    if (!localeKeys.has(key)) report(`[${locale}] missing key: ${key}`);
  }
  for (const key of localeKeys) {
    if (!referenceKeys.has(key)) report(`[${locale}] unknown key not in ${DEFAULT_LOCALE}: ${key}`);
  }
}

// ── 2. Enum coverage ───────────────────────────────────────────────────────

const LIFECYCLES = ['IDEA', 'COMMITTED', 'IN_DELIVERY', 'ON_HOLD', 'DONE', 'DROPPED'];
const CLASSES = ['MANDATORY', 'STRATEGIC', 'OPERATIONAL', 'DISCRETIONARY'];
const IMPORTANCES = ['HIGH', 'MEDIUM', 'LOW'];
const IMPACTS = ['PRIMARY', 'MAJOR', 'MINOR', 'DEPENDENCY'];
const RESERVES = ['BAU_SUPPORT', 'LCM', 'OVERHEAD', 'REFINEMENT', 'HOLD', 'OTHER'];
const SEVERITIES = ['info', 'low', 'medium', 'high'];
const PATTERNS = ['reserve', 'refinement', 'hold', 'carryover', 'overflow', 'ghost', 'archived'];
const CHANGE_LOADS = ['LOW', 'MEDIUM', 'HIGH'];

const COVERAGE: readonly (readonly [string, string, readonly string[]])[] = [
  ['errors', '', DOMAIN_ERROR_CODES],
  // The gate's checklist is user-facing text; these were a type-only union, so
  // nothing checked they had messages at all and every one rendered as its code.
  ['errors', '', GATE_BLOCKERS],
  ['errors', '', GATE_ADVISORIES],
  ['common', 'lifecycle.', LIFECYCLES],
  ['common', 'class.', CLASSES],
  ['common', 'importance.', IMPORTANCES],
  ['common', 'confidence.', CONFIDENCE_VALUES],
  ['common', 'impact.', IMPACTS],
  ['common', 'reserve.', RESERVES],
  ['common', 'changeLoad.', CHANGE_LOADS],
  ['severity', '', SEVERITIES],
  ['patterns', '', PATTERNS],
];

for (const locale of SUPPORTED_LOCALES) {
  for (const [namespace, prefix, values] of COVERAGE) {
    const catalogue = catalogues[locale as Locale][namespace as (typeof NAMESPACES)[number]];
    for (const value of values) {
      if (catalogue[`${prefix}${value}`] === undefined) {
        report(`[${locale}] ${namespace}.${prefix}${value} has no message`);
      }
    }
  }
}

// RELATIVE_SIZES are rendered through the tooltip template, which takes {size}.
if (catalogues[DEFAULT_LOCALE].common['tooltip.size.title'] === undefined) {
  report(`[${DEFAULT_LOCALE}] common.tooltip.size.title has no message`);
}
if (RELATIVE_SIZES.length === 0) report('RELATIVE_SIZES is empty');

// ── 3. Placeholder parity ──────────────────────────────────────────────────

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Spec 06 §8 makes the tooltip format a hard requirement: a definition, what
 * the thing is *not*, and an example where one helps. Two of those are easy to
 * forget, and a field whose tooltip only defines it is exactly how teams invent
 * local meanings for "size" and "importance". So it is checked, not trusted.
 *
 * The example is optional; the definition and the disclaimer are not, for any
 * field in the categories the spec names.
 */
const TOOLTIP_REQUIRED: readonly string[] = [
  'lifecycle',
  'class',
  'importance',
  'units',
  'sizeConfidence',
  'scopeConfidence',
  'carryOver',
  'productImpact',
  'dependencyType',
  'dependencyStatus',
  'isHard',
  'attentionDate',
  'latestSafeStart',
  'capacityBaseline',
  'capacityAdjustment',
  'reserves',
  'deliverable',
  'utilisation',
  'overflow',
  'externalLink',
  'managementNote',
];

for (const locale of SUPPORTED_LOCALES) {
  const fields = catalogues[locale as Locale].fields;
  for (const field of TOOLTIP_REQUIRED) {
    for (const part of ['label', 'def', 'not'] as const) {
      if (!fields[`${field}.${part}`]) {
        report(`[${locale}] fields.${field} is missing its "${part}" — see spec 06 §8`);
      }
    }
  }
}

function placeholdersOf(template: string): Set<string> {
  return new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]!));
}

for (const namespace of NAMESPACES) {
  const reference = catalogues[DEFAULT_LOCALE][namespace];

  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    const catalogue = catalogues[locale as Locale][namespace];

    for (const [key, template] of Object.entries(reference)) {
      const localised = catalogue[key];
      if (localised === undefined) continue;

      const expected = placeholdersOf(template);
      const actual = placeholdersOf(localised);

      for (const name of expected) {
        if (!actual.has(name)) report(`[${locale}] ${namespace}.${key} drops {${name}}`);
      }
      for (const name of actual) {
        if (!expected.has(name)) report(`[${locale}] ${namespace}.${key} adds unknown {${name}}`);
      }
    }
  }
}

// ── Result ─────────────────────────────────────────────────────────────────

const keyCount = referenceKeys.size;

if (problems.length > 0) {
  process.stderr.write(`i18n check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) process.stderr.write(`  · ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `i18n check passed — ${keyCount} keys across ${NAMESPACES.length} namespaces, ` +
    `${SUPPORTED_LOCALES.length} locale(s): ${SUPPORTED_LOCALES.join(', ')}\n`,
);
