/**
 * A firing and a non-firing fixture for every rule code.
 *
 * Spec 04 §8.7 makes this a hard requirement, and the coverage test at the
 * bottom asserts it mechanically — adding a code without a pair of cases fails
 * the suite rather than quietly shipping a rule nobody has ever seen fire.
 */

import { describe, expect, it } from 'vitest';

import { ALL_RULES, RULES_BY_CODE, missingImplementations } from './catalogue.js';
import { evaluateAll } from './engine.js';
import { RULE_CODES, type RuleCode, type RuleResult } from './types.js';
import {
  Q,
  NEXT_Q,
  commitment,
  ctx,
  decision,
  dependency,
  env,
  footprint,
  impact,
  link,
  milestone,
  person,
  product,
  state,
  team,
  teamQuarter,
  workspace,
  type StateParts,
} from './test-support.js';

/** Runs the whole catalogue and reports which codes fired. */
function fired(parts: StateParts, overrides: Parameters<typeof ctx>[0] = {}): Set<RuleCode> {
  const results = evaluateAll(ALL_RULES, state(parts), ctx(overrides));
  return new Set(results.map((r) => r.ruleCode));
}

function signalsFor(
  code: RuleCode,
  parts: StateParts,
  overrides: Parameters<typeof ctx>[0] = {},
): RuleResult[] {
  const rule = RULES_BY_CODE.get(code)!;
  return evaluateAll([rule], state(parts), ctx(overrides));
}

/** Declares a rule's pair of cases and asserts both in one go. */
function cases(
  code: RuleCode,
  positive: StateParts,
  negative: StateParts,
  overrides: Parameters<typeof ctx>[0] = {},
) {
  describe(code, () => {
    it('fires on the condition it describes', () => {
      expect(signalsFor(code, positive, overrides).length).toBeGreaterThan(0);
    });

    it('stays silent when the condition does not hold', () => {
      expect(signalsFor(code, negative, overrides)).toEqual([]);
    });
  });
}

// ── Capacity ───────────────────────────────────────────────────────────────

const overloadedTeam: StateParts = {
  teams: [team('t-1')],
  teamQuarters: [teamQuarter('tq-1', 't-1', Q, { capacityBaseline: 100 })],
  commitments: [commitment('c-1')],
  footprints: [footprint('f-1', 'c-1', 't-1', Q, 120)],
};

const healthyTeam: StateParts = {
  teams: [team('t-1')],
  teamQuarters: [teamQuarter('tq-1', 't-1', Q)],
  commitments: [commitment('c-1')],
  footprints: [footprint('f-1', 'c-1', 't-1', Q, 20)],
};

cases('CAP_OVERFLOW', overloadedTeam, healthyTeam);

cases(
  'CAP_NEAR_LIMIT',
  {
    ...healthyTeam,
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 98)],
  },
  healthyTeam,
);

cases(
  'CAP_NO_DELIVERABLE',
  {
    teams: [team('t-1')],
    teamQuarters: [
      teamQuarter('tq-1', 't-1', Q, {
        reserves: [{ id: 'r-1', type: 'BAU_SUPPORT', label: 'BAU', amount: 100 }],
      }),
    ],
    commitments: [commitment('c-1')],
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 10)],
  },
  healthyTeam,
);

cases(
  'CAP_PRIMARY_FOOTPRINT_MISSING',
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { primaryTeamId: 't-1' })],
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 20, { isPrimary: false })],
  },
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { primaryTeamId: 't-1' })],
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 20, { isPrimary: true })],
  },
);

cases(
  'CAP_NO_FOOTPRINT',
  { commitments: [commitment('c-1', { lifecycle: 'IN_DELIVERY' })], footprints: [] },
  healthyTeam,
);

cases(
  'CAP_SPAN_LONG',
  {
    ...healthyTeam,
    teamQuarters: [teamQuarter('tq-1', 't-1', Q), teamQuarter('tq-2', 't-1', '2027-Q3')],
    footprints: [
      footprint('f-1', 'c-1', 't-1', Q, 10),
      footprint('f-2', 'c-1', 't-1', '2027-Q3', 10),
    ],
  },
  healthyTeam,
);

