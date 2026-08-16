/**
 * Change load, Radar grouping, secret detection, and settings validation.
 */

import { describe, expect, it } from 'vitest';

import { allChangeLoads, changeLoadFor } from './change-load.js';
import {
  RADAR_GROUPS,
  compareSignals,
  countByRule,
  countBySeverity,
  filterMode,
  groupOf,
  groupSignals,
  resolveOwnedRefs,
} from './radar.js';
import { SECRET_PATTERN_IDS, hasSecret, scanForSecrets } from './secrets.js';
import {
  allowedSeverities,
  describeSettings,
  resetAll,
  resetRule,
  validateSettings,
} from './settings.js';
import { NO_RULE_SETTINGS, type RuleResult, type Severity } from './types.js';
import {
  Q,
  commitment,
  footprint,
  impact,
  product,
  state,
  team,
  teamQuarter,
} from './test-support.js';

// ── Change load (§5) ───────────────────────────────────────────────────────

describe('change load', () => {
  const parts = {
    teams: [team('t-1')],
    teamQuarters: [teamQuarter('tq-1', 't-1', Q)],
    products: [product('p-1')],
    commitments: [
      commitment('c-1', { class: 'MANDATORY', name: 'SEPA instant payments' }),
      commitment('c-2', { name: 'Statement redesign' }),
    ],
    productImpacts: [
      impact('i-1', { commitmentId: 'c-1', type: 'PRIMARY' }),
      impact('i-2', { commitmentId: 'c-2', type: 'MAJOR' }),
    ],
    footprints: [footprint('f-1', 'c-1', 't-1', Q, 35), footprint('f-2', 'c-2', 't-1', Q, 20)],
  };

  it('computes the formula exactly as the spec states it', () => {
    const load = changeLoadFor(state(parts), 'p-1', Q);

    // PRIMARY 3.0 × size (35/20 = 1.75) × mandatory 1.5 = 7.875 → 7.88
    const sepa = load.contributors.find((c) => c.commitment === 'SEPA instant payments')!;
    expect(sepa.impactBase).toBe(3.0);
    expect(sepa.sizeFactor).toBe(1.75);
    expect(sepa.classFactor).toBe(1.5);
    expect(sepa.contribution).toBeCloseTo(7.88, 2);

    // MAJOR 2.0 × size (20/20 = 1.0) × 1.0 = 2.0
    const statement = load.contributors.find((c) => c.commitment === 'Statement redesign')!;
    expect(statement.contribution).toBe(2.0);

    expect(load.score).toBeCloseTo(9.88, 2);
    expect(load.level).toBe('MEDIUM');
  });

  it('clamps the size factor at both ends', () => {
    const tiny = changeLoadFor(
      state({ ...parts, footprints: [footprint('f-1', 'c-1', 't-1', Q, 1)] }),
      'p-1',
      Q,
    );
    expect(tiny.contributors.find((c) => c.commitmentId === 'c-1')!.sizeFactor).toBe(0.5);

    const huge = changeLoadFor(
      state({ ...parts, footprints: [footprint('f-1', 'c-1', 't-1', Q, 500)] }),
      'p-1',
      Q,
    );
    expect(huge.contributors.find((c) => c.commitmentId === 'c-1')!.sizeFactor).toBe(3.0);
  });

  // Ideas contribute only in scenarios, which is what the lifecycle factor says.
  it('excludes Ideas from the baseline', () => {
    const withIdea = changeLoadFor(
      state({
        ...parts,
        commitments: [commitment('c-1', { lifecycle: 'IDEA' }), commitment('c-2')],
      }),
      'p-1',
      Q,
    );
    expect(withIdea.contributors.map((c) => c.commitmentId)).not.toContain('c-1');
  });

  it('sorts contributors descending, so the panel reads as an explanation', () => {
    const load = changeLoadFor(state(parts), 'p-1', Q);
    const values = load.contributors.map((c) => c.contribution);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it('crosses into HIGH at the configured threshold', () => {
    const heavy = changeLoadFor(
      state({
        ...parts,
        commitments: [
          commitment('c-1', { class: 'MANDATORY' }),
          commitment('c-2', { class: 'MANDATORY' }),
        ],
        productImpacts: [
          impact('i-1', { commitmentId: 'c-1', type: 'PRIMARY' }),
          impact('i-2', { commitmentId: 'c-2', type: 'PRIMARY' }),
        ],
        footprints: [footprint('f-1', 'c-1', 't-1', Q, 60), footprint('f-2', 'c-2', 't-1', Q, 60)],
      }),
      'p-1',
      Q,
    );
    expect(heavy.level).toBe('HIGH');
    expect(heavy.score).toBeGreaterThanOrEqual(heavy.thresholds.high);
  });

  // Work with a target quarter but no placement yet is still change heading at
  // the product; pretending otherwise makes a product look quiet until the last
  // moment.
  it('falls back to the target quarter when nothing is placed', () => {
    const unplaced = changeLoadFor(
      state({
        ...parts,
        commitments: [commitment('c-1', { targetQuarterId: Q })],
        productImpacts: [impact('i-1', { commitmentId: 'c-1', type: 'PRIMARY' })],
        footprints: [],
      }),
      'p-1',
      Q,
    );
    expect(unplaced.contributors).toHaveLength(1);
  });

  it('enumerates every product-quarter pair that carries change', () => {
    const loads = allChangeLoads(state(parts));
    expect(loads).toHaveLength(1);
    expect(loads[0]!.quarterId).toBe(Q);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(allChangeLoads(state(parts)))).toBe(
      JSON.stringify(allChangeLoads(state(parts))),
    );
  });
});

// ── Radar grouping (§6.2) ──────────────────────────────────────────────────

function signal(over: Partial<Record<keyof RuleResult, unknown>> = {}): RuleResult {
  return {
    signalKey: 'K',
    ruleCode: 'DEP_OVERDUE',
    entityRef: { kind: 'COMMITMENT', id: 'c-1' },
    category: 'DEPENDENCY',
    severity: 'MEDIUM',
    surfaces: ['RADAR'],
    facts: {},
    conditionFingerprint: 'F',
    actions: [],
    occurredOn: '2026-08-15',
    ...over,
  } as RuleResult;
}

describe('Radar grouping', () => {
  const today = '2026-08-15';

  it('puts a HIGH signal due today at the very top', () => {
    expect(groupOf(signal({ severity: 'HIGH', dueOn: today }), today)).toBe('ACTION_NOW');
  });

  it('groups by time before category', () => {
    // A dependency due in three days is "this week", not "dependencies".
    expect(groupOf(signal({ dueOn: '2026-08-18' }), today)).toBe('THIS_WEEK');
    expect(groupOf(signal({ dueOn: '2026-09-05' }), today)).toBe('EMERGING');
  });

  it('sends an undated dependency to its category group', () => {
    expect(groupOf(signal({ dueOn: undefined }), today)).toBe('DEPENDENCIES');
  });

  it('routes each category to its own group', () => {
    expect(groupOf(signal({ category: 'CAPACITY', ruleCode: 'CAP_OVERFLOW' }), today)).toBe(
      'CAPACITY',
    );
    expect(groupOf(signal({ category: 'OWNERSHIP', ruleCode: 'OWN_MISSING' }), today)).toBe(
      'OWNERSHIP',
    );
    expect(groupOf(signal({ category: 'READINESS', ruleCode: 'RDY_NO_OUTCOME' }), today)).toBe(
      'IDEA_DECISIONS',
    );
    expect(groupOf(signal({ category: 'PRODUCT', ruleCode: 'PRD_CONCENTRATION' }), today)).toBe(
      'PATTERNS',
    );
    expect(groupOf(signal({ category: 'INTEGRITY', ruleCode: 'INT_DANGLING_REF' }), today)).toBe(
      'INTEGRITY',
    );
    expect(groupOf(signal({ category: 'HEALTH', ruleCode: 'HLT_STALE_DELIVERY' }), today)).toBe(
      'STALE',
    );
  });

  // An overdue signal always needs answering today, whatever its severity.
  it('treats anything overdue as needing action now', () => {
    expect(groupOf(signal({ severity: 'LOW', dueOn: '2026-08-01' }), today)).toBe('ACTION_NOW');
  });

  it('emits groups in the fixed spec order', () => {
    const groups = groupSignals(
      [
        signal({ signalKey: 'a', category: 'INTEGRITY', ruleCode: 'INT_DANGLING_REF' }),
        signal({ signalKey: 'b', severity: 'HIGH', dueOn: today }),
        signal({
          signalKey: 'c',
          category: 'CAPACITY',
          ruleCode: 'CAP_OVERFLOW',
          dueOn: undefined,
        }),
      ],
      today,
    );
    const order = groups.map((g) => g.id);
    const expected = RADAR_GROUPS.filter((id) => order.includes(id));
    expect(order).toEqual(expected);
  });

  it('sorts severity descending, then due date, then name within a group', () => {
    const rows = [
      signal({ signalKey: 'x', severity: 'LOW', facts: { commitment: 'B' }, dueOn: undefined }),
      signal({ signalKey: 'y', severity: 'HIGH', facts: { commitment: 'Z' }, dueOn: undefined }),
      signal({ signalKey: 'z', severity: 'LOW', facts: { commitment: 'A' }, dueOn: undefined }),
    ].sort(compareSignals);

    expect(rows.map((r) => r.severity)).toEqual(['HIGH', 'LOW', 'LOW']);
    expect(rows.slice(1).map((r) => r.facts['commitment'])).toEqual(['A', 'B']);
  });

  it('is a total order, so a golden file can assert it', () => {
    const a = signal({ signalKey: 'aaa' });
    const b = signal({ signalKey: 'bbb' });
    expect(compareSignals(a, b)).toBeLessThan(0);
    expect(compareSignals(b, a)).toBeGreaterThan(0);
    expect(compareSignals(a, a)).toBe(0);
  });
});

// ── My Radar (§6.1) ────────────────────────────────────────────────────────

describe('My Radar', () => {
  it('contains only what this user owns individually', () => {
    const mine = signal({ signalKey: 'm', entityRef: { kind: 'COMMITMENT', id: 'c-1' } });
    const theirs = signal({ signalKey: 't', entityRef: { kind: 'COMMITMENT', id: 'c-2' } });
    const owned = new Set(['COMMITMENT:c-1']);

    expect(filterMode([mine, theirs], 'MINE', owned)).toEqual([mine]);
    expect(filterMode([mine, theirs], 'PORTFOLIO', owned)).toHaveLength(2);
  });

  // Team-owned items appear on Team/Portfolio Radar and never on My Radar.
  // Without that exclusion My Radar is a second inbox nobody reads.
  it('excludes team-owned work', () => {
    const owned = resolveOwnedRefs({
      personId: 'p-1',
      commitments: [
        { id: 'c-1', ownerRef: { kind: 'TEAM' } },
        { id: 'c-2', ownerRef: { kind: 'PERSON', personId: 'p-1' } },
      ],
    });
    expect([...owned]).toEqual(['COMMITMENT:c-2']);
  });

  it('includes work where only the next action is mine', () => {
    const owned = resolveOwnedRefs({
      personId: 'p-1',
      commitments: [{ id: 'c-1', nextActionOwnerRef: { kind: 'PERSON', personId: 'p-1' } }],
    });
    expect(owned.has('COMMITMENT:c-1')).toBe(true);
  });

  it('includes dependencies and decisions I own', () => {
    const owned = resolveOwnedRefs({
      personId: 'p-1',
      commitments: [],
      dependencies: [{ id: 'd-1', ownerRef: { kind: 'PERSON', personId: 'p-1' } }],
      decisions: [{ id: 'dec-1', ownerRef: { kind: 'PERSON', personId: 'p-1' } }],
    });
    expect(owned.has('DEPENDENCY:d-1')).toBe(true);
    expect(owned.has('DECISION:dec-1')).toBe(true);
  });

  it('is empty for a user with no linked person record', () => {
    expect(
      resolveOwnedRefs({
        commitments: [{ id: 'c-1', ownerRef: { kind: 'PERSON', personId: 'p-1' } }],
      }).size,
    ).toBe(0);
  });
});

describe('counts for the settings screen', () => {
  it('counts by rule and by severity', () => {
    const rows = [
      signal({ signalKey: '1', ruleCode: 'DEP_OVERDUE', severity: 'HIGH' }),
      signal({ signalKey: '2', ruleCode: 'DEP_OVERDUE', severity: 'HIGH' }),
      signal({ signalKey: '3', ruleCode: 'CAP_OVERFLOW', severity: 'MEDIUM' }),
    ];
    expect(countByRule(rows).get('DEP_OVERDUE')).toBe(2);
    expect(countBySeverity(rows)).toEqual({ INFO: 0, LOW: 0, MEDIUM: 1, HIGH: 2 });
  });
});

// ── Secrets (§4.8) ─────────────────────────────────────────────────────────

describe('secret detection', () => {
  const samples: Array<[string, string]> = [
    ['PEM_PRIVATE_KEY', '-----BEGIN RSA PRIVATE KEY-----'],
    ['BEARER_JWT', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
    ['JWT', 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NT.SflKxwRJSMeKKF2QT4'],
    ['AWS_ACCESS_KEY', 'AKIAIOSFODNN7EXAMPLE'],
    ['GOOGLE_API_KEY', `AIza${'a'.repeat(35)}`],
    ['SLACK_TOKEN', 'xoxb-1234567890-abcdefghij'],
    ['GITHUB_TOKEN', `ghp_${'a'.repeat(36)}`],
    ['ASSIGNED_SECRET', 'api_key = s3cr3tvalue123'],
    ['CONNECTION_STRING', 'Server=db;Password=hunter2xyz;'],
  ];

  it.each(samples)('detects %s', (patternId, text) => {
    const matches = scanForSecrets(`note ${text} end`);
    expect(matches.map((m) => m.patternId)).toContain(patternId);
  });

  it('covers every declared pattern', () => {
    expect(new Set(samples.map(([id]) => id))).toEqual(new Set(SECRET_PATTERN_IDS));
  });

  it('does not fire on ordinary management prose', () => {
    expect(hasSecret('Vendor confirmed the migration window for the password reset feature')).toBe(
      false,
    );
    expect(hasSecret('Waiting on the security review')).toBe(false);
    expect(hasSecret(undefined)).toBe(false);
  });

  // The preview has to say *where* without saying *what*.
  it('redacts the matched text', () => {
    const [match] = scanForSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(match!.preview).not.toContain('IOSFODNN7EXAMPLE');
    expect(match!.preview.startsWith('AKIA')).toBe(true);
  });

  it('reports the span so the UI can offer to remove it', () => {
    const [match] = scanForSecrets('prefix AKIAIOSFODNN7EXAMPLE suffix');
    expect(match!.start).toBe(7);
    expect(match!.end).toBe(27);
  });

  // A shared global regex carries lastIndex between calls, which would make
  // results depend on call order.
  it('is stable across repeated calls', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPLB';
    expect(scanForSecrets(text)).toEqual(scanForSecrets(text));
    expect(scanForSecrets(text)).toHaveLength(2);
  });
});

// ── Settings (§7) ──────────────────────────────────────────────────────────

describe('rule settings', () => {
  it('accepts the defaults', () => {
    expect(validateSettings(NO_RULE_SETTINGS)).toEqual([]);
  });

  // Out-of-range values are rejected *with the range*, never silently clamped.
  it('rejects an out-of-range threshold and reports the permitted range', () => {
    const problems = validateSettings({
      ...NO_RULE_SETTINGS,
      thresholds: { DEP_DUE_SOON: { days: 500 } },
    });
    expect(problems).toEqual([
      { kind: 'OUT_OF_RANGE', ruleCode: 'DEP_DUE_SOON', name: 'days', value: 500, min: 1, max: 90 },
    ]);
  });

  it('rejects an unknown rule and an unknown threshold', () => {
    expect(
      validateSettings({ ...NO_RULE_SETTINGS, thresholds: { NOPE: { days: 1 } } as never }),
    ).toEqual([{ kind: 'UNKNOWN_RULE', ruleCode: 'NOPE' }]);

    expect(
      validateSettings({ ...NO_RULE_SETTINGS, thresholds: { DEP_DUE_SOON: { weeks: 1 } } }),
    ).toEqual([{ kind: 'UNKNOWN_THRESHOLD', ruleCode: 'DEP_DUE_SOON', name: 'weeks' }]);
  });

  it('refuses to disable a rule that may not be disabled', () => {
    expect(validateSettings({ ...NO_RULE_SETTINGS, enabled: { CAP_OVERFLOW: false } })).toEqual([
      { kind: 'CANNOT_DISABLE', ruleCode: 'CAP_OVERFLOW' },
    ]);
    expect(validateSettings({ ...NO_RULE_SETTINGS, enabled: { CAP_NEAR_LIMIT: false } })).toEqual(
      [],
    );
  });

  it('refuses to raise a severity above the rule’s own ceiling', () => {
    expect(
      validateSettings({ ...NO_RULE_SETTINGS, severityOverrides: { CAP_NEAR_LIMIT: 'HIGH' } }),
    ).toEqual([
      {
        kind: 'CANNOT_RAISE_SEVERITY',
        ruleCode: 'CAP_NEAR_LIMIT',
        requested: 'HIGH',
        ceiling: 'MEDIUM',
      },
    ]);
    expect(
      validateSettings({ ...NO_RULE_SETTINGS, severityOverrides: { CAP_NEAR_LIMIT: 'LOW' } }),
    ).toEqual([]);
  });

  // Every offending field at once, not one save at a time.
  it('reports every problem rather than the first', () => {
    const problems = validateSettings({
      enabled: { CAP_OVERFLOW: false },
      thresholds: { DEP_DUE_SOON: { days: 500 } },
      severityOverrides: { CAP_NEAR_LIMIT: 'HIGH' },
    });
    expect(problems).toHaveLength(3);
  });

  it('describes each rule with its current value, default and range', () => {
    const described = describeSettings({
      ...NO_RULE_SETTINGS,
      thresholds: { DEP_DUE_SOON: { days: 30 } },
    });
    const row = described.find((r) => r.code === 'DEP_DUE_SOON')!;
    const days = row.thresholds.find((t) => t.name === 'days')!;

    expect(days).toEqual({
      name: 'days',
      value: 30,
      defaultValue: 14,
      min: 1,
      max: 90,
      isDefault: false,
    });
    expect(row.enabled).toBe(true);
  });

  it('resets one rule without touching the others', () => {
    const tuned = {
      ...NO_RULE_SETTINGS,
      thresholds: { DEP_DUE_SOON: { days: 30 }, ACT_DUE_SOON: { days: 3 } },
    };
    const reset = resetRule(tuned, 'DEP_DUE_SOON');
    expect(reset.thresholds['DEP_DUE_SOON']).toBeUndefined();
    expect(reset.thresholds['ACT_DUE_SOON']).toEqual({ days: 3 });
  });

  it('resets the whole set', () => {
    expect(resetAll()).toEqual(NO_RULE_SETTINGS);
  });

  it('offers only severities at or below the rule’s ceiling', () => {
    expect(allowedSeverities('CAP_NEAR_LIMIT')).toEqual<Severity[]>(['INFO', 'LOW', 'MEDIUM']);
    expect(allowedSeverities('CAP_OVERFLOW')).toEqual<Severity[]>([
      'INFO',
      'LOW',
      'MEDIUM',
      'HIGH',
    ]);
  });
});
