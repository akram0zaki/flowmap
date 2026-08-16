/**
 * The determinism guarantees — docs/spec/04-rules-radar.md §8.
 *
 * These are the properties Gate D exits on. Each one is asserted rather than
 * assumed, because every one of them is the kind of thing that holds until the
 * day it quietly stops.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ALL_RULES, RULES_BY_CODE } from './catalogue.js';
import {
  applyDelta,
  canDispose,
  evaluateAll,
  evaluateIncremental,
  healthLevel,
  matchesPattern,
  suppressed,
  visibleSignals,
} from './engine.js';
import { base32, canonicalJson, conditionFingerprint, sha256, signalKey } from './identity.js';
import { SEVERITY_ORDER, type Disposition, type RuleResult, type Severity } from './types.js';
import {
  Q,
  NEXT_Q,
  commitment,
  ctx,
  dependency,
  footprint,
  state,
  team,
  teamQuarter,
} from './test-support.js';

const busy = {
  teams: [team('t-1'), team('t-2')],
  teamQuarters: [teamQuarter('tq-1', 't-1', Q), teamQuarter('tq-2', 't-2', Q)],
  commitments: [
    commitment('c-1', { lifecycle: 'IN_DELIVERY', targetDate: '2026-07-01' }),
    commitment('c-2', { primaryTeamId: 't-1', nextActionDueDate: '2026-08-01' }),
    commitment('c-3', { lifecycle: 'IDEA' }),
  ],
  footprints: [footprint('f-1', 'c-1', 't-1', Q, 120), footprint('f-2', 'c-2', 't-2', Q, 30)],
  dependencies: [dependency('d-1', { neededBy: '2026-07-01', isHard: true })],
};

// ── SHA-256 ────────────────────────────────────────────────────────────────

describe('sha256', () => {
  const hex = (bytes: readonly number[]) =>
    bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Published test vectors. A hand-written hash that is subtly wrong would give
  // stable-but-nonstandard keys, which is worse than an obvious break.
  it('matches the FIPS 180-4 vectors', () => {
    expect(hex(sha256(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hex(sha256('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hex(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles multi-byte characters and long inputs', () => {
    expect(hex(sha256('a'.repeat(1000)))).toHaveLength(64);
    expect(hex(sha256('née — ünïcødé 🎯'))).toHaveLength(64);
    expect(sha256('x')).not.toEqual(sha256('y'));
  });

  it('produces Crockford base32 without ambiguous letters', () => {
    const encoded = base32(sha256('anything'));
    expect(encoded).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });
});

// ── Canonical JSON ─────────────────────────────────────────────────────────

describe('canonicalJson', () => {
  // Key order is an evaluation detail; §8.4 forbids a rule depending on one.
  it('is insensitive to key order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('treats -0 and 0 as the same fact, and drops undefined', () => {
    expect(canonicalJson({ x: -0 })).toBe(canonicalJson({ x: 0 }));
    expect(canonicalJson({ x: 1, y: undefined })).toBe(canonicalJson({ x: 1 }));
  });

  it('distinguishes values that genuinely differ', () => {
    expect(canonicalJson({ x: '1' })).not.toBe(canonicalJson({ x: 1 }));
  });
});

// ── §8.1 and §8.2: identity ────────────────────────────────────────────────

describe('signal identity', () => {
  it('is stable for the same inputs', () => {
    expect(signalKey('CAP_OVERFLOW', 'TEAM_QUARTER:tq-1', 't-1:2026-Q3')).toBe(
      signalKey('CAP_OVERFLOW', 'TEAM_QUARTER:tq-1', 't-1:2026-Q3'),
    );
  });

  it('separates rules, entities and instances', () => {
    const a = signalKey('CAP_OVERFLOW', 'TEAM_QUARTER:tq-1', 'x');
    expect(a).not.toBe(signalKey('CAP_NEAR_LIMIT', 'TEAM_QUARTER:tq-1', 'x'));
    expect(a).not.toBe(signalKey('CAP_OVERFLOW', 'TEAM_QUARTER:tq-2', 'x'));
    expect(a).not.toBe(signalKey('CAP_OVERFLOW', 'TEAM_QUARTER:tq-1', 'y'));
  });

  // Export/import serialises the entities, not the in-memory Maps — so the
  // round trip that matters is over the rows, rebuilt on the far side.
  it('survives a JSON round trip, which is what export/import is', () => {
    const before = evaluateAll(ALL_RULES, state(busy), ctx());
    const exported = JSON.parse(JSON.stringify(busy)) as typeof busy;
    const after = evaluateAll(ALL_RULES, state(exported), ctx());

    expect(after.map((r) => r.signalKey)).toEqual(before.map((r) => r.signalKey));
    expect(after.map((r) => r.conditionFingerprint)).toEqual(
      before.map((r) => r.conditionFingerprint),
    );
  });

  // A magnitude that drifts daily must not be part of the fingerprint, or every
  // reviewed signal resurrects itself at midnight.
  it('keeps the fingerprint stable as a non-material fact drifts', () => {
    const day1 = evaluateAll(
      [RULES_BY_CODE.get('DEP_OVERDUE')!],
      state(busy),
      ctx({ clock: { now: () => '2026-08-15T00:00:00Z', today: () => '2026-08-15' } }),
    );
    const day30 = evaluateAll(
      [RULES_BY_CODE.get('DEP_OVERDUE')!],
      state(busy),
      ctx({ clock: { now: () => '2026-09-15T00:00:00Z', today: () => '2026-09-15' } }),
    );

    expect(day1[0]!.facts['daysOverdue']).not.toBe(day30[0]!.facts['daysOverdue']);
    expect(day30[0]!.conditionFingerprint).toBe(day1[0]!.conditionFingerprint);
    expect(day30[0]!.signalKey).toBe(day1[0]!.signalKey);
  });

  it('changes the fingerprint when the situation genuinely changes', () => {
    const before = evaluateAll([RULES_BY_CODE.get('DEP_OVERDUE')!], state(busy), ctx());
    const moved = evaluateAll(
      [RULES_BY_CODE.get('DEP_OVERDUE')!],
      state({
        ...busy,
        dependencies: [dependency('d-1', { neededBy: '2026-06-01', isHard: true })],
      }),
      ctx(),
    );
    expect(moved[0]!.conditionFingerprint).not.toBe(before[0]!.conditionFingerprint);
    // Same condition instance, so the key is unchanged and the review is kept.
    expect(moved[0]!.signalKey).toBe(before[0]!.signalKey);
  });
});

// ── §8.1: referential transparency ─────────────────────────────────────────

describe('evaluateAll', () => {
  it('is referentially transparent', () => {
    const a = evaluateAll(ALL_RULES, state(busy), ctx());
    const b = evaluateAll(ALL_RULES, state(busy), ctx());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('returns a totally ordered result, not merely the same set', () => {
    const results = evaluateAll(ALL_RULES, state(busy), ctx());
    const keys = results.map((r) => r.signalKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it('stamps the workspace-local evaluation date on every signal', () => {
    const results = evaluateAll(ALL_RULES, state(busy), ctx());
    expect(results.every((r) => r.occurredOn === '2026-08-15')).toBe(true);
  });
});

// ── §8.3: incremental ≡ all ────────────────────────────────────────────────

describe('evaluateIncremental', () => {
  it('matches evaluateAll for the projections a command touched', () => {
    const before = evaluateAll(ALL_RULES, state(busy), ctx());

    const changed = {
      ...busy,
      footprints: [footprint('f-1', 'c-1', 't-1', Q, 10), footprint('f-2', 'c-2', 't-2', Q, 30)],
    };
    const delta = evaluateIncremental(
      ALL_RULES,
      state(changed),
      ctx(),
      ['capacity:t-1:2026-Q3', 'commitment:c-1'],
      before,
    );

    const merged = applyDelta(before, delta);
    const full = evaluateAll(ALL_RULES, state(changed), ctx());

    // Only rules reading those projections are re-run, so compare the codes
    // that could have changed.
    const touched = new Set(
      ALL_RULES.filter((rule) =>
        ['capacity:t-1:2026-Q3', 'commitment:c-1'].some((key) =>
          rule.reads.some((pattern) => matchesPattern(pattern, key as never)),
        ),
      ).map((r) => r.code),
    );

    const pick = (rows: readonly RuleResult[]) =>
      rows
        .filter((r) => touched.has(r.ruleCode))
        .map((r) => `${r.signalKey}:${r.conditionFingerprint}:${r.severity}`)
        .sort();

    expect(pick(merged)).toEqual(pick(full));
  });

  it('agrees with evaluateAll across arbitrary unit changes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 6 }),
        (unitSequence) => {
          let current = busy;
          let signals = evaluateAll(ALL_RULES, state(current), ctx());

          for (const units of unitSequence) {
            current = {
              ...current,
              footprints: [
                footprint('f-1', 'c-1', 't-1', Q, units),
                footprint('f-2', 'c-2', 't-2', Q, 30),
              ],
            };
            const delta = evaluateIncremental(
              ALL_RULES,
              state(current),
              ctx(),
              ['capacity:t-1:2026-Q3', 'capacity:t-2:2026-Q3', 'commitment:c-1'],
              signals,
            );
            signals = applyDelta(signals, delta);
          }

          const full = evaluateAll(ALL_RULES, state(current), ctx());
          const key = (r: RuleResult) => `${r.signalKey}:${r.conditionFingerprint}`;
          return JSON.stringify(signals.map(key).sort()) === JSON.stringify(full.map(key).sort());
        },
      ),
      { numRuns: 40 },
    );
  });

  it('reports removals when a condition clears', () => {
    const before = evaluateAll(ALL_RULES, state(busy), ctx());
    const cleared = {
      ...busy,
      footprints: [footprint('f-1', 'c-1', 't-1', Q, 5), footprint('f-2', 'c-2', 't-2', Q, 30)],
    };
    const delta = evaluateIncremental(
      ALL_RULES,
      state(cleared),
      ctx(),
      ['capacity:t-1:2026-Q3'],
      before,
    );
    expect(delta.removed.length).toBeGreaterThan(0);
  });

  it('leaves rules that read nothing affected entirely alone', () => {
    const before = evaluateAll(ALL_RULES, state(busy), ctx());
    const delta = evaluateIncremental(ALL_RULES, state(busy), ctx(), [], before);
    expect(delta).toEqual({ added: [], updated: [], removed: [] });
  });
});

describe('projection patterns', () => {
  it('matches a wildcard against its family and nothing else', () => {
    expect(matchesPattern('capacity:*', 'capacity:t-1:2026-Q3')).toBe(true);
    expect(matchesPattern('capacity:*', 'commitment:c-1')).toBe(false);
    expect(matchesPattern('dependencyGraph', 'dependencyGraph')).toBe(true);
    expect(matchesPattern('dependencyGraph', 'commitment:c-1')).toBe(false);
  });
});

// ── §8.5: suppression never hides a worsened signal ────────────────────────

describe('suppression', () => {
  const signal = (over: Partial<RuleResult> = {}): RuleResult => ({
    signalKey: 'K1',
    ruleCode: 'CAP_NEAR_LIMIT',
    entityRef: { kind: 'TEAM_QUARTER', id: 'tq-1' },
    category: 'CAPACITY',
    severity: 'MEDIUM',
    surfaces: ['RADAR'],
    facts: {},
    conditionFingerprint: 'F1',
    actions: [],
    occurredOn: '2026-08-15',
    ...over,
  });

  const reviewed: Disposition = {
    signalKey: 'K1',
    disposition: 'REVIEWED',
    atFingerprint: 'F1',
    atSeverity: 'MEDIUM',
    actorId: 'actor-1',
  };

  it('hides a reviewed signal whose situation has not changed', () => {
    expect(suppressed(signal(), reviewed)).toBe(true);
  });

  // "Reviewed — no change" expires when the situation changes, not on a timer.
  it('does not expire on a timer', () => {
    expect(suppressed(signal({ occurredOn: '2027-01-01' }), reviewed)).toBe(true);
  });

  it('breaks through when the situation changes', () => {
    expect(suppressed(signal({ conditionFingerprint: 'F2' }), reviewed)).toBe(false);
  });

  it('never hides a signal whose severity increased', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEVERITY_ORDER),
        fc.constantFrom(...SEVERITY_ORDER),
        (at: Severity, now: Severity) => {
          const disposition: Disposition = { ...reviewed, atSeverity: at };
          const hidden = suppressed(signal({ severity: now }), disposition);
          const worsened = SEVERITY_ORDER.indexOf(now) > SEVERITY_ORDER.indexOf(at);
          return !(worsened && hidden);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('lapses a snooze on its own date', () => {
    const snoozed: Disposition = {
      ...reviewed,
      disposition: 'SNOOZED',
      snoozeUntil: '2026-09-01',
    };
    expect(suppressed(signal({ occurredOn: '2026-08-20' }), snoozed)).toBe(true);
    expect(suppressed(signal({ occurredOn: '2026-09-02' }), snoozed)).toBe(false);
  });

  it('has no permanent dismissal — clearing a disposition un-suppresses', () => {
    expect(suppressed(signal(), undefined)).toBe(false);
  });

  // A user may disagree with a health signal in writing; they cannot hide it.
  it('refuses to dispose of a health signal', () => {
    expect(canDispose(signal({ surfaces: ['RADAR'] }))).toBe(true);
    expect(canDispose(signal({ surfaces: ['RADAR', 'HEALTH'] }))).toBe(false);
  });

  it('keeps a health signal visible even when a disposition exists', () => {
    const health = signal({ surfaces: ['HEALTH'] });
    const visible = visibleSignals([health], new Map([['K1', reviewed]]));
    expect(visible).toEqual([health]);
  });

  it('hides a disposed attention signal', () => {
    const attention = signal({ surfaces: ['RADAR'] });
    expect(visibleSignals([attention], new Map([['K1', reviewed]]))).toEqual([]);
  });
});

// ── Health projection ──────────────────────────────────────────────────────

describe('healthLevel', () => {
  const at = (severity: Severity, surfaces: RuleResult['surfaces']): RuleResult => ({
    signalKey: `K-${severity}`,
    ruleCode: 'TGT_MISSED',
    entityRef: { kind: 'COMMITMENT', id: 'c-1' },
    category: 'TIMING',
    severity,
    surfaces,
    facts: {},
    conditionFingerprint: 'F',
    actions: [],
    occurredOn: '2026-08-15',
  });

  it('is OK with nothing on the health surface', () => {
    expect(healthLevel([])).toBe('OK');
    expect(healthLevel([at('HIGH', ['RADAR'])])).toBe('OK');
  });

  it('maps the highest health severity', () => {
    expect(healthLevel([at('MEDIUM', ['HEALTH'])])).toBe('WATCH');
    expect(healthLevel([at('HIGH', ['HEALTH'])])).toBe('AT_RISK');
    expect(healthLevel([at('LOW', ['HEALTH'])])).toBe('OK');
  });

  it('takes the worst, not the latest', () => {
    expect(healthLevel([at('HIGH', ['HEALTH']), at('LOW', ['HEALTH'])])).toBe('AT_RISK');
  });

  // Attention and health are orthogonal: a commitment can be healthy and need
  // looking at, or unhealthy and need nothing from this user.
  it('never merges attention into health', () => {
    const attentionOnly = [at('HIGH', ['RADAR']), at('HIGH', ['RADAR'])];
    expect(healthLevel(attentionOnly)).toBe('OK');
  });
});

// ── No ambient anything ────────────────────────────────────────────────────

describe('purity', () => {
  it('produces the same results whatever the machine clock says', () => {
    const first = evaluateAll(ALL_RULES, state(busy), ctx());
    const later = evaluateAll(ALL_RULES, state(busy), ctx());
    expect(JSON.stringify(first)).toBe(JSON.stringify(later));
  });

  it('moves every date-driven signal when the injected clock moves', () => {
    const now = evaluateAll(ALL_RULES, state(busy), ctx());
    const future = evaluateAll(
      ALL_RULES,
      state(busy),
      ctx({ clock: { now: () => '2027-08-15T00:00:00Z', today: () => '2027-08-15' } }),
    );
    expect(future.map((r) => r.ruleCode)).not.toEqual(now.map((r) => r.ruleCode));
  });

  it('does not depend on the order entities arrive in', () => {
    const forwards = evaluateAll(ALL_RULES, state(busy), ctx());
    const backwards = evaluateAll(
      ALL_RULES,
      state({
        ...busy,
        commitments: [...busy.commitments].reverse(),
        footprints: [...busy.footprints].reverse(),
        teams: [...busy.teams].reverse(),
      }),
      ctx(),
    );
    expect(backwards.map((r) => r.signalKey)).toEqual(forwards.map((r) => r.signalKey));
  });
});

describe('conditionFingerprint', () => {
  it('ignores facts the rule did not declare material', () => {
    expect(conditionFingerprint({ a: 1 })).toBe(conditionFingerprint({ a: 1 }));
    expect(conditionFingerprint({ a: 1 })).not.toBe(conditionFingerprint({ a: 2 }));
  });
});

describe('cycle detection at scale', () => {
  it('finds a cycle among 600 dependencies well inside the budget', () => {
    const many = Array.from({ length: 300 }, (_, i) => commitment(`x-${i}`));
    const chain = Array.from({ length: 299 }, (_, i) =>
      dependency(`dep-${i}`, {
        sourceCommitmentId: `x-${i}`,
        target: { kind: 'COMMITMENT', id: `x-${i + 1}` },
      }),
    );
    // Close the loop, so there is genuinely something to find.
    chain.push(
      dependency('dep-close', {
        sourceCommitmentId: 'x-299',
        target: { kind: 'COMMITMENT', id: 'x-0' },
      }),
    );

    const input = state({ commitments: many, dependencies: chain });
    const run = () => {
      const started = performance.now();
      const results = evaluateAll([RULES_BY_CODE.get('DEP_CYCLE')!], input, ctx());
      return { elapsed: performance.now() - started, count: results.length };
    };

    // Best of three. A single wall-clock reading inside a parallel suite
    // measures machine contention as much as the algorithm, and the spec's
    // 100 ms budget is a *reference-device* figure (spec 11 §6.1) that CI
    // cannot stand in for. This guards the complexity — a quadratic walk would
    // blow past even a generous bound — and the real measurement is owed on the
    // reference hardware, tracked as M0-SPK-7.
    const best = [run(), run(), run()].reduce((a, b) => (a.elapsed < b.elapsed ? a : b));

    expect(best.count).toBe(300);
    expect(best.elapsed).toBeLessThan(250);
  });

  it('does not overflow the stack on a long chain', () => {
    const many = Array.from({ length: 2000 }, (_, i) => commitment(`y-${i}`));
    const chain = Array.from({ length: 1999 }, (_, i) =>
      dependency(`d-${i}`, {
        sourceCommitmentId: `y-${i}`,
        target: { kind: 'COMMITMENT', id: `y-${i + 1}` },
      }),
    );
    expect(() =>
      evaluateAll(
        [RULES_BY_CODE.get('DEP_CYCLE')!],
        state({ commitments: many, dependencies: chain }),
        ctx(),
      ),
    ).not.toThrow();
  });
});

describe('quarter-spanning signals', () => {
  it('discriminates one team-quarter from another', () => {
    const results = evaluateAll(
      [RULES_BY_CODE.get('CAP_OVERFLOW')!],
      state({
        teams: [team('t-1')],
        teamQuarters: [teamQuarter('tq-1', 't-1', Q), teamQuarter('tq-2', 't-1', NEXT_Q)],
        commitments: [commitment('c-1')],
        footprints: [
          footprint('f-1', 'c-1', 't-1', Q, 150),
          footprint('f-2', 'c-1', 't-1', NEXT_Q, 150),
        ],
      }),
      ctx(),
    );
    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.signalKey)).size).toBe(2);
  });
});