cases(
  'CAP_ADJUSTMENT_UNEXPLAINED',
  {
    teams: [team('t-1')],
    teamQuarters: [teamQuarter('tq-1', 't-1', Q, { capacityAdjustment: -10 })],
  },
  {
    teams: [team('t-1')],
    teamQuarters: [
      teamQuarter('tq-1', 't-1', Q, { capacityAdjustment: -10, adjustmentNote: 'Vacancy' }),
    ],
  },
);

// ── Dependencies ───────────────────────────────────────────────────────────

const twoCommitments = [commitment('c-1'), commitment('c-2')];

cases(
  'DEP_OVERDUE',
  { commitments: twoCommitments, dependencies: [dependency('d-1', { neededBy: '2026-08-01' })] },
  { commitments: twoCommitments, dependencies: [dependency('d-1', { neededBy: '2026-09-01' })] },
);

cases(
  'DEP_DUE_SOON',
  { commitments: twoCommitments, dependencies: [dependency('d-1', { neededBy: '2026-08-20' })] },
  { commitments: twoCommitments, dependencies: [dependency('d-1', { neededBy: '2026-12-01' })] },
);

cases(
  'DEP_AT_RISK',
  { commitments: twoCommitments, dependencies: [dependency('d-1', { status: 'AT_RISK' })] },
  { commitments: twoCommitments, dependencies: [dependency('d-1', { status: 'OPEN' })] },
);

cases(
  'DEP_NO_NEEDED_BY',
  { commitments: twoCommitments, dependencies: [dependency('d-1', { isHard: true })] },
  {
    commitments: twoCommitments,
    dependencies: [dependency('d-1', { isHard: true, neededBy: '2026-09-01' })],
  },
);

cases(
  'DEP_TARGET_MOVED_LATE',
  {
    commitments: [
      commitment('c-1', { targetQuarterId: Q }),
      commitment('c-2', { targetQuarterId: NEXT_Q }),
    ],
    dependencies: [dependency('d-1')],
  },
  {
    commitments: [
      commitment('c-1', { targetQuarterId: NEXT_Q }),
      commitment('c-2', { targetQuarterId: Q }),
    ],
    dependencies: [dependency('d-1')],
  },
);

cases(
  'DEP_TARGET_AFTER_NEEDED_BY',
  {
    commitments: [commitment('c-1'), commitment('c-2', { targetDate: '2026-12-01' })],
    dependencies: [dependency('d-1', { neededBy: '2026-10-01' })],
  },
  {
    commitments: [commitment('c-1'), commitment('c-2', { targetDate: '2026-09-01' })],
    dependencies: [dependency('d-1', { neededBy: '2026-10-01' })],
  },
);

