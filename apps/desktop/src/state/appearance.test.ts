// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyAppearance,
  clearStoredAppearance,
  readStoredAppearance,
  resolveAppearance,
  writeStoredAppearance,
} from './appearance.js';

afterEach(() => {
  clearStoredAppearance();
  document.documentElement.removeAttribute('data-theme');
});

describe('appearance', () => {
  it('remembers an explicit light or dark choice', () => {
    expect(readStoredAppearance()).toBeNull();
    writeStoredAppearance('dark');
    expect(readStoredAppearance()).toBe('dark');
  });

  it('applies data-theme so the token cascade switches', () => {
    applyAppearance('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyAppearance('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('resolves an unset choice from the stored value first', () => {
    expect(resolveAppearance('dark')).toBe('dark');
    expect(resolveAppearance('light')).toBe('light');
  });
});
