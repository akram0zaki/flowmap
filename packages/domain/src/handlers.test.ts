import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  assignCapacityFootprint,
  createIdea,
  archiveTeam,
  createTeam,
  createWorkspace,
  ensureTeamQuarter,
  restoreTeam,
  linkIdeaToRefinementReserve,
  mergeCapacityFootprints,
  moveCapacityFootprint,
  removeCapacityFootprint,
  reorderTeams,
  resizeCapacityFootprint,
  restoreCapacityFootprint,
  setPrimaryTeam,
  splitCapacityFootprint,
  unlinkIdeaFromRefinementReserve,
  updateCommitment,
} from './handlers.js';
import { summariseCapacity } from './capacity.js';
import {
  diffFields,
  roleAtLeast,
  type Command,
  type CommandContext,
  type CommandResult,
  type WorkspaceState,
} from './command.js';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type CapacityFootprint,
  type Commitment,
  type Team,
  type TeamQuarter,
  type Workspace,
  type WorkspaceRole,
} from './entities.js';
import { assessCommitGate } from './lifecycle-handlers.js';
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
  name: 'Payments',
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
  reserves: [{ id: 'r1', type: 'BAU_SUPPORT', label: 'BAU', amount: 20 }],
};

const idea: Commitment = {
  ...env('c-1'),
  name: 'Instant payments',
  lifecycle: 'IDEA',
  class: 'DISCRETIONARY',
  importance: 'MEDIUM',
  valueDrivers: [],
};

let state: WorkspaceState;

beforeEach(() => {
  state = {
    workspace,
    teams: new Map([[team.id, team]]),
    teamQuarters: new Map([[teamQuarter.id, teamQuarter]]),
    commitments: new Map([[idea.id, idea]]),
    footprints: new Map(),
  };
});

function expectError(result: CommandResult, code: string): void {
  expect(result.ok, `expected failure ${code}, got success`).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

function withFootprint(over: Partial<CapacityFootprint> = {}): CapacityFootprint {
  return {
    ...env('fp-1'),
    commitmentId: 'c-1',
    teamId: 'team-1',
    quarterId: Q,
    units: 20,
    unitsSource: 'EXPLICIT',
    isPrimary: false,
    ...over,
  };
}

// ── Authorisation ──────────────────────────────────────────────────────────

describe('authorisation is checked in the domain, not only the UI', () => {
  it('refuses a Viewer creating a team', () => {
    expectError(
      createTeam(state, { name: 'X' }, command('CreateTeam'), ctx('VIEWER')),
      'UNAUTHORISED',
    );
  });

  it('refuses a Contributor assigning capacity', () => {
    expectError(
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, units: 10 },
        command('AssignCapacityFootprint'),
        ctx('CONTRIBUTOR'),
      ),
      'UNAUTHORISED',
    );
  });

  it('allows a Contributor to capture an Idea', () => {
    const result = createIdea({ name: 'New idea' }, command('CreateIdea'), ctx('CONTRIBUTOR'));
    expect(result.ok).toBe(true);
  });

  it('refuses a Viewer capturing an Idea', () => {
    expectError(createIdea({ name: 'X' }, command('CreateIdea'), ctx('VIEWER')), 'UNAUTHORISED');
  });

  it('orders roles so each implies the ones before it', () => {
    expect(roleAtLeast('ADMIN', 'PLANNER')).toBe(true);
    expect(roleAtLeast('PLANNER', 'CONTRIBUTOR')).toBe(true);
    expect(roleAtLeast('CONTRIBUTOR', 'PLANNER')).toBe(false);
    expect(roleAtLeast('VIEWER', 'CONTRIBUTOR')).toBe(false);
  });
});

// ── CreateWorkspace ────────────────────────────────────────────────────────

describe('CreateWorkspace', () => {
  it('needs only a name and a timezone, and seeds every default', () => {
    const result = createWorkspace(
      { name: 'Retail Payments', timezone: 'Europe/Amsterdam', currentQuarterId: Q },
      command('CreateWorkspace'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ws = result.effects.changes[0]!.after as Workspace;
    expect(ws.name).toBe('Retail Payments');
    expect(ws.settings.capacity.sizeMapping).toEqual(DEFAULT_SIZE_MAPPING);
    expect(ws.settings.capacity.defaultReserves).toEqual(DEFAULT_RESERVES);
    expect(ws.revision).toBe(1);
    expect(result.effects.events[0]!.eventType).toBe('WORKSPACE_CREATED');
  });

  it('rejects a blank name', () => {
    expectError(
      createWorkspace(
        { name: '   ', timezone: 'UTC', currentQuarterId: Q },
        command('CreateWorkspace'),
        ctx(),
      ),
      'NAME_REQUIRED',
    );
  });

  it('rejects a name over 80 characters', () => {
    expectError(
      createWorkspace(
        { name: 'x'.repeat(81), timezone: 'UTC', currentQuarterId: Q },
        command('CreateWorkspace'),
        ctx(),
      ),
      'NAME_TOO_LONG',
    );
  });
});

// ── CreateTeam ─────────────────────────────────────────────────────────────

describe('CreateTeam', () => {
  it('creates a team and returns an inverse', () => {
    const result = createTeam(state, { name: 'Platform' }, command('CreateTeam'), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect((result.effects.changes[0]!.after as Team).name).toBe('Platform');
    expect(result.effects.inverse?.name).toBe('ArchiveTeam');
  });

  it('rejects a duplicate name regardless of case', () => {
    expectError(
      createTeam(state, { name: 'payments' }, command('CreateTeam'), ctx()),
      'DUPLICATE_NAME',
    );
  });

  it('allows reusing the name of an archived team', () => {
    state = {
      ...state,
      teams: new Map([[team.id, { ...team, archivedAt: NOW }]]),
    };
    expect(createTeam(state, { name: 'Payments' }, command('CreateTeam'), ctx()).ok).toBe(true);
  });
});

describe('ArchiveTeam', () => {
  it('archives the team and its quarters when nothing sits on it', () => {
    const result = archiveTeam(state, { teamId: 'team-1' }, command('ArchiveTeam'), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.changes.map((change) => change.op)).toEqual(['ARCHIVE', 'ARCHIVE']);
    expect(result.effects.changes[0]!.ref).toEqual({ kind: 'TEAM', id: 'team-1' });
    expect(result.effects.inverse?.name).toBe('RestoreTeam');
  });

  it('is blocked while a live footprint still sits on the team', () => {
    state = { ...state, footprints: new Map([['fp-1', withFootprint()]]) };
    expectError(
      archiveTeam(state, { teamId: 'team-1' }, command('ArchiveTeam'), ctx()),
      'TEAM_HAS_ACTIVE_FOOTPRINTS',
    );
  });

  it('does not treat an archived footprint as blocking', () => {
    state = {
      ...state,
      footprints: new Map([['fp-1', { ...withFootprint(), archivedAt: NOW, archivedBy: 'a' }]]),
    };
    expect(archiveTeam(state, { teamId: 'team-1' }, command('ArchiveTeam'), ctx()).ok).toBe(true);
  });

  it('requires a Planner', () => {
    expectError(
      archiveTeam(state, { teamId: 'team-1' }, command('ArchiveTeam'), ctx('CONTRIBUTOR')),
      'UNAUTHORISED',
    );
  });

  it('archives iff no live footprint sits on the team', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasFootprint) => {
        const next = hasFootprint
          ? { ...state, footprints: new Map([['fp-1', withFootprint()]]) }
          : { ...state, footprints: new Map() };
        const result = archiveTeam(next, { teamId: 'team-1' }, command('ArchiveTeam'), ctx());
        expect(result.ok).toBe(!hasFootprint);
      }),
    );
  });
});

