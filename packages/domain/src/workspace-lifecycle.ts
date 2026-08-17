/** Workspace archive preserves the complete graph for a later restore. */

import type {
  Command,
  CommandContext,
  CommandResult,
  EntityChange,
  WorkspaceState,
} from './command.js';
import type { EntityKind } from './refs.js';
import { archivedChange, authorise, bumped, event, succeed, updated } from './handler-kit.js';

const RESTORE_MAPS = [
  ['teams', 'TEAM'],
  ['teamQuarters', 'TEAM_QUARTER'],
  ['commitments', 'COMMITMENT'],
  ['footprints', 'CAPACITY_FOOTPRINT'],
  ['products', 'PRODUCT_SERVICE'],
  ['productImpacts', 'PRODUCT_IMPACT'],
  ['dependencies', 'DEPENDENCY'],
  ['decisions', 'DECISION'],
  ['milestones', 'MILESTONE'],
  ['themes', 'THEME'],
  ['commitmentThemes', 'COMMITMENT_THEME'],
  ['externalLinks', 'EXTERNAL_LINK'],
  ['signalDispositions', 'SIGNAL_DISPOSITION'],
  ['scenarios', 'SCENARIO'],
  ['people', 'PERSON'],
] as const satisfies readonly [keyof WorkspaceState, EntityKind][];

export type RestoreReport = {
  readonly snapshot: {
    readonly name: string;
    readonly createdAt: string;
    readonly workspaceRevision: number;
    readonly schemaVersion: number;
  };
  readonly counts: Readonly<
    Record<string, { readonly added: number; readonly removed: number; readonly changed: number }>
  >;
  readonly eventsSinceSnapshot: number;
};

export function restoreReport(
  current: WorkspaceState,
  snapshot: WorkspaceState,
  name: string,
  createdAt: string,
  eventsSinceSnapshot: number,
): RestoreReport {
  const counts: Record<string, { added: number; removed: number; changed: number }> = {};
  for (const [key, kind] of RESTORE_MAPS) {
    const before = (current[key] as ReadonlyMap<string, unknown> | undefined) ?? new Map();
    const after = (snapshot[key] as ReadonlyMap<string, unknown> | undefined) ?? new Map();
    let added = 0,
      removed = 0,
      changed = 0;
    for (const [id, entity] of after) {
      if (!before.has(id)) added += 1;
      else if (JSON.stringify(before.get(id)) !== JSON.stringify(entity)) changed += 1;
    }
    for (const id of before.keys()) if (!after.has(id)) removed++;
    counts[kind] = { added, removed, changed };
  }
  return {
    snapshot: {
      name,
      createdAt,
      workspaceRevision: snapshot.workspace.revision,
      schemaVersion: snapshot.workspace.schemaVersion,
    },
    counts,
    eventsSinceSnapshot,
  };
}

export function restoreWorkspaceSnapshot(
  current: WorkspaceState,
  snapshot: WorkspaceState,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  const changes: EntityChange[] = [];
  for (const [key, kind] of RESTORE_MAPS) {
    const before =
      (current[key] as ReadonlyMap<string, Record<string, unknown>> | undefined) ?? new Map();
    const after =
      (snapshot[key] as ReadonlyMap<string, Record<string, unknown>> | undefined) ?? new Map();
    for (const [id, entity] of after) {
      const previous = before.get(id);
      const ref = { kind, id } as EntityChange['ref'];
      if (!previous)
        changes.push({
          ref,
          op: 'CREATE',
          toVersion: 1,
          after: entity,
          changedFields: Object.keys(entity).sort(),
        });
      else if (JSON.stringify(previous) !== JSON.stringify(entity))
        changes.push(updated(ref, previous, entity));
    }
    for (const [id, entity] of before)
      if (!after.has(id)) {
        const restored = bumped(
          { ...entity, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId },
          ctx,
        );
        changes.push(archivedChange({ kind, id } as EntityChange['ref'], entity, restored));
      }
  }
  const ref = { kind: 'WORKSPACE', id: current.workspace.id } as const;
  if (JSON.stringify(current.workspace) !== JSON.stringify(snapshot.workspace))
    changes.push(updated(ref, current.workspace, snapshot.workspace));
  return succeed({
    changes,
    events: [event(cmd, ctx, 0, 'SNAPSHOT_RESTORED', [ref], {})],
    affectedProjections: ['dependencyGraph', 'radar'],
  });
}

export function archiveWorkspace(
  state: WorkspaceState,
  _payload: Record<string, never>,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  if (state.workspace.archivedAt !== undefined)
    return succeed({ changes: [], events: [], affectedProjections: [] });
  const after = bumped(
    { ...state.workspace, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId },
    ctx,
  );
  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [archivedChange(ref, state.workspace, after)],
    events: [event(cmd, ctx, 0, 'WORKSPACE_ARCHIVED', [ref], { name: state.workspace.name })],
    affectedProjections: [],
  });
}

export function restoreWorkspace(
  state: WorkspaceState,
  _payload: Record<string, never>,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  if (state.workspace.archivedAt === undefined)
    return succeed({ changes: [], events: [], affectedProjections: [] });
  const { archivedAt: _archivedAt, archivedBy: _archivedBy, ...live } = state.workspace;
  const after = bumped(live, ctx);
  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [{ ...updated(ref, state.workspace, after), op: 'RESTORE' }],
    events: [event(cmd, ctx, 0, 'WORKSPACE_RESTORED', [ref], { name: state.workspace.name })],
    affectedProjections: [],
  });
}
