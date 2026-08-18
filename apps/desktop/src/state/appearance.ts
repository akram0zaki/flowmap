/**
 * Light / dark appearance.
 *
 * Tokens already carry both palettes (`data-theme` on <html>). This module
 * remembers an explicit choice and leaves the document on `system` until the
 * user toggles, so a first launch follows the OS.
 */

import { applyTheme, type ThemeMode } from '@flowmap/ui';

const STORAGE_KEY = 'flowmap.theme';
const memory = new Map<string, string>();

export type Appearance = 'light' | 'dark';

export function readStoredAppearance(): Appearance | null {
  const value = storageGet(STORAGE_KEY);
  if (value === 'light' || value === 'dark') return value;
  return null;
}

export function writeStoredAppearance(mode: Appearance): void {
  storageSet(STORAGE_KEY, mode);
}

export function clearStoredAppearance(): void {
  memory.delete(STORAGE_KEY);
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or tests without storage.
  }
}

function storageGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const value = localStorage.getItem(key);
      if (value !== null) return value;
    }
  } catch {
    // Fall through to the in-memory copy.
  }
  return memory.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
  memory.set(key, value);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // Private mode or tests without storage — memory still holds it.
  }
}

export function resolveAppearance(stored: Appearance | null): Appearance {
  if (stored) return stored;
  try {
    return globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyAppearance(mode: ThemeMode): void {
  const root = document.documentElement;
  applyTheme(root, {
    mode,
    contrast: root.getAttribute('data-contrast') === 'high' ? 'high' : 'normal',
    motion: root.getAttribute('data-motion') === 'reduced' ? 'reduced' : 'system',
    density: 'default',
    presentation: root.getAttribute('data-presentation') === 'on',
  });
}
