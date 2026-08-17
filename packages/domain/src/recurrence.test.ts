import { describe, expect, it } from 'vitest';

import type { Command, CommandContext, WorkspaceState } from './command.js';
import { renewCommitment, setRecurrence } from './recurrence.js';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type Commitment,
  type Workspace,
} from './entities.js';

const now = '2026-10-01T09:00:00Z';
const ctx: CommandContext = {
  clock: { now: () => now, today: () => '2026-10-01' },
  ids: { next: () => 'new-id' },
  actorId: 'planner',
  role: 'CONTRIBUTOR',
  nextSequence: 1,
};
const cmd: Command = {
  id: 'command',
  name: 'test',
  workspaceId: 'workspace',
  payload: {},
  actorId: 'planner',
  issuedAt: now,
};
const env = (id: string) => ({
  id,
  workspaceId: 'workspace',
  schemaVersion: 1,
  entityVersion: 1,
  createdAt: now,
  createdBy: 'planner',
  updatedAt: now,
  updatedBy: 'planner',
});
const workspace: Workspace = {
  ...env('workspace'),
  name: 'Portfolio',
  timezone: 'Europe/Amsterdam',
  currentQuarterId: '2026-Q4',
  isSample: false,
  revision: 1,
  settings: {
    capacity: {
      defaultTeamQuarterCapacity: 100,
      sizeMapping: DEFAULT_SIZE_MAPPING,
      defaultReserves: DEFAULT_RESERVES,
    },
    changeLoad: DEFAULT_CHANGE_LOAD_SETTINGS,
    valueDrivers: DEFAULT_VALUE_DRIVERS,
    noteMaxLength: 2000,
    milestonesPerCommitment: 6,
  },
};
const state = (lifecycle: Commitment['lifecycle']): WorkspaceState => ({
  workspace,
  teams: new Map(),
  teamQuarters: new Map(),
  footprints: new Map(),
  commitments: new Map([
    [
      'commitment',
      {
        ...env('commitment'),
        name: 'Annual review',
        lifecycle,
        class: 'OPERATIONAL',
        importance: 'MEDIUM',
        valueDrivers: ['Resilience'],
      },
    ],
  ]),
});

describe('manual recurrence', () => {
  it('stores recurrence only as metadata', () => {
    const result = setRecurrence(
      state('COMMITTED'),
      { commitmentId: 'commitment', recurrence: { pattern: 'ANNUAL' } },
      cmd,
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.effects.changes[0]?.after).toMatchObject({ recurrence: { pattern: 'ANNUAL' } });
  });

  it('duplicates terminal work as an Idea and never copies capacity', () => {
    const result = renewCommitment(state('DONE'), { commitmentId: 'commitment' }, cmd, ctx);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.effects.changes[0]?.after).toMatchObject({
        lifecycle: 'IDEA',
        renewedFromCommitmentId: 'commitment',
      });
  });

  it('refuses renewal before work is terminal', () => {
    const result = renewCommitment(state('IN_DELIVERY'), { commitmentId: 'commitment' }, cmd, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ILLEGAL_LIFECYCLE_TRANSITION');
  });
});
