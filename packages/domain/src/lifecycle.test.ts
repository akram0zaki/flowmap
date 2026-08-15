import { describe, expect, it } from 'vitest';

import { applyTransition, assessCommitGate, type LifecyclePayload } from './lifecycle-handlers.js';
import { TRANSITIONS, legalTransitions, type TransitionName } from './lifecycle.js';
import type { HandlerState } from './handler-kit.js';
import type { Command, CommandContext, CommandResult } from './command.js';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type CapacityFootprint,
  type Commitment,
  type Lifecycle,
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

function command(name: string): Command {
  return { id: 'cmd-1', name, workspaceId: WS, payload: {}, actorId: 'actor-1', issuedAt: NOW };
}

function env(id: string) {
  return {
    id,
    workspaceId: WS,
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'a',
    updatedAt: NOW,
    updatedBy: 'a',
  };
}

const workspace: Workspace = {
  ...env(WS),
  name: 'W',
  timezone: 'UTC',
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
  reserves: [],
};

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    ...env('c-1'),
    name: 'SEPA instant',
    lifecycle: 'IDEA',
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    valueDrivers: [],
    primaryTeamId: 'team-1',
    ...over,
  };
}

function footprint(over: Partial<CapacityFootprint> = {}): CapacityFootprint {
  return {
    ...env('fp-1'),
    commitmentId: 'c-1',
    teamId: 'team-1',
    quarterId: Q,
    units: 20,
    unitsSource: 'EXPLICIT',
    isPrimary: true,
    ...over,
  };
}

function makeState(
  c: Commitment,
  footprints: CapacityFootprint[] = [footprint()],
  extra: Partial<HandlerState> = {},
): HandlerState {
  return {
    workspace,
    teams: new Map([[team.id, team]]),
    teamQuarters: new Map([[teamQuarter.id, teamQuarter]]),
    commitments: new Map([[c.id, c]]),
    footprints: new Map(footprints.map((f) => [f.id, f])),
    ...extra,
  };
}

function run(
  name: TransitionName,
  state: HandlerState,
  payload: Partial<LifecyclePayload> = {},
  role: WorkspaceRole = 'PLANNER',
): CommandResult {
  return applyTransition(
    name,
    state,
    { commitmentId: 'c-1', ...payload },
    command(name),
    ctx(role),
  );
}