describe('RestoreTeam', () => {
  it('restores the team and the quarters archived with it', () => {
    const gone = { ...team, archivedAt: NOW, archivedBy: 'a' };
    const goneQuarter = { ...teamQuarter, archivedAt: NOW, archivedBy: 'a' };
    state = {
      ...state,
      teams: new Map([[gone.id, gone]]),
      teamQuarters: new Map([[goneQuarter.id, goneQuarter]]),
    };

    const result = restoreTeam(state, { teamId: 'team-1' }, command('RestoreTeam'), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.changes).toHaveLength(2);
    expect(result.effects.changes.every((change) => change.op === 'RESTORE')).toBe(true);
    expect((result.effects.changes[0]!.after as Team).archivedAt).toBeUndefined();
    expect(result.effects.inverse?.name).toBe('ArchiveTeam');
  });
});

// ── EnsureTeamQuarter ──────────────────────────────────────────────────────

describe('EnsureTeamQuarter', () => {
  it('is idempotent — a second call produces no changes', () => {
    const result = ensureTeamQuarter(
      state,
      { teamId: 'team-1', quarterId: Q },
      command('EnsureTeamQuarter'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.effects.changes).toHaveLength(0);
  });

  it('creates a container seeded with the workspace default reserves', () => {
    const result = ensureTeamQuarter(
      state,
      { teamId: 'team-1', quarterId: '2027-Q1' },
      command('EnsureTeamQuarter'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tq = result.effects.changes[0]!.after as TeamQuarter;
    expect(tq.reserves).toHaveLength(DEFAULT_RESERVES.length);
    expect(tq.reserves.map((r) => r.type)).toEqual(['BAU_SUPPORT', 'REFINEMENT']);
    expect(result.effects.affectedProjections).toContain('capacity:team-1:2027-Q1');
  });

  it('rejects an unknown team', () => {
    expectError(
      ensureTeamQuarter(
        state,
        { teamId: 'nope', quarterId: Q },
        command('EnsureTeamQuarter'),
        ctx(),
      ),
      'ENTITY_NOT_FOUND',
    );
  });

  it('rejects an archived team', () => {
    state = { ...state, teams: new Map([[team.id, { ...team, archivedAt: NOW }]]) };
    expectError(
      ensureTeamQuarter(
        state,
        { teamId: 'team-1', quarterId: Q },
        command('EnsureTeamQuarter'),
        ctx(),
      ),
      'ENTITY_ARCHIVED',
    );
  });
});

// ── CreateIdea ─────────────────────────────────────────────────────────────

describe('CreateIdea', () => {
  it('needs only a title', () => {
    const result = createIdea({ name: 'Request to pay' }, command('CreateIdea'), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const c = result.effects.changes[0]!.after as Commitment;
    expect(c.lifecycle).toBe('IDEA');
    expect(c.class).toBe('DISCRETIONARY');
    expect(c.importance).toBe('MEDIUM');
    expect(c.primaryTeamId).toBeUndefined();
    expect(c.ownerRef).toBeUndefined();
  });

  it('trims the title', () => {
    const result = createIdea({ name: '  Spaced  ' }, command('CreateIdea'), ctx());
    if (result.ok) expect((result.effects.changes[0]!.after as Commitment).name).toBe('Spaced');
  });

  it('rejects an empty title', () => {
    expectError(createIdea({ name: '' }, command('CreateIdea'), ctx()), 'NAME_REQUIRED');
  });
});

// ── AssignCapacityFootprint ────────────────────────────────────────────────

describe('AssignCapacityFootprint', () => {
  const cmd = command('AssignCapacityFootprint');

  it('resolves units from a relative size and freezes them', () => {
    const result = assignCapacityFootprint(
      state,
      { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, size: 'M' },
      cmd,
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fp = result.effects.changes[0]!.after as CapacityFootprint;
    expect(fp.units).toBe(DEFAULT_SIZE_MAPPING.M);
    expect(fp.unitsSource).toBe('SIZE_MAPPING');
    expect(fp.sizeAtCreation).toBe('M');
  });

  it('prefers explicit units over a size', () => {
    const result = assignCapacityFootprint(
      state,
      { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, size: 'M', units: 42 },
      cmd,
      ctx(),
    );
    if (result.ok) {
      const fp = result.effects.changes[0]!.after as CapacityFootprint;
      expect(fp.units).toBe(42);
      expect(fp.unitsSource).toBe('EXPLICIT');
    }
  });

  it('rejects XL without explicit units', () => {
    expectError(
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, size: 'XL' },
        cmd,
        ctx(),
      ),
      'XL_REQUIRES_EXPLICIT_UNITS',
    );
  });

  it('accepts XL with explicit units', () => {
    const result = assignCapacityFootprint(
      state,
      { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, size: 'XL', units: 60 },
      cmd,
      ctx(),
    );
    expect(result.ok).toBe(true);
  });

  it.each([0, -5, 1.5])('rejects units of %s', (units) => {
    expectError(
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, units },
        cmd,
        ctx(),
      ),
      'FOOTPRINT_UNITS_MUST_BE_POSITIVE',
    );
  });

  it('rejects neither size nor units', () => {
    expectError(
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q },
        cmd,
        ctx(),
      ),
      'FOOTPRINT_UNITS_MUST_BE_POSITIVE',
    );
  });

  it('rejects a duplicate footprint for the same commitment, team and quarter', () => {
    state = { ...state, footprints: new Map([['fp-1', withFootprint()]]) };
    expectError(
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, units: 10 },
        cmd,
        ctx(),
      ),
      'DUPLICATE_FOOTPRINT',
    );
  });

  it('allows the same commitment on a different team', () => {
    const other: Team = {
      ...env('team-2'),
      name: 'Platform',
      defaultQuarterCapacity: 100,
      displayOrder: 1,
      active: true,
    };
    state = {
      ...state,
      teams: new Map([...state.teams, ['team-2', other]]),
      footprints: new Map([['fp-1', withFootprint()]]),
    };
    expect(
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'team-2', quarterId: Q, units: 10 },
        cmd,
        ctx(),
      ).ok,
    ).toBe(true);
  });

  it('rejects a closed quarter', () => {
    state = {
      ...state,
      teamQuarters: new Map([['tq-1', { ...teamQuarter, closedAt: NOW }]]),
    };
    expectError(
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, units: 10 },
        cmd,
        ctx(),
      ),
      'QUARTER_CLOSED',
    );
  });

  it('rejects an unknown commitment and an unknown team', () => {
    expectError(
      assignCapacityFootprint(
        state,
        { commitmentId: 'nope', teamId: 'team-1', quarterId: Q, units: 5 },
        cmd,
        ctx(),
      ),
      'ENTITY_NOT_FOUND',
    );
    expectError(
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'nope', quarterId: Q, units: 5 },
        cmd,
        ctx(),
      ),
      'ENTITY_NOT_FOUND',
    );
  });

  // Spec 02 §6: overflow is permitted and explained, never blocked.
  it('permits overflow and reports it as a consequence', () => {
    const committed: Commitment = { ...idea, lifecycle: 'COMMITTED' };
    state = { ...state, commitments: new Map([['c-1', committed]]) };

    const result = assignCapacityFootprint(
      state,
      { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, units: 95 },
      cmd,
      ctx(),
    );

    expect(result.ok, 'overflow must not block the command').toBe(true);
    if (!result.ok) return;

    const consequence = result.effects.consequences?.[0];
    expect(consequence?.kind).toBe('CAPACITY');
    if (consequence?.kind === 'CAPACITY') {
      // deliverable = 100 - 20 reserve = 80; load 95 => 15 over.
      expect(consequence.newOverflow).toBe(15);
    }
  });

  it('reports no consequence when the work fits', () => {
    const result = assignCapacityFootprint(
      state,
      { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, units: 10 },
      cmd,
      ctx(),
    );
    if (result.ok) expect(result.effects.consequences).toBeUndefined();
  });
});

