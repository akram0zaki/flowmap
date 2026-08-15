import { beforeEach, describe, expect, it } from 'vitest';

import {
  addDependency,
  addExternalLink,
  addMilestone,
  createDecision,
  createProductService,
  createTheme,
  removeDependency,
  removeExternalLink,
  removeMilestone,
  removeProductImpact,
  setProductImpact,
  updateDecision,
  updateDependency,
  updateMilestone,
  type RelationState,
} from './relations.js';
import type { Command, CommandContext, CommandResult } from './command.js';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type Commitment,
  type Decision,
  type Dependency,
  type Milestone,
  type ProductImpact,
  type ProductService,
  type Team,
  type Workspace,
  type WorkspaceRole,
} from './entities.js';

const NOW = '2026-08-15T09:00:00Z';
const WS = 'ws-1';

class TestIds {
  #n = 0;
  next() {
    this.#n += 1;
    return `new-${this.#n}`;
  }
}

function ctx(role: WorkspaceRole = 'CONTRIBUTOR'): CommandContext {
  return {
    clock: { now: () => NOW, today: () => '2026-08-15' },
    ids: new TestIds(),
    actorId: 'actor-1',
    role,
    nextSequence: 1,
  };
}

const command = (name: string): Command => ({
  id: 'cmd-1',
  name,
  workspaceId: WS,
  payload: {},
  actorId: 'actor-1',
  issuedAt: NOW,
});

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
  currentQuarterId: '2026-Q3',
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

const source: Commitment = {
  ...env('c-1'),
  name: 'SEPA instant',
  lifecycle: 'COMMITTED',
  class: 'DISCRETIONARY',
  importance: 'MEDIUM',
  valueDrivers: [],
  targetQuarterId: '2026-Q3',
};

const other: Commitment = { ...source, ...env('c-2'), name: 'Ledger' };

const product: ProductService = { ...env('p-1'), name: 'Payments Hub', active: true };
const product2: ProductService = { ...env('p-2'), name: 'Fraud', active: true };

let state: RelationState;

beforeEach(() => {
  state = {
    workspace,
    teams: new Map([[team.id, team]]),
    teamQuarters: new Map(),
    commitments: new Map([
      [source.id, source],
      [other.id, other],
    ]),
    footprints: new Map(),
    products: new Map([
      [product.id, product],
      [product2.id, product2],
    ]),
    impacts: new Map(),
    dependencies: new Map(),
    decisions: new Map(),
    milestones: new Map(),
    themes: new Map(),
    links: new Map(),
  };
});