function expectError(result: CommandResult, code: string): void {
  expect(result.ok, `expected ${code}, got success`).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

// ── The transition table ───────────────────────────────────────────────────

describe('transition table', () => {
  it('permits every legal move and rejects everything else', () => {
    const legal = new Set(legalTransitions().map((t) => `${t.name}:${t.from}`));
    const all: Lifecycle[] = ['IDEA', 'COMMITTED', 'IN_DELIVERY', 'ON_HOLD', 'DONE', 'DROPPED'];

    for (const transition of TRANSITIONS) {
      for (const from of all) {
        const isLegal = legal.has(`${transition.name}:${from}`);
        const state = makeState(
          commitment({
            lifecycle: from,
            class: 'DISCRETIONARY',
            ...(from === 'ON_HOLD' ? { priorActiveLifecycle: 'COMMITTED' as const } : {}),
          }),
        );
        const result = run(transition.name, state);

        if (isLegal) {
          expect(result.ok, `${transition.name} from ${from} should be legal`).toBe(true);
        } else {
          expect(result.ok, `${transition.name} from ${from} should be illegal`).toBe(false);
          if (!result.ok) expect(result.error.code).toBe('ILLEGAL_LIFECYCLE_TRANSITION');
        }
      }
    }
  });

  it('leaves DONE and DROPPED terminal', () => {
    for (const terminal of ['DONE', 'DROPPED'] as const) {
      for (const transition of TRANSITIONS) {
        const result = run(transition.name, makeState(commitment({ lifecycle: terminal })));
        expect(result.ok, `${transition.name} from ${terminal}`).toBe(false);
      }
    }
  });
});

// ── Commit Gate ────────────────────────────────────────────────────────────

describe('Commit Gate', () => {
  it('promotes an Idea and records what was agreed', () => {
    const result = run('PassCommitGate', makeState(commitment()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.effects.changes[0]!.after as Commitment;
    expect(after.lifecycle).toBe('COMMITTED');
    expect(after.committedAt).toBe(NOW);
    expect(after.committedBy).toBe('actor-1');
    // Frozen so growth can be measured against what was actually accepted.
    expect(after.unitsAtCommit).toBe(20);
    expect(result.effects.events[0]!.eventType).toBe('COMMITMENT_COMMITTED');
  });

  it('requires a primary team', () => {
    const c = commitment();
    const { primaryTeamId: _p, ...withoutTeam } = c;
    expectError(
      run('PassCommitGate', makeState(withoutTeam as Commitment)),
      'COMMIT_GATE_PRIMARY_TEAM_REQUIRED',
    );
  });

  it('requires at least one footprint', () => {
    expectError(
      run('PassCommitGate', makeState(commitment(), [])),
      'COMMIT_GATE_FOOTPRINT_REQUIRED',
    );
  });

  it('requires the primary team to have its own primary footprint', () => {
    // An accountability label with no capacity behind it is exactly what the
    // model refuses.
    expectError(
      run('PassCommitGate', makeState(commitment(), [footprint({ isPrimary: false })])),
      'COMMIT_GATE_PRIMARY_FOOTPRINT_MISMATCH',
    );
  });

  it('rejects a primary footprint on a different team', () => {
    expectError(
      run('PassCommitGate', makeState(commitment(), [footprint({ teamId: 'team-2' })])),
      'COMMIT_GATE_PRIMARY_FOOTPRINT_MISMATCH',
    );
  });

  it('requires a target date for mandatory work', () => {
    expectError(
      run('PassCommitGate', makeState(commitment({ class: 'MANDATORY' }))),
      'MANDATORY_TARGET_DATE_REQUIRED',
    );
  });

  it('accepts mandatory work once it has a target date', () => {
    const result = run(
      'PassCommitGate',
      makeState(commitment({ class: 'MANDATORY', targetDate: '2026-12-15' })),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a Contributor', () => {
    expectError(run('PassCommitGate', makeState(commitment()), {}, 'CONTRIBUTOR'), 'UNAUTHORISED');
  });

  // Overflow is permitted and explained, never blocked (spec 02 §6).
  it('does not block on overflow', () => {
    const state = makeState(commitment(), [footprint({ units: 500 })]);
    expect(run('PassCommitGate', state).ok).toBe(true);
  });
});

describe('assessCommitGate advisories', () => {
  const base = {
    footprints: [footprint()],
    hasProductImpact: true,
    dependenciesReviewed: true,
    largeThreshold: 35,
  };

  it('reports gaps without making them blockers', () => {
    const readiness = assessCommitGate({
      ...base,
      commitment: commitment(),
      hasProductImpact: false,
      dependenciesReviewed: false,
    });

    expect(readiness.ready, 'advisories never block').toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.advisories).toEqual(
      expect.arrayContaining([
        'RDY_NO_OWNER',
        'RDY_NO_TARGET',
        'RDY_NO_OUTCOME',
        'RDY_NO_PRODUCT_IMPACT',
        'RDY_NO_DEPENDENCIES_REVIEWED',
      ]),
    );
  });

  it('flags low size confidence on large work', () => {
    const readiness = assessCommitGate({
      ...base,
      commitment: commitment({ sizeConfidence: 'LOW' }),
      footprints: [footprint({ units: 40 })],
    });
    expect(readiness.advisories).toContain('RDY_LOW_CONFIDENCE_LARGE');
  });

  it('flags work spanning more than three quarters', () => {
    const readiness = assessCommitGate({
      ...base,
      commitment: commitment(),
      footprints: [
        footprint({ id: 'f1', quarterId: '2026-Q3' }),
        footprint({ id: 'f2', quarterId: '2026-Q4' }),
        footprint({ id: 'f3', quarterId: '2027-Q1' }),
        footprint({ id: 'f4', quarterId: '2027-Q2' }),
      ],
    });
    expect(readiness.advisories).toContain('RDY_SPANS_MANY_QUARTERS');
  });

  it('is clean for a fully prepared commitment', () => {
    const readiness = assessCommitGate({
      ...base,
      commitment: commitment({
        ownerRef: { kind: 'PERSON', personId: 'p1' },
        targetQuarterId: Q,
        outcome: 'Instant payments live',
        sizeConfidence: 'HIGH',
      }),
    });
    expect(readiness.blockers).toEqual([]);
    expect(readiness.advisories).toEqual([]);
  });
});

// ── Hold and resume ────────────────────────────────────────────────────────

describe('hold and resume', () => {
  it('records where a hold came from and returns there', () => {
    const held = run('HoldCommitment', makeState(commitment({ lifecycle: 'IN_DELIVERY' })));
    expect(held.ok).toBe(true);
    if (!held.ok) return;

    const afterHold = held.effects.changes[0]!.after as Commitment;
    expect(afterHold.lifecycle).toBe('ON_HOLD');
    expect(afterHold.priorActiveLifecycle).toBe('IN_DELIVERY');

    const resumed = run('ResumeCommitment', makeState(afterHold));
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;

    const afterResume = resumed.effects.changes[0]!.after as Commitment;
    expect(afterResume.lifecycle).toBe('IN_DELIVERY');
    expect(afterResume.priorActiveLifecycle).toBeUndefined();
  });

  it('resumes to COMMITTED when the prior state was not recorded', () => {
    const result = run('ResumeCommitment', makeState(commitment({ lifecycle: 'ON_HOLD' })));
    if (result.ok) {
      expect((result.effects.changes[0]!.after as Commitment).lifecycle).toBe('COMMITTED');
    }
  });
});

// ── Revert ─────────────────────────────────────────────────────────────────

describe('RevertCommitGate', () => {
  it('returns a committed item to Idea and clears the commit record', () => {
    const result = run(
      'RevertCommitGate',
      makeState(commitment({ lifecycle: 'COMMITTED', committedAt: NOW, unitsAtCommit: 20 })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.effects.changes[0]!.after as Commitment;
    expect(after.lifecycle).toBe('IDEA');
    expect(after.committedAt).toBeUndefined();
    expect(after.unitsAtCommit).toBeUndefined();
  });

  it('refuses once delivery has ever started', () => {
    // Otherwise a commitment could lose capacity it is actively consuming.
    const state = makeState(
      commitment({ lifecycle: 'COMMITTED', committedAt: NOW }),
      [footprint()],
      {
        everInDelivery: () => true,
      },
    );
    expectError(run('RevertCommitGate', state), 'ILLEGAL_LIFECYCLE_TRANSITION');
  });
});

// ── Drop ───────────────────────────────────────────────────────────────────

describe('DropCommitment', () => {
  it('lets a Contributor drop their own Idea', () => {
    expect(run('DropCommitment', makeState(commitment()), {}, 'CONTRIBUTOR').ok).toBe(true);
  });

  it('requires a Planner to drop committed work', () => {
    expectError(
      run('DropCommitment', makeState(commitment({ lifecycle: 'COMMITTED' })), {}, 'CONTRIBUTOR'),
      'UNAUTHORISED',
    );
  });
});

// ── Cross-cutting ──────────────────────────────────────────────────────────

describe('every transition', () => {
  const cases: Array<[TransitionName, Lifecycle]> = [
    ['PassCommitGate', 'IDEA'],
    ['StartDelivery', 'COMMITTED'],
    ['CompleteCommitment', 'IN_DELIVERY'],
    ['HoldCommitment', 'COMMITTED'],
  ];

  it.each(cases)('%s stamps lastMeaningfulUpdateAt', (name, from) => {
    const result = run(name, makeState(commitment({ lifecycle: from })));
    if (result.ok) {
      expect((result.effects.changes[0]!.after as Commitment).lastMeaningfulUpdateAt).toBe(NOW);
    }
  });

  it.each(cases)('%s invalidates the capacity projection of every footprint', (name, from) => {
    const result = run(name, makeState(commitment({ lifecycle: from })));
    if (result.ok) {
      expect(result.effects.affectedProjections).toContain('capacity:team-1:2026-Q3');
    }
  });

  it('rejects an archived commitment', () => {
    expectError(
      run('PassCommitGate', makeState(commitment({ archivedAt: NOW }))),
      'ENTITY_ARCHIVED',
    );
  });

  it('rejects an unknown commitment', () => {
    const state = makeState(commitment());
    const result = applyTransition(
      'PassCommitGate',
      state,
      { commitmentId: 'nope' },
      command('PassCommitGate'),
      ctx(),
    );
    expectError(result, 'ENTITY_NOT_FOUND');
  });
});