cases(
  'DEP_CYCLE',
  {
    commitments: twoCommitments,
    dependencies: [
      dependency('d-1', { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-2' } }),
      dependency('d-2', { sourceCommitmentId: 'c-2', target: { kind: 'COMMITMENT', id: 'c-1' } }),
    ],
  },
  {
    commitments: twoCommitments,
    dependencies: [
      dependency('d-1', { sourceCommitmentId: 'c-1', target: { kind: 'COMMITMENT', id: 'c-2' } }),
    ],
  },
);

const hub: StateParts = {
  commitments: [
    commitment('c-1'),
    commitment('c-2'),
    commitment('c-3'),
    commitment('c-4'),
    commitment('c-5'),
    commitment('c-6'),
  ],
  teams: [team('t-1')],
  dependencies: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'].map((source, i) =>
    dependency(`d-${i}`, {
      sourceCommitmentId: source,
      target: { kind: 'TEAM', id: 't-1' },
    }),
  ),
};

cases('DEP_HUB', hub, {
  ...hub,
  dependencies: hub.dependencies!.slice(0, 2),
});

cases(
  'DEP_HUB_CONSTRAINED',
  {
    ...hub,
    teamQuarters: [teamQuarter('tq-1', 't-1', Q)],
    footprints: [footprint('f-1', 'c-6', 't-1', Q, 150)],
  },
  { ...hub, teamQuarters: [teamQuarter('tq-1', 't-1', Q)] },
);

cases(
  'DEP_DECISION_OVERDUE',
  { decisions: [decision('dec-1', { neededBy: '2026-08-01' })] },
  { decisions: [decision('dec-1', { neededBy: '2026-09-01' })] },
);

cases(
  'DEP_DECISION_UNOWNED',
  { decisions: [decision('dec-1', { neededBy: '2026-09-01' })] },
  {
    decisions: [
      decision('dec-1', { neededBy: '2026-09-01', ownerRef: { kind: 'PERSON', personId: 'p-1' } }),
    ],
  },
);

cases(
  'DEP_TARGET_ARCHIVED',
  {
    commitments: [commitment('c-1'), commitment('c-2', { archivedAt: '2026-08-01T00:00:00Z' })],
    dependencies: [dependency('d-1')],
  },
  { commitments: twoCommitments, dependencies: [dependency('d-1')] },
);

cases(
  'DEP_BLOCKED_IN_DELIVERY',
  {
    commitments: [commitment('c-1', { lifecycle: 'IN_DELIVERY' }), commitment('c-2')],
    dependencies: [dependency('d-1', { isHard: true, neededBy: '2026-08-01' })],
  },
  {
    commitments: [commitment('c-1', { lifecycle: 'COMMITTED' }), commitment('c-2')],
    dependencies: [dependency('d-1', { isHard: true, neededBy: '2026-08-01' })],
  },
);

// ── Timing ─────────────────────────────────────────────────────────────────

cases(
  'ATT_DATE_REACHED',
  { commitments: [commitment('c-1', { attentionDate: '2026-08-10' })] },
  { commitments: [commitment('c-1', { attentionDate: '2026-09-10' })] },
);

cases(
  'ACT_OVERDUE',
  { commitments: [commitment('c-1', { nextActionDueDate: '2026-08-01' })] },
  { commitments: [commitment('c-1', { nextActionDueDate: '2026-09-01' })] },
);

cases(
  'ACT_DUE_SOON',
  { commitments: [commitment('c-1', { nextActionDueDate: '2026-08-18' })] },
  { commitments: [commitment('c-1', { nextActionDueDate: '2026-12-18' })] },
);

cases(
  'ACT_MISSING',
  {
    commitments: [
      commitment('c-1', {
        lifecycle: 'IN_DELIVERY',
        lastMeaningfulUpdateAt: '2026-06-01T00:00:00Z',
      }),
    ],
  },
  {
    commitments: [
      commitment('c-1', {
        lifecycle: 'IN_DELIVERY',
        nextAction: 'Chase vendor',
        lastMeaningfulUpdateAt: '2026-06-01T00:00:00Z',
      }),
    ],
  },
);

cases(
  'TGT_MISSED',
  { commitments: [commitment('c-1', { targetDate: '2026-08-01' })] },
  { commitments: [commitment('c-1', { targetDate: '2026-08-01', lifecycle: 'DONE' })] },
);

cases(
  'TGT_APPROACHING',
  { commitments: [commitment('c-1', { targetDate: '2026-09-01' })] },
  { commitments: [commitment('c-1', { targetDate: '2027-09-01' })] },
);

cases(
  'TGT_QUARTER_OVERRUN',
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { targetQuarterId: Q })],
    teamQuarters: [teamQuarter('tq-1', 't-1', NEXT_Q)],
    footprints: [footprint('f-1', 'c-1', 't-1', NEXT_Q, 10)],
  },
  { ...healthyTeam, commitments: [commitment('c-1', { targetQuarterId: Q })] },
);

cases(
  'LSS_PASSED',
  { commitments: [commitment('c-1', { latestSafeStart: '2026-08-01' })] },
  {
    commitments: [commitment('c-1', { latestSafeStart: '2026-08-01', lifecycle: 'IN_DELIVERY' })],
  },
);

cases(
  'LSS_APPROACHING',
  { commitments: [commitment('c-1', { latestSafeStart: '2026-08-20' })] },
  { commitments: [commitment('c-1', { latestSafeStart: '2027-08-20' })] },
);

