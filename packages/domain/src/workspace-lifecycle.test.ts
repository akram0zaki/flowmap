import { describe, expect, it } from 'vitest';

import type { Command, CommandContext, WorkspaceState } from './command.js';
import { createWorkspace } from './handlers.js';
import { archiveWorkspace, restoreWorkspace } from './workspace-lifecycle.js';

const now = '2026-08-17T10:00:00.000Z';
const command: Command = {
  id: 'command',
  name: 'ArchiveWorkspace',
  workspaceId: 'workspace',
  payload: {},
  actorId: 'planner',
  issuedAt: now,
};
const context: CommandContext = {
  clock: { now: () => now, today: () => now.slice(0, 10) },
  ids: { next: () => 'event' },
  actorId: 'planner',
  role: 'PLANNER',
  nextSequence: 1,
};

function state(): WorkspaceState {
  const created = createWorkspace(
    { name: 'Portfolio', timezone: 'UTC', currentQuarterId: '2026-Q3' },
    command,
    context,
  );
  if (!created.ok) throw new Error('workspace should be valid');
  return {
    workspace: created.effects.changes[0]!.after as WorkspaceState['workspace'],
    teams: new Map(),
    teamQuarters: new Map(),
    commitments: new Map(),
    footprints: new Map(),
  };
}

describe('workspace archive', () => {
  it('archives only the workspace root so every relationship survives restoration', () => {
    const current = state();
    const archived = archiveWorkspace(current, {}, command, context);
    expect(archived).toMatchObject({ ok: true });
    if (!archived.ok) return;
    const archivedState = {
      ...current,
      workspace: archived.effects.changes[0]!.after as WorkspaceState['workspace'],
    };
    expect(archivedState.workspace.archivedAt).toBe(now);
    expect(restoreWorkspace(archivedState, {}, command, context)).toMatchObject({ ok: true });
  });
});
