/**
 * Translation entry point for the app.
 *
 * Deliberately thin: the catalogue and the locale registry live in
 * `@flowmap/i18n` so the pure packages' keys (error codes, rule codes) can be
 * verified against it at build time by `pnpm i18n:check`.
 */

import { DEFAULT_LOCALE, translate, type Locale, type TranslateParams } from '@flowmap/i18n';

let current: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  current = locale;
}

export function locale(): Locale {
  return current;
}

/** Namespaced key, e.g. `capacity.units` resolves `common.capacity.units`. */
export function t(key: string, params: TranslateParams = {}): string {
  const namespaced = key.includes('.') && isNamespace(key.split('.')[0]!) ? key : `common.${key}`;
  const resolved = translate(current, namespaced, params);
  return resolved === namespaced ? key : resolved;
}

function isNamespace(candidate: string): boolean {
  return (
    candidate === 'common' ||
    candidate === 'errors' ||
    candidate === 'patterns' ||
    candidate === 'severity'
  );
}