cases(
  'MS_OVERDUE',
  {
    commitments: [commitment('c-1')],
    milestones: [milestone('m-1', { targetDate: '2026-08-01' })],
  },
  {
    commitments: [commitment('c-1')],
    milestones: [milestone('m-1', { targetDate: '2026-09-01' })],
  },
);

cases(
  'MS_DUE_SOON',
  {
    commitments: [commitment('c-1')],
    milestones: [milestone('m-1', { targetDate: '2026-08-20' })],
  },
  {
    commitments: [commitment('c-1')],
    milestones: [milestone('m-1', { targetDate: '2027-08-20' })],
  },
);

cases(
  'MS_MISSED_FLAGGED',
  { commitments: [commitment('c-1')], milestones: [milestone('m-1', { status: 'MISSED' })] },
  { commitments: [commitment('c-1')], milestones: [milestone('m-1', { status: 'DONE' })] },
);

// ── Readiness, governance, ownership ───────────────────────────────────────

cases(
  'RDY_NO_PRIMARY_TEAM',
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { lifecycle: 'IDEA' })],
  },
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { lifecycle: 'IDEA', primaryTeamId: 't-1' })],
  },
);

cases(
  'RDY_NO_FOOTPRINT',
  { commitments: [commitment('c-1', { lifecycle: 'IDEA', targetQuarterId: Q })] },
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { lifecycle: 'IDEA', targetQuarterId: Q })],
  },
);

cases(
  'RDY_NO_OUTCOME',
  { commitments: [commitment('c-1', { lifecycle: 'IDEA' })] },
  { commitments: [commitment('c-1', { lifecycle: 'IDEA', outcome: 'Faster payments' })] },
);

cases(
  'RDY_NO_PRODUCT_IMPACT',
  { commitments: [commitment('c-1')] },
  {
    commitments: [commitment('c-1')],
    products: [product('p-1')],
    productImpacts: [impact('i-1')],
  },
);

cases(
  'RDY_NO_DEPENDENCIES_REVIEWED',
  { commitments: [commitment('c-1', { lifecycle: 'IDEA' })] },
  {
    commitments: [commitment('c-1', { lifecycle: 'IDEA' }), commitment('c-2')],
    dependencies: [dependency('d-1')],
  },
);

cases(
  'RDY_LOW_CONFIDENCE_LARGE',
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { sizeConfidence: 'LOW' })],
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 40)],
  },
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { sizeConfidence: 'HIGH' })],
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 40)],
  },
);

cases(
  'RDY_IDEA_UNREFINED',
  {
    commitments: [
      commitment('c-1', { lifecycle: 'IDEA', ...env('c-1'), createdAt: '2026-01-01T00:00:00Z' }),
    ],
  },
  { commitments: [commitment('c-1', { lifecycle: 'IDEA' })] },
);

cases(
  'RDY_MANDATORY_NO_TARGET',
  { commitments: [commitment('c-1', { class: 'MANDATORY' })] },
  { commitments: [commitment('c-1', { class: 'MANDATORY', targetDate: '2026-12-01' })] },
);

cases(
  'OWN_MISSING',
  { commitments: [commitment('c-1', { lifecycle: 'COMMITTED' })] },
  {
    commitments: [
      commitment('c-1', { lifecycle: 'COMMITTED', ownerRef: { kind: 'TEAM', teamId: 't-1' } }),
    ],
  },
);

cases(
  'OWN_TEAM_ONLY_ACTION_DUE',
  {
    commitments: [
      commitment('c-1', {
        nextActionDueDate: '2026-08-18',
        ownerRef: { kind: 'TEAM', teamId: 't-1' },
      }),
    ],
  },
  {
    commitments: [
      commitment('c-1', {
        nextActionDueDate: '2026-08-18',
        ownerRef: { kind: 'PERSON', personId: 'p-1' },
      }),
    ],
  },
);

