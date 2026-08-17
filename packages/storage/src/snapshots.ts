/** Snapshot serialisation is shared by storage backends and restore previews. */

import type { EntityId, WorkspaceState } from '@flowmap/domain';

const MAP_KEYS = [
  'teams',
  'teamQuarters',
  'commitments',
  'footprints',
  'products',
  'productImpacts',
  'dependencies',
  'decisions',
  'milestones',
  'themes',
  'commitmentThemes',
  'externalLinks',
  'signalDispositions',
  'scenarios',
  'people',
] as const;

export function snapshotState(content: unknown): WorkspaceState | null {
  if (!content || typeof content !== 'object') return null;
  const raw = content as Record<string, unknown>;
  if (!raw['workspace'] || typeof raw['workspace'] !== 'object') return null;
  const maps = Object.fromEntries(
    MAP_KEYS.map((key) => [
      key,
      new Map(
        Object.entries((raw[key] as Record<string, unknown> | undefined) ?? {}),
      ) as unknown as ReadonlyMap<EntityId, never>,
    ]),
  );
  return { workspace: raw['workspace'] as WorkspaceState['workspace'], ...maps } as WorkspaceState;
}