function expectError(result: CommandResult, code: string): void {
  expect(result.ok, `expected ${code}, got success`).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

// ── Products ───────────────────────────────────────────────────────────────

describe('createProductService', () => {
  it('creates a product', () => {
    const result = createProductService(
      state,
      { name: 'Onboarding' },
      command('x'),
      ctx('PLANNER'),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a duplicate name regardless of case', () => {
    expectError(
      createProductService(state, { name: 'payments hub' }, command('x'), ctx('PLANNER')),
      'DUPLICATE_NAME',
    );
  });

  it('refuses a Contributor', () => {
    expectError(createProductService(state, { name: 'X' }, command('x'), ctx()), 'UNAUTHORISED');
  });
});

// ── Product impact ─────────────────────────────────────────────────────────

describe('setProductImpact', () => {
  function impact(over: Partial<ProductImpact> = {}): ProductImpact {
    return {
      ...env('i-1'),
      commitmentId: 'c-1',
      productServiceId: 'p-1',
      type: 'PRIMARY',
      ...over,
    };
  }

  it('adds a typed impact and invalidates the product-quarter change load', () => {
    const result = setProductImpact(
      state,
      { commitmentId: 'c-1', productServiceId: 'p-1', type: 'MAJOR' },
      command('x'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect((result.effects.changes[0]!.after as ProductImpact).type).toBe('MAJOR');
    expect(result.effects.affectedProjections).toContain('changeLoad:p-1:2026-Q3');
  });

  // The focal point: two primaries means neither is one.
  it('refuses a second PRIMARY on the same commitment', () => {
    state = { ...state, impacts: new Map([['i-1', impact()]]) };
    expectError(
      setProductImpact(
        state,
        { commitmentId: 'c-1', productServiceId: 'p-2', type: 'PRIMARY' },
        command('x'),
        ctx(),
      ),
      'MULTIPLE_PRIMARY_IMPACTS',
    );
  });

  it('allows PRIMARY on a different commitment', () => {
    state = { ...state, impacts: new Map([['i-1', impact()]]) };
    expect(
      setProductImpact(
        state,
        { commitmentId: 'c-2', productServiceId: 'p-1', type: 'PRIMARY' },
        command('x'),
        ctx(),
      ).ok,
    ).toBe(true);
  });

  it('allows re-setting PRIMARY on the same product', () => {
    state = { ...state, impacts: new Map([['i-1', impact({ type: 'MAJOR' })]]) };
    const result = setProductImpact(
      state,
      { commitmentId: 'c-1', productServiceId: 'p-1', type: 'PRIMARY' },
      command('x'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.effects.events[0]!.eventType).toBe('PRODUCT_IMPACT_RETYPED');
  });

  it('is a no-op when nothing changes', () => {
    state = { ...state, impacts: new Map([['i-1', impact({ type: 'MAJOR' })]]) };
    const result = setProductImpact(
      state,
      { commitmentId: 'c-1', productServiceId: 'p-1', type: 'MAJOR' },
      command('x'),
      ctx(),
    );
    if (result.ok) expect(result.effects.changes).toHaveLength(0);
  });

  it('rejects an unknown commitment or product', () => {
    expectError(
      setProductImpact(
        state,
        { commitmentId: 'nope', productServiceId: 'p-1', type: 'MAJOR' },
        command('x'),
        ctx(),
      ),
      'ENTITY_NOT_FOUND',
    );
    expectError(
      setProductImpact(
        state,
        { commitmentId: 'c-1', productServiceId: 'nope', type: 'MAJOR' },
        command('x'),
        ctx(),
      ),
      'ENTITY_NOT_FOUND',
    );
  });

  it('rejects an over-long note', () => {
    expectError(
      setProductImpact(
        state,
        { commitmentId: 'c-1', productServiceId: 'p-1', type: 'MAJOR', note: 'x'.repeat(281) },
        command('x'),
        ctx(),
      ),
      'NOTE_TOO_LONG',
    );
  });

  it('archives rather than deletes on removal', () => {
    state = { ...state, impacts: new Map([['i-1', impact()]]) };
    const result = removeProductImpact(state, { impactId: 'i-1' }, command('x'), ctx());
    if (result.ok) expect(result.effects.changes[0]!.op).toBe('ARCHIVE');
  });
});

// ── Dependencies ───────────────────────────────────────────────────────────

describe('addDependency', () => {
  it('defaults to REQUIRES and OPEN', () => {
    const result = addDependency(
      state,
      { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-2' } },
      command('x'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dep = result.effects.changes[0]!.after as Dependency;
    expect(dep.type).toBe('REQUIRES');
    expect(dep.status).toBe('OPEN');
    expect(dep.isHard).toBe(false);
  });

  it.each([
    ['BLOCKED_BY', true],
    ['NEEDS_DECISION_APPROVAL_FROM', true],
    ['REQUIRES', false],
    ['DEPENDS_ON_DELIVERY', false],
  ] as const)('marks %s as hard=%s', (type, isHard) => {
    const result = addDependency(
      state,
      { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-2' }, type },
      command('x'),
      ctx(),
    );
    if (result.ok) expect((result.effects.changes[0]!.after as Dependency).isHard).toBe(isHard);
  });

  // Direction never flips: source waits, target unblocks.
  it('records the waiting side as source', () => {
    const result = addDependency(
      state,
      { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-2' } },
      command('x'),
      ctx(),
    );
    if (result.ok) {
      const dep = result.effects.changes[0]!.after as Dependency;
      expect(dep.sourceCommitmentId).toBe('c-1');
      expect(dep.target).toEqual({ kind: 'COMMITMENT', id: 'c-2' });
    }
  });

  it('refuses a self-dependency', () => {
    expectError(
      addDependency(
        state,
        { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-1' } },
        command('x'),
        ctx(),
      ),
      'SELF_DEPENDENCY',
    );
  });

  it('refuses an exact duplicate', () => {
    const dep: Dependency = {
      ...env('d-1'),
      sourceCommitmentId: 'c-1',
      target: { kind: 'COMMITMENT', id: 'c-2' },
      type: 'REQUIRES',
      status: 'OPEN',
      isHard: false,
    };
    state = { ...state, dependencies: new Map([['d-1', dep]]) };
    expectError(
      addDependency(
        state,
        { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-2' } },
        command('x'),
        ctx(),
      ),
      'DUPLICATE_DEPENDENCY',
    );
  });

  it('allows the same pair with a different type', () => {
    const dep: Dependency = {
      ...env('d-1'),
      sourceCommitmentId: 'c-1',
      target: { kind: 'COMMITMENT', id: 'c-2' },
      type: 'REQUIRES',
      status: 'OPEN',
      isHard: false,
    };
    state = { ...state, dependencies: new Map([['d-1', dep]]) };
    expect(
      addDependency(
        state,
        {
          sourceCommitmentId: 'c-1',
          target: { kind: 'COMMITMENT', id: 'c-2' },
          type: 'BLOCKED_BY',
        },
        command('x'),
        ctx(),
      ).ok,
    ).toBe(true);
  });

  // Cycles represent reality and are warned about, never blocked.
  it('permits a cycle', () => {
    const dep: Dependency = {
      ...env('d-1'),
      sourceCommitmentId: 'c-2',
      target: { kind: 'COMMITMENT', id: 'c-1' },
      type: 'REQUIRES',
      status: 'OPEN',
      isHard: false,
    };
    state = { ...state, dependencies: new Map([['d-1', dep]]) };
    expect(
      addDependency(
        state,
        { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-2' } },
        command('x'),
        ctx(),
      ).ok,
      'a cycle is representable, not a validation failure',
    ).toBe(true);
  });

  it.each([
    ['TEAM', 'team-1', true],
    ['TEAM', 'nope', false],
    ['DECISION', 'nope', false],
  ] as const)('resolves a %s target (%s exists: %s)', (kind, id, exists) => {
    const result = addDependency(
      state,
      { sourceCommitmentId: 'c-1', target: { kind, id } },
      command('x'),
      ctx(),
    );
    expect(result.ok).toBe(exists);
  });

  it('refuses a Viewer', () => {
    expectError(
      addDependency(
        state,
        { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-2' } },
        command('x'),
        ctx('VIEWER'),
      ),
      'UNAUTHORISED',
    );
  });
});

describe('updateDependency', () => {
  const dep: Dependency = {
    ...env('d-1'),
    sourceCommitmentId: 'c-1',
    target: { kind: 'COMMITMENT', id: 'c-2' },
    type: 'REQUIRES',
    status: 'OPEN',
    isHard: false,
  };

  beforeEach(() => {
    state = { ...state, dependencies: new Map([['d-1', dep]]) };
  });

  it('recomputes hardness when the type changes', () => {
    const result = updateDependency(
      state,
      { dependencyId: 'd-1', type: 'BLOCKED_BY' },
      command('x'),
      ctx(),
    );
    if (result.ok) {
      const after = result.effects.changes[0]!.after as Dependency;
      expect(after.isHard).toBe(true);
      expect(result.effects.changes[0]!.changedFields).toEqual(
        expect.arrayContaining(['type', 'isHard']),
      );
    }
  });

  it('is a no-op when nothing changes', () => {
    const result = updateDependency(
      state,
      { dependencyId: 'd-1', type: 'REQUIRES', status: 'OPEN' },
      command('x'),
      ctx(),
    );
    if (result.ok) expect(result.effects.changes).toHaveLength(0);
  });

  it('refuses retargeting onto itself', () => {
    expectError(
      updateDependency(
        state,
        { dependencyId: 'd-1', target: { kind: 'COMMITMENT', id: 'c-1' } },
        command('x'),
        ctx(),
      ),
      'SELF_DEPENDENCY',
    );
  });

  it('archives rather than deletes on removal', () => {
    const result = removeDependency(state, { dependencyId: 'd-1' }, command('x'), ctx());
    if (result.ok) expect(result.effects.changes[0]!.op).toBe('ARCHIVE');
  });
});

// ── Decisions ──────────────────────────────────────────────────────────────

describe('decisions', () => {
  it('creates an open decision needing neither owner nor date', () => {
    const result = createDecision(state, { name: 'Hub architecture' }, command('x'), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decision = result.effects.changes[0]!.after as Decision;
    expect(decision.status).toBe('OPEN');
    expect(decision.kind).toBe('DECISION');
    expect(decision.ownerRef).toBeUndefined();
    expect(decision.neededBy).toBeUndefined();
  });

  it('stamps resolvedAt when it is resolved', () => {
    const decision: Decision = { ...env('dec-1'), kind: 'DECISION', name: 'D', status: 'OPEN' };
    state = { ...state, decisions: new Map([['dec-1', decision]]) };

    const result = updateDecision(
      state,
      { decisionId: 'dec-1', status: 'RESOLVED' },
      command('x'),
      ctx(),
    );
    if (result.ok) {
      expect((result.effects.changes[0]!.after as Decision).resolvedAt).toBe(NOW);
      expect(result.effects.events[0]!.eventType).toBe('DECISION_RESOLVED');
    }
  });

  it('can be a dependency target once it exists', () => {
    const decision: Decision = { ...env('dec-1'), kind: 'APPROVAL', name: 'D', status: 'OPEN' };
    state = { ...state, decisions: new Map([['dec-1', decision]]) };
    expect(
      addDependency(
        state,
        { sourceCommitmentId: 'c-1', target: { kind: 'DECISION', id: 'dec-1' } },
        command('x'),
        ctx(),
      ).ok,
    ).toBe(true);
  });
});

// ── Milestones ─────────────────────────────────────────────────────────────

describe('milestones', () => {
  function milestone(id: string): Milestone {
    return {
      ...env(id),
      commitmentId: 'c-1',
      name: id,
      status: 'PLANNED',
      displayOrder: 0,
    };
  }

  it('adds a planned milestone', () => {
    const result = addMilestone(
      state,
      { commitmentId: 'c-1', name: 'Cutover' },
      command('x'),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.effects.changes[0]!.after as Milestone).status).toBe('PLANNED');
  });

  it('caps at six per commitment', () => {
    state = {
      ...state,
      milestones: new Map(
        Array.from({ length: 6 }, (_, i) => [`m-${i}`, milestone(`m-${i}`)] as const),
      ),
    };
    expectError(
      addMilestone(state, { commitmentId: 'c-1', name: 'Seventh' }, command('x'), ctx()),
      'TOO_MANY_MILESTONES',
    );
  });

  it('counts only live milestones toward the cap', () => {
    state = {
      ...state,
      milestones: new Map(
        Array.from({ length: 6 }, (_, i) => [
          `m-${i}`,
          { ...milestone(`m-${i}`), archivedAt: NOW },
        ]),
      ),
    };
    expect(addMilestone(state, { commitmentId: 'c-1', name: 'OK' }, command('x'), ctx()).ok).toBe(
      true,
    );
  });

  it('sets MISSED explicitly rather than deriving it', () => {
    state = { ...state, milestones: new Map([['m-1', milestone('m-1')]]) };
    const result = updateMilestone(
      state,
      { milestoneId: 'm-1', status: 'MISSED' },
      command('x'),
      ctx(),
    );
    if (result.ok) expect((result.effects.changes[0]!.after as Milestone).status).toBe('MISSED');
  });

  it('archives rather than deletes on removal', () => {
    state = { ...state, milestones: new Map([['m-1', milestone('m-1')]]) };
    const result = removeMilestone(state, { milestoneId: 'm-1' }, command('x'), ctx());
    if (result.ok) expect(result.effects.changes[0]!.op).toBe('ARCHIVE');
  });
});

// ── Themes and links ───────────────────────────────────────────────────────

describe('themes', () => {
  it('requires a Planner, because themes are a workspace taxonomy', () => {
    expectError(createTheme(state, { name: 'Resilience' }, command('x'), ctx()), 'UNAUTHORISED');
    expect(createTheme(state, { name: 'Resilience' }, command('x'), ctx('PLANNER')).ok).toBe(true);
  });
});

describe('external links', () => {
  it.each(['http://example.com', 'ftp://example.com', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'refuses %s',
    (url) => {
      expectError(
        addExternalLink(state, { commitmentId: 'c-1', type: 'GENERIC', url }, command('x'), ctx()),
        'INSECURE_URL',
      );
    },
  );

  it('accepts https', () => {
    expect(
      addExternalLink(
        state,
        { commitmentId: 'c-1', type: 'AZURE_DEVOPS', url: 'https://dev.azure.com/x' },
        command('x'),
        ctx(),
      ).ok,
    ).toBe(true);
  });

  it('archives rather than deletes on removal', () => {
    state = {
      ...state,
      links: new Map([
        ['l-1', { ...env('l-1'), commitmentId: 'c-1', type: 'GENERIC' as const, url: 'https://x' }],
      ]),
    };
    const result = removeExternalLink(state, { linkId: 'l-1' }, command('x'), ctx());
    if (result.ok) expect(result.effects.changes[0]!.op).toBe('ARCHIVE');
  });
});
