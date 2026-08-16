/**
 * Message catalogues.
 *
 * Every user-visible string in Flowmap is a key resolved here — including rule
 * messages, error messages, tooltips, and accessibility announcements. Nothing
 * authors prose in a component.
 *
 * The Pilot MVP ships `en` only, but the machinery is real from day one: adding
 * a locale is a data change, not a refactor, and `pnpm i18n:check` fails on any
 * key that is missing from a declared locale.
 *
 * Catalogues live here rather than in `apps/desktop` because the keys they
 * satisfy are declared by the pure packages (`DomainErrorCode`, rule codes), and
 * the checker verifies that contract at build time.
 */

import commonEn from './locales/en/common.json' with { type: 'json' };
import errorsEn from './locales/en/errors.json' with { type: 'json' };
import fieldsEn from './locales/en/fields.json' with { type: 'json' };
import patternsEn from './locales/en/patterns.json' with { type: 'json' };
import severityEn from './locales/en/severity.json' with { type: 'json' };

export const SUPPORTED_LOCALES = ['en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * `fields` is its own namespace because every entry there is part of a contract:
 * spec 06 §8 requires a definition, what the thing is not, and an example where
 * one helps, on every capacity, lifecycle, impact, dependency, attention and
 * confidence field. Keeping them apart is what lets the checker enforce it.
 */
export const NAMESPACES = ['common', 'errors', 'fields', 'patterns', 'severity'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export type Catalogue = Readonly<Record<string, string>>;

export const catalogues: Readonly<Record<Locale, Readonly<Record<Namespace, Catalogue>>>> = {
  en: {
    common: commonEn,
    errors: errorsEn,
    fields: fieldsEn,
    patterns: patternsEn,
    severity: severityEn,
  },
};

export type TranslateParams = Readonly<Record<string, string | number>>;

/**
 * Resolves a dotted key such as `errors.NOTE_TOO_LONG` and interpolates
 * `{placeholder}` parameters.
 *
 * A missing key returns the key itself rather than throwing: a missing string
 * must never take down a planning board mid-meeting. CI fails on missing keys,
 * so this path should be unreachable in a released build.
 *
 * Plurals: a key may carry a `.one` sibling, used when `count` or `units` is
 * exactly 1. That is enough for the locales shipped so far and keeps the choice
 * in the catalogue rather than in a component — "1 commitments" is a defect a
 * reader notices immediately. A locale with more plural categories than two
 * needs a real plural-rule selector here, not more branches at call sites.
 */
export function translate(locale: Locale, key: string, params: TranslateParams = {}): string {
  const separator = key.indexOf('.');
  if (separator === -1) return key;

  const namespace = key.slice(0, separator) as Namespace;
  const entryKey = key.slice(separator + 1);
  const catalogue = catalogues[locale]?.[namespace];
  const singular = params['count'] === 1 || params['units'] === 1;
  const template = (singular ? catalogue?.[`${entryKey}.one`] : undefined) ?? catalogue?.[entryKey];
  if (template === undefined) return key;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Every key present in a locale, as `namespace.key`. Used by the checker. */
export function allKeys(locale: Locale): string[] {
  const catalogue = catalogues[locale];
  return NAMESPACES.flatMap((namespace) =>
    Object.keys(catalogue[namespace]).map((key) => `${namespace}.${key}`),
  );
}
