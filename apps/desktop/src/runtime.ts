/**
 * Runtime selection.
 *
 * Two targets, one contract:
 *
 *   - **Desktop (Tauri).** SQLite through the Rust layer, real files, native
 *     menus. The product.
 *   - **Browser.** An in-process repository persisted to localStorage. A
 *     development and demo target, not a distribution channel — shared storage
 *     and OS-secure storage only exist in the shell (docs/spec/12 §3).
 *
 * Reloading the page is a genuine restart in both, which is what makes the
 * persistence workflow test meaningful against either.
 */

import { MemoryWorkspaceRepository, localStoragePersistence } from '@flowmap/storage';

import type { Runtime } from './state/workspace-store.js';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

let counter = 0;

/** ULID-shaped, monotonic, and unique per process. */
function newId(): string {
  counter += 1;
  const time = Date.now().toString(32).toUpperCase().padStart(10, '0');
  const seq = counter.toString(32).toUpperCase().padStart(6, '0');
  const rand = Math.floor(Math.random() * 0x40000000)
    .toString(32)
    .toUpperCase()
    .padStart(6, '0');
  return `${time}${seq}${rand}`.slice(0, 26).padEnd(26, '0');
}

export async function createRuntime(): Promise<Runtime> {
  if (isTauri()) {
    const { createTauriRuntime } = await import('./tauri-runtime.js');
    return createTauriRuntime({ now: () => new Date().toISOString(), newId });
  }

  return {
    repository: new MemoryWorkspaceRepository(localStoragePersistence()),
    now: () => new Date().toISOString(),
    newId,
  };
}
