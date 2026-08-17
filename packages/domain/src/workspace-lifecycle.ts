/** Workspace archive preserves the complete graph for a later restore. */

import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
import { archivedChange, authorise, bumped, event, succeed, updated } from './handler-kit.js';

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
