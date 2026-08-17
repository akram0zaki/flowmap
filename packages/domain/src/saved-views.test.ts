import { describe, expect, it } from 'vitest';

import type { Command, CommandContext, WorkspaceState } from './command.js';
import { createWorkspace } from './handlers.js';
import { removeSavedView, saveView } from './saved-views.js';

const now = '2026-08-17T10:00:00.000Z';
const command: Command = {
  id: 'command',
  name: 'SaveView',
  workspaceId: 'workspace',
  payload: {},
  actorId: 'planner',
  issuedAt: now,
};
const context: CommandContext = {
  clock: { now: () => now, today: () => now.slice(0, 10) },
  ids: { next: () => 'view' },
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

describe('saved views', () => {
  it('stores view state without portfolio entities', () => {
    const result = saveView(
      state(),
      { name: 'Capacity watch', lens: 'PORTFOLIO', filters: { quarters: ['2026-Q3'] } },
      command,
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.effects.changes[0]!.after as WorkspaceState['workspace']).settings.savedViews,
    ).toEqual([
      { id: 'view', name: 'Capacity watch', lens: 'PORTFOLIO', filters: { quarters: ['2026-Q3'] } },
    ]);
  });

  it('rejects duplicate names and permits removal', () => {
    const current = state();
    const saved = saveView(
      current,
      { name: 'Capacity watch', lens: 'PORTFOLIO', filters: {} },
      command,
      context,
    );
    if (!saved.ok) throw new Error('view should save');
    const withView = {
      ...current,
      workspace: saved.effects.changes[0]!.after as WorkspaceState['workspace'],
    };
    expect(
      saveView(withView, { name: 'capacity watch', lens: 'RADAR', filters: {} }, command, context),
    ).toMatchObject({ ok: false, error: { code: 'DUPLICATE_NAME' } });
    expect(removeSavedView(withView, { viewId: 'view' }, command, context)).toMatchObject({
      ok: true,
    });
  });
});