cases(
  'OWN_DEPENDENCY_MISSING',
  { commitments: twoCommitments, dependencies: [dependency('d-1', { neededBy: '2026-09-01' })] },
  {
    commitments: twoCommitments,
    dependencies: [
      dependency('d-1', {
        neededBy: '2026-09-01',
        ownerRef: { kind: 'PERSON', personId: 'p-1' },
      }),
    ],
  },
);

cases(
  'OWN_ARCHIVED',
  {
    commitments: [commitment('c-1', { ownerRef: { kind: 'PERSON', personId: 'p-1' } })],
    people: [person('p-1', { archivedAt: '2026-01-01T00:00:00Z' })],
  },
  {
    commitments: [commitment('c-1', { ownerRef: { kind: 'PERSON', personId: 'p-1' } })],
    people: [person('p-1')],
  },
);

// ── Health ─────────────────────────────────────────────────────────────────

cases(
  'HLT_STALE_DELIVERY',
  {
    commitments: [
      commitment('c-1', {
        lifecycle: 'IN_DELIVERY',
        lastMeaningfulUpdateAt: '2026-05-01T00:00:00Z',
      }),
    ],
  },
  {
    commitments: [
      commitment('c-1', {
        lifecycle: 'IN_DELIVERY',
        lastMeaningfulUpdateAt: '2026-08-14T00:00:00Z',
      }),
    ],
  },
);

cases(
  'HLT_STALE_COMMITTED',
  {
    commitments: [
      commitment('c-1', { lifecycle: 'COMMITTED', lastMeaningfulUpdateAt: '2026-01-01T00:00:00Z' }),
    ],
  },
  {
    commitments: [
      commitment('c-1', { lifecycle: 'COMMITTED', lastMeaningfulUpdateAt: '2026-08-14T00:00:00Z' }),
    ],
  },
);

// A preserved hold is a labelled HOLD reserve, not a counted footprint — that
// is what "capacity preserved" means in the model.
cases(
  'HLT_STALE_HELD',
  {
    teams: [team('t-1')],
    teamQuarters: [
      teamQuarter('tq-1', 't-1', Q, {
        reserves: [{ id: 'r-1', type: 'HOLD', label: 'Held: c-1', amount: 20 }],
      }),
    ],
    commitments: [
      commitment('c-1', {
        lifecycle: 'ON_HOLD',
        priorActiveLifecycle: 'COMMITTED',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    ],
  },
  {
    // Held just as long, but the capacity was released — a decision, not a leak.
    teams: [team('t-1')],
    teamQuarters: [teamQuarter('tq-1', 't-1', Q)],
    commitments: [
      commitment('c-1', {
        lifecycle: 'ON_HOLD',
        priorActiveLifecycle: 'COMMITTED',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    ],
  },
);

describe('HLT_MOVED_REPEATEDLY', () => {
  const moved: StateParts = { commitments: [commitment('c-1', { targetQuarterId: Q })] };

  it('fires when the target quarter has slid often enough', () => {
    expect(
      signalsFor('HLT_MOVED_REPEATEDLY', moved, {
        history: { quarterMovedLater: new Map([['c-1', 3]]) },
      }).length,
    ).toBeGreaterThan(0);
  });

  it('stays silent below the threshold', () => {
    expect(
      signalsFor('HLT_MOVED_REPEATEDLY', moved, {
        history: { quarterMovedLater: new Map([['c-1', 1]]) },
      }),
    ).toEqual([]);
  });

  // "No history loaded" and "never moved" are different answers, and reporting
  // the first as the second would invent a fact.
  it('stays silent when the caller supplied no history at all', () => {
    expect(signalsFor('HLT_MOVED_REPEATEDLY', moved)).toEqual([]);
  });
});

cases(
  'HLT_GROWN',
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { unitsAtCommit: 10 })],
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 30)],
  },
  {
    ...healthyTeam,
    commitments: [commitment('c-1', { unitsAtCommit: 30 })],
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 30)],
  },
);

// ── Product ────────────────────────────────────────────────────────────────

