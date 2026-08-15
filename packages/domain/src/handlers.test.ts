import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  assignCapacityFootprint,
  createIdea,
  createTeam,
  createWorkspace,
  ensureTeamQuarter,
  moveCapacityFootprint,
  removeCapacityFootprint,
  resizeCapacityFootprint,
  restoreCapacityFootprint,
} from './handlers.js';
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
