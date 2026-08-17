/**
 * Field-level merge for sync.
 *
 * Non-overlapping field changes merge automatically. Overlapping field changes
 * are never silently overwritten — they become conflict rows. A remote
 * tombstone always wins a concurrent local update.
 *
 * See docs/spec/07-persistence-sync.md §5 and §7.
 */

import { diffFields } from '@flowmap/domain';

/** Structurally coupled fields: a change on either side is a whole-entity conflict. */
export const WHOLE_ENTITY_FIELDS: ReadonlySet<string> = new Set([
  'reserves',
  'settings',
  'commands',
  'outcomes',
]);

export type FieldConflict = {
  readonly field: string;
  readonly localValue: unknown;
  readonly remoteValue: unknown;
};

export type MergeDecision =
  | { readonly kind: 'AUTO'; readonly merged: Record<string, unknown> }
  | { readonly kind: 'CONFLICT'; readonly fields: readonly FieldConflict[] }
  | { readonly kind: 'TOMBSTONE' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

/**
 * Compares a local mutation (captured against `baseSnapshot`) with the remote
 * entity as it is now. `localChanged` is the handler's `changedFields`.
 */
export function mergeEntity(input: {
  readonly baseSnapshot: unknown;
  readonly localPatch: unknown;
  readonly localChanged: readonly string[];
  readonly remoteEntity: unknown;
  readonly remoteDeleted: boolean;
}): MergeDecision {
  if (input.remoteDeleted) return { kind: 'TOMBSTONE' };

  const remote = isRecord(input.remoteEntity) ? input.remoteEntity : {};
  const local = isRecord(input.localPatch) ? input.localPatch : {};
  const base = isRecord(input.baseSnapshot) ? input.baseSnapshot : {};

  const remoteChanged = diffFields(base, remote);
  const localChanged = input.localChanged.filter((field) => !WHOLE_ENTITY_FIELDS.has(field));
  const localWhole = input.localChanged.filter((field) => WHOLE_ENTITY_FIELDS.has(field));
  const remoteWhole = remoteChanged.filter((field) => WHOLE_ENTITY_FIELDS.has(field));

  const overlap = new Set(localChanged.filter((field) => remoteChanged.includes(field)));
  for (const field of localWhole) {
    if (remoteWhole.includes(field) || remoteChanged.includes(field)) overlap.add(field);
  }
  for (const field of remoteWhole) {
    if (localWhole.includes(field) || input.localChanged.includes(field)) overlap.add(field);
  }

  if (overlap.size === 0) {
    return {
      kind: 'AUTO',
      merged: { ...remote, ...pick(local, input.localChanged) },
    };
  }

  return {
    kind: 'CONFLICT',
    fields: [...overlap].sort().map((field) => ({
      field,
      localValue: local[field],
      remoteValue: remote[field],
    })),
  };
}
