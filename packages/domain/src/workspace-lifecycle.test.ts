import { describe, expect, it } from 'vitest';

import type { Command, CommandContext, WorkspaceState } from './command.js';
import { createWorkspace } from './handlers.js';
import { archiveWorkspace, restoreReport, restoreWorkspace } from './workspace-lifecycle.js';

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

  it('reports restore changes before a command is applied', () => {
    const before = state();
    const snapshot = {
      ...before,
      teams: new Map([['team', { id: 'team' }]]),
    } as unknown as WorkspaceState;
    expect(restoreReport(before, snapshot, 'Snapshot', now, 2)).toMatchObject({
      snapshot: { name: 'Snapshot', workspaceRevision: 1 },
      counts: { TEAM: { added: 1, removed: 0, changed: 0 } },
      eventsSinceSnapshot: 2,
    });
  });
});