// ── Move / resize / remove ─────────────────────────────────────────────────

describe('MoveCapacityFootprint', () => {
  beforeEach(() => {
    state = { ...state, footprints: new Map([['fp-1', withFootprint()]]) };
  });

  it('moves to another quarter, preserving units, and invalidates both cells', () => {
    const result = moveCapacityFootprint(
      state,
      { footprintId: 'fp-1', quarterId: '2026-Q4' },
      command('MoveCapacityFootprint'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.effects.changes[0]!.after as CapacityFootprint;
    expect(after.quarterId).toBe('2026-Q4');
    expect(after.units).toBe(20);
    expect(result.effects.affectedProjections).toEqual(
      expect.arrayContaining(['capacity:team-1:2026-Q3', 'capacity:team-1:2026-Q4']),
    );
    expect(result.effects.changes[0]!.changedFields).toEqual(['quarterId']);
  });

  it('is a no-op when nothing moves', () => {
    const result = moveCapacityFootprint(
      state,
      { footprintId: 'fp-1', teamId: 'team-1', quarterId: Q },
      command('MoveCapacityFootprint'),
      ctx(),
    );
    if (result.ok) expect(result.effects.changes).toHaveLength(0);
  });

  it('returns an inverse that moves it back', () => {
    const result = moveCapacityFootprint(
      state,
      { footprintId: 'fp-1', quarterId: '2026-Q4' },
      command('MoveCapacityFootprint'),
      ctx(),
    );
    if (result.ok) {
      expect(result.effects.inverse?.payload).toMatchObject({
        footprintId: 'fp-1',
        teamId: 'team-1',
        quarterId: '2026-Q3',
      });
    }
  });

  it('refuses to move out of a closed quarter', () => {
    state = { ...state, teamQuarters: new Map([['tq-1', { ...teamQuarter, closedAt: NOW }]]) };
    expectError(
      moveCapacityFootprint(
        state,
        { footprintId: 'fp-1', quarterId: '2026-Q4' },
        command('MoveCapacityFootprint'),
        ctx(),
      ),
      'QUARTER_CLOSED',
    );
  });

  it('refuses to create a duplicate by moving onto an existing cell', () => {
    state = {
      ...state,
      footprints: new Map([
        ['fp-1', withFootprint()],
        ['fp-2', withFootprint({ id: 'fp-2', quarterId: '2026-Q4' })],
      ]),
    };
    expectError(
      moveCapacityFootprint(
        state,
        { footprintId: 'fp-1', quarterId: '2026-Q4' },
        command('MoveCapacityFootprint'),
        ctx(),
      ),
      'DUPLICATE_FOOTPRINT',
    );
  });
});

describe('ResizeCapacityFootprint', () => {
  beforeEach(() => {
    state = { ...state, footprints: new Map([['fp-1', withFootprint()]]) };
  });

  it('resizes from a size band', () => {
    const result = resizeCapacityFootprint(
      state,
      { footprintId: 'fp-1', size: 'L' },
      command('ResizeCapacityFootprint'),
      ctx(),
    );
    if (result.ok) {
      expect((result.effects.changes[0]!.after as CapacityFootprint).units).toBe(
        DEFAULT_SIZE_MAPPING.L,
      );
      expect(result.effects.inverse?.payload).toMatchObject({ units: 20 });
    }
  });

  it('is a no-op when the size resolves to the same units', () => {
    const result = resizeCapacityFootprint(
      state,
      { footprintId: 'fp-1', units: 20 },
      command('ResizeCapacityFootprint'),
      ctx(),
    );
    if (result.ok) expect(result.effects.changes).toHaveLength(0);
  });
});

describe('RemoveCapacityFootprint', () => {
  beforeEach(() => {
    state = { ...state, footprints: new Map([['fp-1', withFootprint()]]) };
  });

  it('archives rather than deletes', () => {
    const result = removeCapacityFootprint(
      state,
      { footprintId: 'fp-1' },
      command('RemoveCapacityFootprint'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.effects.changes[0]!.op).toBe('ARCHIVE');
    expect((result.effects.changes[0]!.after as CapacityFootprint).archivedAt).toBe(NOW);
  });

  it('is idempotent on an already-archived footprint', () => {
    state = { ...state, footprints: new Map([['fp-1', withFootprint({ archivedAt: NOW })]]) };
    const result = removeCapacityFootprint(
      state,
      { footprintId: 'fp-1' },
      command('RemoveCapacityFootprint'),
      ctx(),
    );
    if (result.ok) expect(result.effects.changes).toHaveLength(0);
  });

  // Removal must be undoable, which means archive must be reversible and the id
  // must survive — otherwise every reference to it breaks.
  it('returns a restore inverse', () => {
    const result = removeCapacityFootprint(
      state,
      { footprintId: 'fp-1' },
      command('RemoveCapacityFootprint'),
      ctx(),
    );
    if (result.ok) {
      expect(result.effects.inverse?.name).toBe('RestoreCapacityFootprint');
      expect(result.effects.inverse?.payload).toMatchObject({ footprintId: 'fp-1' });
    }
  });
});

describe('RestoreCapacityFootprint', () => {
  beforeEach(() => {
    state = { ...state, footprints: new Map([['fp-1', withFootprint({ archivedAt: NOW })]]) };
  });

  it('un-archives, keeping the same id', () => {
    const result = restoreCapacityFootprint(
      state,
      { footprintId: 'fp-1' },
      command('RestoreCapacityFootprint'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const change = result.effects.changes[0]!;
    expect(change.op).toBe('RESTORE');
    expect((change.after as CapacityFootprint).id).toBe('fp-1');
    expect((change.after as CapacityFootprint).archivedAt).toBeUndefined();
    expect(result.effects.inverse?.name).toBe('RemoveCapacityFootprint');
  });

  it('is a no-op on a live footprint', () => {
    state = { ...state, footprints: new Map([['fp-1', withFootprint()]]) };
    const result = restoreCapacityFootprint(
      state,
      { footprintId: 'fp-1' },
      command('RestoreCapacityFootprint'),
      ctx(),
    );
    if (result.ok) expect(result.effects.changes).toHaveLength(0);
  });

  it('refuses to restore into a closed quarter', () => {
    state = { ...state, teamQuarters: new Map([['tq-1', { ...teamQuarter, closedAt: NOW }]]) };
    expectError(
      restoreCapacityFootprint(
        state,
        { footprintId: 'fp-1' },
        command('RestoreCapacityFootprint'),
        ctx(),
      ),
      'QUARTER_CLOSED',
    );
  });

  it('undo of a removal round-trips the footprint back to its original state', () => {
    const live = withFootprint();
    state = { ...state, footprints: new Map([['fp-1', live]]) };

    const removed = removeCapacityFootprint(state, { footprintId: 'fp-1' }, command('r'), ctx());
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;

    const archivedFp = removed.effects.changes[0]!.after as CapacityFootprint;
    state = { ...state, footprints: new Map([['fp-1', archivedFp]]) };

    const restored = restoreCapacityFootprint(state, { footprintId: 'fp-1' }, command('R'), ctx());
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    const back = restored.effects.changes[0]!.after as CapacityFootprint;
    expect(back.units).toBe(live.units);
    expect(back.teamId).toBe(live.teamId);
    expect(back.quarterId).toBe(live.quarterId);
    expect(back.archivedAt).toBeUndefined();
  });
});

// ── Cross-cutting guarantees ───────────────────────────────────────────────

describe('every accepted command', () => {
  const accepted = [
    () => createTeam(state, { name: 'New' }, command('CreateTeam'), ctx()),
    () => archiveTeam(state, { teamId: 'team-1' }, command('ArchiveTeam'), ctx()),
    () => createIdea({ name: 'New' }, command('CreateIdea'), ctx()),
    () =>
      ensureTeamQuarter(
        state,
        { teamId: 'team-1', quarterId: '2027-Q2' },
        command('EnsureTeamQuarter'),
        ctx(),
      ),
    () =>
      assignCapacityFootprint(
        state,
        { commitmentId: 'c-1', teamId: 'team-1', quarterId: Q, units: 10 },
        command('AssignCapacityFootprint'),
        ctx(),
      ),
  ];

  it('stamps every change with a version and a complete changedFields list', () => {
    for (const run of accepted) {
      const result = run();
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      for (const change of result.effects.changes) {
        expect(change.toVersion).toBeGreaterThan(0);
        expect(Array.isArray(change.changedFields)).toBe(true);
        if (change.op === 'CREATE') expect(change.changedFields.length).toBeGreaterThan(0);
      }
    }
  });

  it('stamps every event with actor, command, timestamp and refs', () => {
    for (const run of accepted) {
      const result = run();
      if (!result.ok) continue;

      for (const ev of result.effects.events) {
        expect(ev.actorId).toBe('actor-1');
        expect(ev.occurredAt).toBe(NOW);
        expect(ev.commandName).toBeTruthy();
        expect(ev.entityRefs.length).toBeGreaterThan(0);
        expect(ev.summaryKey).toBe(`event.${ev.eventType}`);
      }
    }
  });

  it('produces no effects at all when it fails', () => {
    const failures: CommandResult[] = [
      createTeam(state, { name: '' }, command('CreateTeam'), ctx()),
      createIdea({ name: '' }, command('CreateIdea'), ctx('VIEWER')),
      assignCapacityFootprint(
        state,
        { commitmentId: 'nope', teamId: 'team-1', quarterId: Q, units: 5 },
        command('AssignCapacityFootprint'),
        ctx(),
      ),
    ];
    for (const result of failures) {
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('effects');
    }
  });
});

describe('diffFields', () => {
  it('ignores fields every write touches', () => {
    expect(
      diffFields(
        { a: 1, updatedAt: 'x', entityVersion: 1 },
        { a: 1, updatedAt: 'y', entityVersion: 2 },
      ),
    ).toEqual([]);
  });

  it('detects nested and array changes', () => {
    expect(diffFields({ r: [{ a: 1 }] }, { r: [{ a: 2 }] })).toEqual(['r']);
    expect(diffFields({ r: [{ a: 1 }] }, { r: [{ a: 1 }] })).toEqual([]);
    expect(diffFields({ r: [1] }, { r: [1, 2] })).toEqual(['r']);
  });

  it('treats an added or removed optional field as a change', () => {
    expect(diffFields({}, { note: 'x' })).toEqual(['note']);
    expect(diffFields({ note: 'x' }, {})).toEqual(['note']);
  });

  it('reports exactly the fields that differ, for any object pair', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), fc.integer(), { maxKeys: 6 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), fc.integer(), { maxKeys: 6 }),
        (a, b) => {
          const changed = new Set(diffFields(a, b));
          const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
          for (const key of keys) {
            expect(changed.has(key)).toBe(a[key] !== b[key]);
          }
        },
      ),
    );
  });
});