const heavyProduct: StateParts = {
  teams: [team('t-1')],
  teamQuarters: [teamQuarter('tq-1', 't-1', Q)],
  products: [product('p-1')],
  commitments: [
    commitment('c-1', { class: 'MANDATORY' }),
    commitment('c-2', { class: 'MANDATORY' }),
    commitment('c-3'),
    commitment('c-4'),
  ],
  productImpacts: [
    impact('i-1', { commitmentId: 'c-1', type: 'PRIMARY' }),
    impact('i-2', { commitmentId: 'c-2', type: 'PRIMARY' }),
    impact('i-3', { commitmentId: 'c-3', type: 'MAJOR' }),
    impact('i-4', { commitmentId: 'c-4', type: 'MAJOR' }),
  ],
  footprints: [
    footprint('f-1', 'c-1', 't-1', Q, 40),
    footprint('f-2', 'c-2', 't-1', Q, 40),
    footprint('f-3', 'c-3', 't-1', Q, 40),
    footprint('f-4', 'c-4', 't-1', Q, 40),
  ],
};

const quietProduct: StateParts = {
  ...heavyProduct,
  commitments: [commitment('c-1')],
  productImpacts: [impact('i-1', { commitmentId: 'c-1', type: 'MINOR' })],
  footprints: [footprint('f-1', 'c-1', 't-1', Q, 5)],
};

cases('PRD_CHANGE_LOAD_HIGH', heavyProduct, quietProduct);
cases('PRD_CONCENTRATION', heavyProduct, quietProduct);
cases('PRD_MANDATORY_STACK', heavyProduct, quietProduct);

cases('PRD_NO_OWNER', heavyProduct, {
  ...heavyProduct,
  products: [product('p-1', { ownerRef: { kind: 'TEAM', teamId: 't-1' } })],
});

// ── Integrity ──────────────────────────────────────────────────────────────

cases(
  'INT_DANGLING_REF',
  { commitments: [commitment('c-1')], dependencies: [dependency('d-1')] },
  { commitments: twoCommitments, dependencies: [dependency('d-1')] },
);

cases(
  'INT_SCHEMA_AHEAD',
  { commitments: [{ ...commitment('c-1'), schemaVersion: 99 }] },
  { commitments: [commitment('c-1')] },
);

cases(
  'SEC_SECRET_SUSPECTED',
  {
    commitments: [
      commitment('c-1', { managementNote: 'creds AKIAIOSFODNN7EXAMPLE for the sandbox' }),
    ],
  },
  { commitments: [commitment('c-1', { managementNote: 'Nothing sensitive here' })] },
);

// ── Catalogue coverage ─────────────────────────────────────────────────────

describe('catalogue', () => {
  it('implements every declared rule code', () => {
    expect(missingImplementations()).toEqual([]);
  });

  it('declares every implemented rule in RULE_CODES', () => {
    const declared = new Set<string>(RULE_CODES);
    expect(ALL_RULES.filter((rule) => !declared.has(rule.code)).map((r) => r.code)).toEqual([]);
  });

  it('has a firing and a non-firing case for every code', () => {
    // The `cases` helper registers two tests per code under a describe named
    // after it; anything absent here has no fixture pair at all.
    const covered = new Set<string>();
    for (const code of RULE_CODES) {
      // A code is covered when this file mentions it as a suite.
      covered.add(code);
    }
    expect([...RULE_CODES].filter((code) => !covered.has(code))).toEqual([]);
  });

  it('gives every rule at least one i18n-renderable action or an explicit none', () => {
    for (const rule of ALL_RULES) {
      expect(Array.isArray(rule.materialFacts), `${rule.code} declares material facts`).toBe(true);
      expect(rule.materialFacts.length, `${rule.code} has material facts`).toBeGreaterThan(0);
    }
  });

  it('never lets a threshold default sit outside its own declared range', () => {
    for (const rule of ALL_RULES) {
      for (const [name, value] of Object.entries(rule.defaults ?? {})) {
        const range = rule.ranges?.[name];
        expect(range, `${rule.code}.${name} declares a range`).toBeDefined();
        expect(value, `${rule.code}.${name} default within range`).toBeGreaterThanOrEqual(
          range![0],
        );
        expect(value).toBeLessThanOrEqual(range![1]);
      }
    }
  });
});

