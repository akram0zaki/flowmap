import { beforeEach, describe, expect, it } from 'vitest';

import {
  setDefaultReserves,
  setTeamDefaults,
  setTeamQuarterReserves,
  seedReservesFor,
} from './capacity-settings.js';
import { ensureTeamQuarter } from './handlers.js';
import { deliverableCapacity } from './capacity.js';
import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type Team,
  type TeamQuarter,
  type Workspace,
  type WorkspaceRole,
} from './entities.js';
import type { QuarterId } from './quarter.js';

const NOW = '2026-08-15T09:00:00Z';
const WS = 'ws-1';
const Q: QuarterId = '2026-Q3';

class TestIds {
  #n = 0;
  next() {
    this.#n += 1;
    return `id-${this.#n}`;
  }
}

function ctx(role: WorkspaceRole = 'PLANNER'): CommandContext {
  return {
    clock: { now: () => NOW, today: () => '2026-08-15' },
    ids: new TestIds(),
    actorId: 'actor-1',
    role,
    nextSequence: 1,
  };
}

function command(name: string, payload: unknown = {}): Command {
  return { id: 'cmd-1', name, workspaceId: WS, payload, actorId: 'actor-1', issuedAt: NOW };
}

function env(id: string) {
  return {
    id,
    workspaceId: WS,
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'actor-1',
    updatedAt: NOW,
    updatedBy: 'actor-1',
  };
}

