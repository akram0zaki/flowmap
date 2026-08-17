import { describe, expect, it } from 'vitest';

import type { Command, CommandContext, WorkspaceState } from './command.js';
import { roleFor, setWorkspaceRole } from './workspace-users.js';
import { mayRunCommand } from './permissions.js';

const NOW = '2026-08-17T00:00:00Z';

function ctx(role: CommandContext['role'] = 'ADMIN'): CommandContext {
  return {
    clock: { now: () => NOW, today: () => '2026-08-17' },
    ids: { next: () => 'generated' },
    actorId: 'local:admin',
    role,
    nextSequence: 1,
  };
}

function command(name: string): Command {
  return {
    id: 'cmd',
    name,
    workspaceId: 'workspace',
    payload: {},
    actorId: 'local:admin',
    issuedAt: NOW,
  };
}

const emptyState = {
  workspace: { id: 'workspace' },
  teams: new Map(),
  teamQuarters: new Map(),
  commitments: new Map(),
  footprints: new Map(),
  workspaceUsers: new Map(),
} as unknown as WorkspaceState;

describe('roleFor', () => {
  it('defaults to planner when no users are recorded (local-only workspaces)', () => {
    expect(roleFor(emptyState, 'local:anyone')).toBe('PLANNER');
  });

  it('treats an unknown identity on a shared workspace as a viewer', () => {
    const state = {
      ...emptyState,
      workspaceUsers: new Map([
        [
          'u1',
          {
            id: 'u1',
            identitySubject: 'local:lead',
            displayName: 'Lead',
            role: 'PLANNER',
          },
        ],
      ]),
    } as unknown as WorkspaceState;
    expect(roleFor(state, 'local:lead')).toBe('PLANNER');
    expect(roleFor(state, 'local:stranger')).toBe('VIEWER');
  });
});

describe('setWorkspaceRole', () => {
  it('refuses anyone below admin', () => {
    const result = setWorkspaceRole(
      emptyState,
      { identitySubject: 'local:x', displayName: 'X', role: 'VIEWER' },
      command('SetWorkspaceRole'),
      ctx('PLANNER'),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHORISED' } });
  });

  it('records a role grant as a domain event', () => {
    const result = setWorkspaceRole(
      emptyState,
      { identitySubject: 'local:x', displayName: 'X', role: 'CONTRIBUTOR' },
      command('SetWorkspaceRole'),
      ctx('ADMIN'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.events[0]?.eventType).toBe('WORKSPACE_ROLE_SET');
    expect(result.effects.changes[0]?.after).toMatchObject({
      identitySubject: 'local:x',
      role: 'CONTRIBUTOR',
    });
  });
});

describe('command permission matrix', () => {
  it('keeps viewers out of every mutating catalog entry except radar dispositions and personal views', () => {
    expect(mayRunCommand('VIEWER', 'CreateIdea')).toBe(false);
    expect(mayRunCommand('VIEWER', 'PassCommitGate')).toBe(false);
    expect(mayRunCommand('VIEWER', 'ReviewSignal')).toBe(true);
    expect(mayRunCommand('CONTRIBUTOR', 'CreateIdea')).toBe(true);
    expect(mayRunCommand('CONTRIBUTOR', 'AssignCapacityFootprint')).toBe(false);
    expect(mayRunCommand('PLANNER', 'ReopenQuarter')).toBe(false);
    expect(mayRunCommand('ADMIN', 'SetWorkspaceRole')).toBe(true);
  });
});