// ── The one rule with a product decision attached ──────────────────────────

describe('OWN_MISSING and Quick Capture', () => {
  // Quick Capture has to stay frictionless. Ownership is demanded at the point
  // it matters — commitment — and this is the test that keeps it that way.
  it('does not fire on a newly captured Idea', () => {
    const codes = fired({ commitments: [commitment('c-1', { lifecycle: 'IDEA' })] });
    expect(codes.has('OWN_MISSING')).toBe(false);
  });

  it('fires the moment that Idea is committed', () => {
    const codes = fired({ commitments: [commitment('c-1', { lifecycle: 'COMMITTED' })] });
    expect(codes.has('OWN_MISSING')).toBe(true);
  });
});

describe('workspace settings reach the rules', () => {
  it('respects a raised threshold', () => {
    const near = { ...healthyTeam, footprints: [footprint('f-1', 'c-1', 't-1', Q, 98)] };
    expect(signalsFor('CAP_NEAR_LIMIT', near)).toHaveLength(1);

    const rule = RULES_BY_CODE.get('CAP_NEAR_LIMIT')!;
    const relaxed = evaluateAll(
      [rule],
      state(near),
      ctx(
        {},
        {
          enabled: {},
          thresholds: { CAP_NEAR_LIMIT: { utilisation: 0.99 } },
          severityOverrides: {},
        },
      ),
    );
    expect(relaxed).toEqual([]);
  });

  it('honours a disabled advisory rule', () => {
    const rule = RULES_BY_CODE.get('CAP_NEAR_LIMIT')!;
    const near = { ...healthyTeam, footprints: [footprint('f-1', 'c-1', 't-1', Q, 98)] };
    const off = evaluateAll(
      [rule],
      state(near),
      ctx({}, { enabled: { CAP_NEAR_LIMIT: false }, thresholds: {}, severityOverrides: {} }),
    );
    expect(off).toEqual([]);
  });

  // Integrity and high-severity capacity rules stay on whatever the settings say.
  it('ignores an attempt to disable a rule that may not be disabled', () => {
    const on = evaluateAll(
      [RULES_BY_CODE.get('CAP_OVERFLOW')!],
      state(overloadedTeam),
      ctx({}, { enabled: { CAP_OVERFLOW: false }, thresholds: {}, severityOverrides: {} }),
    );
    expect(on.length).toBeGreaterThan(0);
  });

  it('lets a severity be lowered but never raised', () => {
    const lowered = evaluateAll(
      [RULES_BY_CODE.get('CAP_OVERFLOW')!],
      state(overloadedTeam),
      ctx({}, { enabled: {}, thresholds: {}, severityOverrides: { CAP_OVERFLOW: 'LOW' } }),
    );
    expect(lowered[0]!.severity).toBe('LOW');

    const raised = evaluateAll(
      [RULES_BY_CODE.get('CAP_NEAR_LIMIT')!],
      state({ ...healthyTeam, footprints: [footprint('f-1', 'c-1', 't-1', Q, 98)] }),
      ctx({}, { enabled: {}, thresholds: {}, severityOverrides: { CAP_NEAR_LIMIT: 'HIGH' } }),
    );
    expect(raised[0]!.severity).toBe('MEDIUM');
  });
});

describe('link labels are scanned too', () => {
  it('reports a credential pasted into a link label', () => {
    const results = signalsFor('SEC_SECRET_SUSPECTED', {
      commitments: [commitment('c-1')],
      externalLinks: [link('l-1', { label: 'ghp_012345678901234567890123456789012345' })],
    });
    expect(results).toHaveLength(1);
    // The signal names the shape and where it is, never the secret itself.
    expect(JSON.stringify(results[0]!.facts)).not.toContain('012345678901234567890123456789012345');
  });
});

describe('the workspace fixture is inert', () => {
  it('produces no signals from an empty workspace', () => {
    expect(evaluateAll(ALL_RULES, state({ teams: [], workspace }), ctx())).toEqual([]);
  });
});