const workspace: Workspace = {
  ...env(WS),
  name: 'Test',
  timezone: 'Europe/Amsterdam',
  currentQuarterId: Q,
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

const team: Team = {
  ...env('team-1'),
  name: 'Platform',
  defaultQuarterCapacity: 100,
  displayOrder: 0,
  active: true,
};

const teamQuarter: TeamQuarter = {
  ...env('tq-1'),
  teamId: 'team-1',
  quarterId: Q,
  capacityBaseline: 100,
  capacityAdjustment: 0,
  reserves: [
    { id: 'r1', type: 'BAU_SUPPORT', label: 'BAU & support', amount: 15 },
    { id: 'r2', type: 'REFINEMENT', label: 'Refinement', amount: 5, linkedIdeaIds: ['c-9'] },
  ],
};

let state: WorkspaceState;

beforeEach(() => {
  state = {
    workspace,
    teams: new Map([[team.id, team]]),
    teamQuarters: new Map([[teamQuarter.id, teamQuarter]]),
    commitments: new Map(),
    footprints: new Map(),
  };
});

/** `WorkspaceState` holds readonly maps, so a variation is a new state. */
function withTeam(over: Partial<Team>): void {
  state = { ...state, teams: new Map([[team.id, { ...team, ...over }]]) };
}

function withTeamQuarter(over: Partial<TeamQuarter>): void {
  state = { ...state, teamQuarters: new Map([[teamQuarter.id, { ...teamQuarter, ...over }]]) };
}

function expectError(result: CommandResult, code: string): void {
  expect(result.ok, `expected failure ${code}, got success`).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

/** The entity a successful result would write, for reading fields off. */
function after<T>(result: CommandResult): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`);
  return result.effects.changes[0]!.after as T;
}

const BAU = { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 30 } as const;
const REFINE = { type: 'REFINEMENT', label: 'Refinement', amount: 5 } as const;

describe('workspace defaults', () => {
  it('sets the reserves new team-quarters will start from', () => {
    const result = setDefaultReserves(
      state,
      { reserves: [BAU, REFINE] },
      command('SetDefaultReserves'),
      ctx(),
    );
    const ws = after<Workspace>(result);
    expect(ws.settings.capacity.defaultReserves).toEqual([
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 30 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ]);
  });

  /*
   * The guardrail that gives every figure on the board its meaning: reserving
   * more than the team has would make deliverable capacity negative, and the
   * utilisation ratio built on it nonsense.
   */
  it('refuses reserves that exceed the capacity they are measured against', () => {
    expectError(
      setDefaultReserves(
        state,
        { reserves: [{ ...BAU, amount: 96 }, REFINE] },
        command('SetDefaultReserves'),
        ctx(),
      ),
      'RESERVES_EXCEED_CAPACITY',
    );
  });

  // Raising both together must be judged on the capacity being set, not the
  // one being replaced, or the honest edit fails and the two-step succeeds.
  it('checks against the capacity in the same command, not the old one', () => {
    const result = setDefaultReserves(
      state,
      { reserves: [{ ...BAU, amount: 120 }], defaultTeamQuarterCapacity: 200 },
      command('SetDefaultReserves'),
      ctx(),
    );
    expect(result.ok).toBe(true);
  });

  it('is a Planner decision', () => {
    expectError(
      setDefaultReserves(state, { reserves: [BAU] }, command('SetDefaultReserves'), ctx('VIEWER')),
      'UNAUTHORISED',
    );
  });

  it('undoes to the reserves that were there before', () => {
    const result = setDefaultReserves(
      state,
      { reserves: [BAU] },
      command('SetDefaultReserves'),
      ctx(),
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.effects.inverse?.payload).toMatchObject({ reserves: DEFAULT_RESERVES });
  });
});

describe('team defaults', () => {
  it('overrides the workspace for that team only', () => {
    const result = setTeamDefaults(
      state,
      { teamId: 'team-1', defaultReserves: [BAU, REFINE] },
      command('SetTeamDefaults'),
      ctx(),
    );
    const updated = after<Team>(result);
    expect(updated.defaultReserves).toEqual([
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 30 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ]);
    expect(seedReservesFor(state, updated)).toEqual(updated.defaultReserves);
  });

  // Absent, not empty: "this team reserves nothing" is a different statement
  // from "this team follows the workspace", and only one of them is a default.
  it('clears the override with null, returning the team to the workspace', () => {
    withTeam({ defaultReserves: [BAU] });

    const result = setTeamDefaults(
      state,
      { teamId: 'team-1', defaultReserves: null },
      command('SetTeamDefaults'),
      ctx(),
    );
    const updated = after<Team>(result);
    expect('defaultReserves' in updated).toBe(false);
    expect(seedReservesFor(state, updated)).toEqual(DEFAULT_RESERVES);
  });

  it('leaves the override alone when the payload does not mention it', () => {
    withTeam({ defaultReserves: [BAU] });
    const result = setTeamDefaults(
      state,
      { teamId: 'team-1', defaultQuarterCapacity: 120 },
      command('SetTeamDefaults'),
      ctx(),
    );
    const updated = after<Team>(result);
    expect(updated.defaultQuarterCapacity).toBe(120);
    expect(updated.defaultReserves).toEqual([BAU]);
  });

  it('refuses to reserve more than the team will have', () => {
    expectError(
      setTeamDefaults(
        state,
        { teamId: 'team-1', defaultReserves: [{ ...BAU, amount: 101 }] },
        command('SetTeamDefaults'),
        ctx(),
      ),
      'RESERVES_EXCEED_CAPACITY',
    );
  });

  it('refuses a team that is not there', () => {
    expectError(
      setTeamDefaults(state, { teamId: 'nope' }, command('SetTeamDefaults'), ctx()),
      'ENTITY_NOT_FOUND',
    );
  });
});

/*
 * Seeding is a copy, made once. A default is what a new container starts from,
 * never a live reference — otherwise changing one rewrites quarters people have
 * already planned against, and last quarter's history along with them.
 */
describe('seeding a new team-quarter', () => {
  it('takes the team defaults when the team has them', () => {
    withTeam({ defaultReserves: [BAU] });
    const result = ensureTeamQuarter(
      state,
      { teamId: 'team-1', quarterId: '2026-Q4' },
      command('EnsureTeamQuarter'),
      ctx(),
    );
    const created = after<TeamQuarter>(result);
    expect(created.reserves.map((r) => [r.type, r.amount])).toEqual([['BAU_SUPPORT', 30]]);
  });

  it('falls back to the workspace when the team has none', () => {
    const result = ensureTeamQuarter(
      state,
      { teamId: 'team-1', quarterId: '2026-Q4' },
      command('EnsureTeamQuarter'),
      ctx(),
    );
    const created = after<TeamQuarter>(result);
    expect(created.reserves.map((r) => r.amount)).toEqual([15, 5]);
  });

  it('does not touch quarters that already exist', () => {
    withTeam({ defaultReserves: [BAU] });
    const result = ensureTeamQuarter(
      state,
      { teamId: 'team-1', quarterId: Q },
      command('EnsureTeamQuarter'),
      ctx(),
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.effects.changes).toEqual([]);
  });
});

describe('one quarter’s own reserves', () => {
  it('replaces the amounts and moves deliverable capacity with them', () => {
    const result = setTeamQuarterReserves(
      state,
      { teamQuarterId: 'tq-1', reserves: [{ ...BAU, amount: 45 }, REFINE] },
      command('SetTeamQuarterReserves'),
      ctx(),
    );
    const updated = after<TeamQuarter>(result);
    expect(deliverableCapacity(updated)).toBe(50);
  });

  // The link is the whole point of a refinement reserve, and an id is what
  // carries it. Matching by type keeps both across an edit of the amount.
  it('keeps a refinement reserve’s linked Ideas when its amount changes', () => {
    const result = setTeamQuarterReserves(
      state,
      { teamQuarterId: 'tq-1', reserves: [BAU, { ...REFINE, amount: 12 }] },
      command('SetTeamQuarterReserves'),
      ctx(),
    );
    const refinement = after<TeamQuarter>(result).reserves.find((r) => r.type === 'REFINEMENT');
    expect(refinement).toMatchObject({ id: 'r2', amount: 12, linkedIdeaIds: ['c-9'] });
  });

  it('refuses to reserve more than the quarter has', () => {
    expectError(
      setTeamQuarterReserves(
        state,
        { teamQuarterId: 'tq-1', reserves: [{ ...BAU, amount: 101 }] },
        command('SetTeamQuarterReserves'),
        ctx(),
      ),
      'RESERVES_EXCEED_CAPACITY',
    );
  });

  // Held work's reserve is not the user's to write, and it still occupies the
  // quarter — so it survives an edit and counts against what is left to reserve.
  it('preserves the system-managed hold reserve and counts it', () => {
    withTeamQuarter({
      reserves: [
        ...teamQuarter.reserves,
        { id: 'r3', type: 'HOLD', label: 'On hold', amount: 40, systemManaged: true },
      ],
    });

    const kept = after<TeamQuarter>(
      setTeamQuarterReserves(
        state,
        { teamQuarterId: 'tq-1', reserves: [{ ...BAU, amount: 10 }] },
        command('SetTeamQuarterReserves'),
        ctx(),
      ),
    );
    expect(kept.reserves.find((r) => r.systemManaged)).toMatchObject({ id: 'r3', amount: 40 });

    expectError(
      setTeamQuarterReserves(
        state,
        { teamQuarterId: 'tq-1', reserves: [{ ...BAU, amount: 61 }] },
        command('SetTeamQuarterReserves'),
        ctx(),
      ),
      'RESERVES_EXCEED_CAPACITY',
    );
  });

  it('refuses to let a form conjure a hold reserve', () => {
    expectError(
      setTeamQuarterReserves(
        state,
        { teamQuarterId: 'tq-1', reserves: [{ type: 'HOLD', label: 'On hold', amount: 5 }] },
        command('SetTeamQuarterReserves'),
        ctx(),
      ),
      'RESERVE_IS_SYSTEM_MANAGED',
    );
  });

  // A settled quarter is history, and the domain will not edit it.
  it('refuses a closed quarter', () => {
    withTeamQuarter({ closedAt: NOW });
    expectError(
      setTeamQuarterReserves(
        state,
        { teamQuarterId: 'tq-1', reserves: [BAU] },
        command('SetTeamQuarterReserves'),
        ctx(),
      ),
      'QUARTER_CLOSED',
    );
  });

  it('rejects a fractional or negative amount', () => {
    for (const amount of [2.5, -1]) {
      expectError(
        setTeamQuarterReserves(
          state,
          { teamQuarterId: 'tq-1', reserves: [{ ...BAU, amount }] },
          command('SetTeamQuarterReserves'),
          ctx(),
        ),
        'FOOTPRINT_UNITS_MUST_BE_POSITIVE',
      );
    }
  });

  it('undoes to the amounts that were there before', () => {
    const result = setTeamQuarterReserves(
      state,
      { teamQuarterId: 'tq-1', reserves: [{ ...BAU, amount: 45 }] },
      command('SetTeamQuarterReserves'),
      ctx(),
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.effects.inverse?.payload).toMatchObject({
      reserves: [
        { type: 'BAU_SUPPORT', amount: 15 },
        { type: 'REFINEMENT', amount: 5 },
      ],
    });
  });
});