// ── SetPrimaryTeam ─────────────────────────────────────────────────────────

describe('setPrimaryTeam', () => {
  const other: Team = {
    ...env('team-2'),
    name: 'Platform',
    defaultQuarterCapacity: 100,
    displayOrder: 1,
    active: true,
  };

  beforeEach(() => {
    state = { ...state, teams: new Map([...state.teams, [other.id, other]]) };
  });

  it('names the team that owns the work', () => {
    const result = setPrimaryTeam(
      state,
      { commitmentId: 'c-1', teamId: 'team-2' },
      command('SetPrimaryTeam'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.effects.changes[0]?.after as Commitment;
    expect(after.primaryTeamId).toBe('team-2');
  });

  /**
   * Without this the Commit Gate refuses every drop onto a row the Idea does
   * not already name — which is every row a lead would actually reach for.
   */
  it('lets the primary footprint match the primary team after a move', () => {
    const owned = setPrimaryTeam(
      state,
      { commitmentId: 'c-1', teamId: 'team-2' },
      command('SetPrimaryTeam'),
      ctx(),
    );
    expect(owned.ok).toBe(true);
    if (!owned.ok) return;

    const commitment = owned.effects.changes[0]?.after as Commitment;
    const footprint = withFootprint({ teamId: 'team-2', isPrimary: true });
    const readiness = assessCommitGate({
      commitment: { ...commitment, targetQuarterId: Q },
      footprints: [footprint],
      hasProductImpact: true,
      dependenciesReviewed: true,
      largeThreshold: 40,
    });

    expect(readiness.blockers).toEqual([]);
  });

  it('is a no-op when the team is already the owner', () => {
    const result = setPrimaryTeam(
      state,
      { commitmentId: 'c-1', teamId: 'team-1' },
      command('SetPrimaryTeam'),
      ctx(),
    );
    const first = setPrimaryTeam(
      { ...state, commitments: new Map([['c-1', { ...idea, primaryTeamId: 'team-1' }]]) },
      { commitmentId: 'c-1', teamId: 'team-1' },
      command('SetPrimaryTeam'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.effects.changes).toEqual([]);
  });

  it('refuses an unknown team', () => {
    expectError(
      setPrimaryTeam(
        state,
        { commitmentId: 'c-1', teamId: 'nope' },
        command('SetPrimaryTeam'),
        ctx(),
      ),
      'ENTITY_NOT_FOUND',
    );
  });

  it('refuses a Contributor', () => {
    expectError(
      setPrimaryTeam(
        state,
        { commitmentId: 'c-1', teamId: 'team-2' },
        command('SetPrimaryTeam'),
        ctx('CONTRIBUTOR'),
      ),
      'UNAUTHORISED',
    );
  });

  it('carries an inverse back to the previous owner', () => {
    const state2 = {
      ...state,
      commitments: new Map([['c-1', { ...idea, primaryTeamId: 'team-1' }]]),
    };
    const result = setPrimaryTeam(
      state2,
      { commitmentId: 'c-1', teamId: 'team-2' },
      command('SetPrimaryTeam'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.inverse).toMatchObject({
      name: 'SetPrimaryTeam',
      payload: { commitmentId: 'c-1', teamId: 'team-1' },
    });
  });
});

// ── UpdateCommitment ───────────────────────────────────────────────────────

describe('updateCommitment', () => {
  const run = (payload: Parameters<typeof updateCommitment>[1], role: WorkspaceRole = 'PLANNER') =>
    updateCommitment(state, payload, command('UpdateCommitment'), ctx(role));

  it('changes only the fields it was given', () => {
    const result = run({ commitmentId: 'c-1', outcome: 'Instant payments live' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.effects.changes[0]?.after as Commitment;
    expect(after.outcome).toBe('Instant payments live');
    expect(after.name).toBe(idea.name);
    expect(after.lifecycle).toBe('IDEA');
  });

  // Clearing and leaving alone are different things, and a property sheet has
  // to be able to say both.
  it('treats null as clear and undefined as leave alone', () => {
    const withOwner = {
      ...state,
      commitments: new Map([
        ['c-1', { ...idea, ownerRef: { kind: 'PERSON', personId: 'p-1' }, outcome: 'keep me' }],
      ]),
    } as unknown as WorkspaceState;

    const result = updateCommitment(
      withOwner,
      { commitmentId: 'c-1', ownerRef: null },
      command('UpdateCommitment'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.effects.changes[0]?.after as Commitment;
    expect(after.ownerRef).toBeUndefined();
    expect(after.outcome).toBe('keep me');
  });

  it('is a no-op when nothing actually differs', () => {
    const result = run({ commitmentId: 'c-1', name: idea.name });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.effects.changes).toEqual([]);
  });

  it('derives the target quarter from a target date, so the two cannot disagree', () => {
    const result = run({ commitmentId: 'c-1', targetDate: '2026-11-30' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.effects.changes[0]?.after as Commitment;
    expect(after.targetQuarterId).toBe('2026-Q4');
  });

  /**
   * Staleness rules read `lastMeaningfulUpdateAt`. If tidying a label refreshed
   * it, a forgotten commitment would look freshly reviewed.
   */
  it('refreshes the meaningful-update stamp only for meaningful fields', () => {
    const renamed = run({ commitmentId: 'c-1', name: 'A better name' });
    const retargeted = run({ commitmentId: 'c-1', targetQuarterId: '2027-Q1' });

    expect(renamed.ok && retargeted.ok).toBe(true);
    if (!renamed.ok || !retargeted.ok) return;
    expect(
      (renamed.effects.changes[0]?.after as Commitment).lastMeaningfulUpdateAt,
    ).toBeUndefined();
    expect(
      (retargeted.effects.changes[0]?.after as Commitment).lastMeaningfulUpdateAt,
    ).toBeDefined();
  });

  it('caps the management note, because the domain owns that limit', () => {
    expectError(run({ commitmentId: 'c-1', managementNote: 'x'.repeat(2001) }), 'NOTE_TOO_LONG');
  });

  it('refuses an empty name', () => {
    expectError(run({ commitmentId: 'c-1', name: '   ' }), 'NAME_REQUIRED');
  });

  it('lets a Contributor edit, since this is not a planning decision', () => {
    expect(run({ commitmentId: 'c-1', outcome: 'x' }, 'CONTRIBUTOR').ok).toBe(true);
  });

  it('carries an inverse holding the previous values', () => {
    const withOutcome = {
      ...state,
      commitments: new Map([['c-1', { ...idea, outcome: 'before' }]]),
    } as unknown as WorkspaceState;

    const result = updateCommitment(
      withOutcome,
      { commitmentId: 'c-1', outcome: 'after' },
      command('UpdateCommitment'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.inverse).toMatchObject({
      name: 'UpdateCommitment',
      payload: { commitmentId: 'c-1', outcome: 'before' },
    });
  });
});

// ── ReorderTeams ───────────────────────────────────────────────────────────

describe('ReorderTeams', () => {
  const second: Team = { ...env('team-2'), ...team, id: 'team-2', name: 'Ledger', displayOrder: 1 };
  const third: Team = { ...env('team-3'), ...team, id: 'team-3', name: 'Risk', displayOrder: 2 };

  function threeTeams(): WorkspaceState {
    return {
      ...state,
      teams: new Map([
        [team.id, team],
        [second.id, second],
        [third.id, third],
      ]),
    };
  }

  it('writes the given order onto displayOrder', () => {
    const result = reorderTeams(
      threeTeams(),
      { orderedTeamIds: ['team-3', 'team-1', 'team-2'] },
      command('ReorderTeams'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const orders = new Map(
      result.effects.changes.map((change) => [
        (change.ref as { id: string }).id,
        (change.after as Team).displayOrder,
      ]),
    );
    expect(orders.get('team-3')).toBe(0);
    expect(orders.get('team-1')).toBe(1);
    expect(orders.get('team-2')).toBe(2);
  });

  it('only writes the rows that actually moved', () => {
    // team-1 is already first, so re-stating it must not produce a write.
    const result = reorderTeams(
      threeTeams(),
      { orderedTeamIds: ['team-1', 'team-3', 'team-2'] },
      command('ReorderTeams'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.changes.map((c) => (c.ref as { id: string }).id).sort()).toEqual([
      'team-2',
      'team-3',
    ]);
  });

  it('keeps a team the caller did not name, after the ones it did', () => {
    const result = reorderTeams(
      threeTeams(),
      { orderedTeamIds: ['team-3'] },
      command('ReorderTeams'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const orders = new Map(
      result.effects.changes.map((change) => [
        (change.ref as { id: string }).id,
        (change.after as Team).displayOrder,
      ]),
    );
    expect(orders.get('team-3')).toBe(0);
    expect(orders.get('team-1')).toBe(1);
  });

  it('is a no-op when the order already holds', () => {
    const result = reorderTeams(
      threeTeams(),
      { orderedTeamIds: ['team-1', 'team-2', 'team-3'] },
      command('ReorderTeams'),
      ctx(),
    );
    expect(result.ok && result.effects.changes).toEqual([]);
  });

  it('carries an inverse restoring the previous order', () => {
    const result = reorderTeams(
      threeTeams(),
      { orderedTeamIds: ['team-3', 'team-2', 'team-1'] },
      command('ReorderTeams'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.inverse?.payload).toEqual({
      orderedTeamIds: ['team-1', 'team-2', 'team-3'],
    });
  });

  it('refuses a Contributor', () => {
    expectError(
      reorderTeams(threeTeams(), { orderedTeamIds: ['team-2'] }, command('R'), ctx('CONTRIBUTOR')),
      'UNAUTHORISED',
    );
  });

  it('refuses an unknown team', () => {
    expectError(
      reorderTeams(threeTeams(), { orderedTeamIds: ['nope'] }, command('R'), ctx()),
      'ENTITY_NOT_FOUND',
    );
  });

  it('refuses the same team twice', () => {
    expectError(
      reorderTeams(threeTeams(), { orderedTeamIds: ['team-1', 'team-1'] }, command('R'), ctx()),
      'DUPLICATE_NAME',
    );
  });
});

// ── SplitCapacityFootprint ─────────────────────────────────────────────────

describe('SplitCapacityFootprint', () => {
  const NEXT: QuarterId = '2026-Q4';

  function placed(units = 20): WorkspaceState {
    const footprint = withFootprint({ units, isPrimary: true });
    return { ...state, footprints: new Map([[footprint.id, footprint]]) };
  }

  it('divides one placement into two, conserving units', () => {
    const result = splitCapacityFootprint(
      placed(20),
      {
        footprintId: 'fp-1',
        into: [
          { quarterId: Q, units: 12 },
          { quarterId: NEXT, units: 8 },
        ],
      },
      command('SplitCapacityFootprint'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.effects.changes.map((c) => c.after as CapacityFootprint);
    expect(after.map((f) => f.units).sort((a, b) => a - b)).toEqual([8, 12]);
    expect(after.reduce((sum, f) => sum + f.units, 0)).toBe(20);
  });

  it('leaves the primary placement where the commitment already sits', () => {
    const result = splitCapacityFootprint(
      placed(20),
      {
        footprintId: 'fp-1',
        into: [
          { quarterId: NEXT, units: 8 },
          { quarterId: Q, units: 12 },
        ],
      },
      command('SplitCapacityFootprint'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const source = result.effects.changes
      .map((c) => c.after as CapacityFootprint)
      .find((f) => f.id === 'fp-1')!;
    expect(source.quarterId).toBe(Q);
    expect(source.units).toBe(12);
    expect(source.isPrimary).toBe(true);
  });

  it('never gives a split-off part the primary flag', () => {
    const result = splitCapacityFootprint(
      placed(20),
      {
        footprintId: 'fp-1',
        into: [
          { quarterId: Q, units: 12 },
          { quarterId: NEXT, units: 8 },
        ],
      },
      command('SplitCapacityFootprint'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = result.effects.changes
      .map((c) => c.after as CapacityFootprint)
      .filter((f) => f.id !== 'fp-1');
    expect(parts.every((f) => !f.isPrimary)).toBe(true);
  });

  it('refuses a split whose parts do not sum to the original', () => {
    expectError(
      splitCapacityFootprint(
        placed(20),
        {
          footprintId: 'fp-1',
          into: [
            { quarterId: Q, units: 12 },
            { quarterId: NEXT, units: 9 },
          ],
        },
        command('S'),
        ctx(),
      ),
      'SPLIT_UNITS_MISMATCH',
    );
  });

  it('refuses a zero-unit part', () => {
    expectError(
      splitCapacityFootprint(
        placed(20),
        {
          footprintId: 'fp-1',
          into: [
            { quarterId: Q, units: 20 },
            { quarterId: NEXT, units: 0 },
          ],
        },
        command('S'),
        ctx(),
      ),
      'FOOTPRINT_UNITS_MUST_BE_POSITIVE',
    );
  });

  it('refuses two parts landing in the same quarter', () => {
    expectError(
      splitCapacityFootprint(
        placed(20),
        {
          footprintId: 'fp-1',
          into: [
            { quarterId: Q, units: 12 },
            { quarterId: Q, units: 8 },
          ],
        },
        command('S'),
        ctx(),
      ),
      'DUPLICATE_FOOTPRINT',
    );
  });

  it('refuses a part landing where this commitment is already placed', () => {
    const source = withFootprint({ units: 20, isPrimary: true });
    const existing = withFootprint({ ...env('fp-2'), quarterId: NEXT, units: 5 });
    const withBoth: WorkspaceState = {
      ...state,
      footprints: new Map([
        [source.id, source],
        [existing.id, existing],
      ]),
    };

    expectError(
      splitCapacityFootprint(
        withBoth,
        {
          footprintId: 'fp-1',
          into: [
            { quarterId: Q, units: 12 },
            { quarterId: NEXT, units: 8 },
          ],
        },
        command('S'),
        ctx(),
      ),
      'DUPLICATE_FOOTPRINT',
    );
  });

  it('refuses a Contributor', () => {
    expectError(
      splitCapacityFootprint(
        placed(20),
        {
          footprintId: 'fp-1',
          into: [
            { quarterId: Q, units: 12 },
            { quarterId: NEXT, units: 8 },
          ],
        },
        command('S'),
        ctx('CONTRIBUTOR'),
      ),
      'UNAUTHORISED',
    );
  });

  it('carries a merge as its inverse, naming the parts it created', () => {
    const result = splitCapacityFootprint(
      placed(20),
      {
        footprintId: 'fp-1',
        into: [
          { quarterId: Q, units: 12 },
          { quarterId: NEXT, units: 8 },
        ],
      },
      command('SplitCapacityFootprint'),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inverse = result.effects.inverse!;
    expect(inverse.name).toBe('MergeCapacityFootprints');
    expect((inverse.payload as { fromFootprintIds: string[] }).fromFootprintIds).toHaveLength(1);
  });

  it('round-trips: split then merge restores the original units in one quarter', () => {
    const start = placed(20);
    const split = splitCapacityFootprint(
      start,
      {
        footprintId: 'fp-1',
        into: [
          { quarterId: Q, units: 12 },
          { quarterId: NEXT, units: 8 },
        ],
      },
      command('SplitCapacityFootprint'),
      ctx(),
    );
    expect(split.ok).toBe(true);
    if (!split.ok) return;

    // Apply the effects, as the repository would.
    const footprints = new Map(start.footprints);
    for (const change of split.effects.changes) {
      const entity = change.after as CapacityFootprint;
      footprints.set(entity.id, entity);
    }
    const afterSplit: WorkspaceState = { ...start, footprints };

    const merge = mergeCapacityFootprints(
      afterSplit,
      split.effects.inverse!.payload as { intoFootprintId: string; fromFootprintIds: string[] },
      command('MergeCapacityFootprints'),
      ctx(),
    );

    expect(merge.ok).toBe(true);
    if (!merge.ok) return;
    const target = merge.effects.changes
      .map((c) => c.after as CapacityFootprint)
      .find((f) => f.id === 'fp-1')!;
    expect(target.units).toBe(20);
    expect(target.quarterId).toBe(Q);
    expect(
      merge.effects.changes
        .filter((c) => c.op === 'ARCHIVE')
        .map((c) => (c.ref as { id: string }).id),
    ).toEqual((split.effects.inverse!.payload as { fromFootprintIds: string[] }).fromFootprintIds);
  });

  it("re-splitting through the merge's inverse restores the same entity, not a look-alike", () => {
    const start = placed(20);
    const split = splitCapacityFootprint(
      start,
      {
        footprintId: 'fp-1',
        into: [
          { quarterId: Q, units: 12 },
          { quarterId: NEXT, units: 8 },
        ],
      },
      command('SplitCapacityFootprint'),
      ctx(),
    );
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const partId = (split.effects.inverse!.payload as { fromFootprintIds: string[] })
      .fromFootprintIds[0]!;

    const footprints = new Map(start.footprints);
    for (const change of split.effects.changes) {
      footprints.set((change.after as CapacityFootprint).id, change.after as CapacityFootprint);
    }
    const merge = mergeCapacityFootprints(
      { ...start, footprints },
      split.effects.inverse!.payload as never,
      command('MergeCapacityFootprints'),
      ctx(),
    );
    expect(merge.ok).toBe(true);
    if (!merge.ok) return;

    const merged = new Map(footprints);
    for (const change of merge.effects.changes) {
      merged.set((change.after as CapacityFootprint).id, change.after as CapacityFootprint);
    }

    const redo = splitCapacityFootprint(
      { ...start, footprints: merged },
      merge.effects.inverse!.payload as never,
      command('SplitCapacityFootprint'),
      ctx(),
    );

    expect(redo.ok).toBe(true);
    if (!redo.ok) return;
    const restored = redo.effects.changes.find((c) => c.op === 'RESTORE');
    expect(restored).toBeDefined();
    expect((restored!.ref as { id: string }).id).toBe(partId);
  });
});

// ── Refinement reserve links ───────────────────────────────────────────────

describe('LinkIdeaToRefinementReserve', () => {
  const refinement: TeamQuarter = {
    ...teamQuarter,
    reserves: [
      { id: 'r1', type: 'BAU_SUPPORT', label: 'BAU', amount: 20 },
      { id: 'r2', type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  };

  function withRefinement(): WorkspaceState {
    return { ...state, teamQuarters: new Map([[refinement.id, refinement]]) };
  }

  it('records the link on the reserve', () => {
    const result = linkIdeaToRefinementReserve(
      withRefinement(),
      { reserveId: 'r2', ideaId: 'c-1' },
      command('LinkIdeaToRefinementReserve'),
      ctx('CONTRIBUTOR'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.effects.changes[0]!.after as TeamQuarter;
    expect(after.reserves.find((r) => r.id === 'r2')?.linkedIdeaIds).toEqual(['c-1']);
  });

  it('allocates no units — the totals are identical before and after', () => {
    const before = summariseCapacity({
      teamQuarter: refinement,
      footprints: [],
      commitmentsById: state.commitments,
      currentQuarterId: Q,
    });

    const result = linkIdeaToRefinementReserve(
      withRefinement(),
      { reserveId: 'r2', ideaId: 'c-1' },
      command('LinkIdeaToRefinementReserve'),
      ctx('CONTRIBUTOR'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = summariseCapacity({
      teamQuarter: result.effects.changes[0]!.after as TeamQuarter,
      footprints: [],
      commitmentsById: state.commitments,
      currentQuarterId: Q,
    });

    expect(after).toEqual(before);
  });

  it('refuses a reserve that is not for refinement', () => {
    expectError(
      linkIdeaToRefinementReserve(
        withRefinement(),
        { reserveId: 'r1', ideaId: 'c-1' },
        command('L'),
        ctx('CONTRIBUTOR'),
      ),
      'REFINEMENT_LINK_NOT_PERMITTED',
    );
  });

  it('refuses work that has passed the Commit Gate', () => {
    const committed = { ...idea, lifecycle: 'COMMITTED' as const };
    expectError(
      linkIdeaToRefinementReserve(
        { ...withRefinement(), commitments: new Map([[committed.id, committed]]) },
        { reserveId: 'r2', ideaId: 'c-1' },
        command('L'),
        ctx('CONTRIBUTOR'),
      ),
      'REFINEMENT_LINK_NOT_PERMITTED',
    );
  });

  it('is idempotent', () => {
    const linked: TeamQuarter = {
      ...refinement,
      reserves: refinement.reserves.map((r) =>
        r.id === 'r2' ? { ...r, linkedIdeaIds: ['c-1'] } : r,
      ),
    };
    const result = linkIdeaToRefinementReserve(
      { ...state, teamQuarters: new Map([[linked.id, linked]]) },
      { reserveId: 'r2', ideaId: 'c-1' },
      command('L'),
      ctx('CONTRIBUTOR'),
    );
    expect(result.ok && result.effects.changes).toEqual([]);
  });

  it('unlinking the last idea leaves the reserve as it started', () => {
    const linked: TeamQuarter = {
      ...refinement,
      reserves: refinement.reserves.map((r) =>
        r.id === 'r2' ? { ...r, linkedIdeaIds: ['c-1'] } : r,
      ),
    };
    const result = unlinkIdeaFromRefinementReserve(
      { ...state, teamQuarters: new Map([[linked.id, linked]]) },
      { reserveId: 'r2', ideaId: 'c-1' },
      command('U'),
      ctx('CONTRIBUTOR'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.effects.changes[0]!.after as TeamQuarter;
    expect(after.reserves.find((r) => r.id === 'r2')).toEqual(refinement.reserves[1]);
  });

  it('carries an unlink as its inverse', () => {
    const result = linkIdeaToRefinementReserve(
      withRefinement(),
      { reserveId: 'r2', ideaId: 'c-1' },
      command('LinkIdeaToRefinementReserve'),
      ctx('CONTRIBUTOR'),
    );
    expect(result.ok && result.effects.inverse?.name).toBe('UnlinkIdeaFromRefinementReserve');
  });
});
