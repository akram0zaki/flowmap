/**
 * The evaluator.
 *
 * Pure and referentially transparent: the same state, clock and settings give
 * byte-identical results, which is asserted by a golden-file test over the
 * validation fixture. Nothing here reads ambient time, randomness, locale, or
 * object key order.
 *
 * Normative source: docs/spec/04-rules-radar.md §1, §3.3 and §8.
 */

import { refKey, type ProjectionKey, type WorkspaceState } from '@flowmap/domain';

import { conditionFingerprint, signalKey } from './identity.js';
import {
  compareSeverity,
  severityRank,
  type Disposition,
  type HealthLevel,
  type ProjectionPattern,
  type Rule,
  type RuleCode,
  type RuleContext,
  type RuleDelta,
  type RuleResult,
  type Severity,
} from './types.js';

/**
 * Runs every enabled rule.
 *
 * Results are sorted by signal key so two runs over the same state produce the
 * same array, not merely the same set — a golden file cannot assert "same set".
 */
export function evaluateAll(
  rules: readonly Rule[],
  state: WorkspaceState,
  ctx: RuleContext,
): RuleResult[] {
  const today = ctx.clock.today(ctx.timezone);
  const results: RuleResult[] = [];

  for (const rule of rules) {
    if (!isEnabled(rule, ctx)) continue;
    for (const result of runRule(rule, state, ctx, today)) results.push(result);
  }

  return results.sort((a, b) =>
    a.signalKey < b.signalKey ? -1 : a.signalKey > b.signalKey ? 1 : 0,
  );
}

/**
 * Re-runs only the rules that read a projection the command touched.
 *
 * The delta is computed against the caller's previous results rather than held
 * in engine state, because the engine is pure — and because a stale cache is
 * exactly the bug this design exists to make impossible. A property test
 * asserts this agrees with `evaluateAll` after any command sequence.
 */
export function evaluateIncremental(
  rules: readonly Rule[],
  state: WorkspaceState,
  ctx: RuleContext,
  affected: readonly ProjectionKey[],
  previous: readonly RuleResult[],
): RuleDelta {
  const dirty = rules.filter((rule) => isEnabled(rule, ctx) && readsAny(rule, affected));
  const dirtyCodes = new Set<RuleCode>(dirty.map((rule) => rule.code));

  const today = ctx.clock.today(ctx.timezone);
  const recomputed = new Map<string, RuleResult>();
  for (const rule of dirty) {
    for (const result of runRule(rule, state, ctx, today)) recomputed.set(result.signalKey, result);
  }

  const added: RuleResult[] = [];
  const updated: RuleResult[] = [];
  const removed: string[] = [];

  const before = new Map(
    previous.filter((result) => dirtyCodes.has(result.ruleCode)).map((r) => [r.signalKey, r]),
  );

  for (const [key, result] of recomputed) {
    const prior = before.get(key);
    if (!prior) added.push(result);
    // Identity is stable by construction, so a change shows up in the
    // fingerprint or the severity — never in the key.
    else if (
      prior.conditionFingerprint !== result.conditionFingerprint ||
      prior.severity !== result.severity
    ) {
      updated.push(result);
    }
  }

  for (const key of before.keys()) {
    if (!recomputed.has(key)) removed.push(key);
  }

  return { added, updated, removed: removed.sort() };
}

/**
 * Applies a delta to a previous result set.
 *
 * Kept here so callers do not each invent their own merge — and so the
 * equivalence property has something concrete to compare against.
 */
export function applyDelta(previous: readonly RuleResult[], delta: RuleDelta): RuleResult[] {
  const byKey = new Map(previous.map((result) => [result.signalKey, result]));
  for (const key of delta.removed) byKey.delete(key);
  for (const result of [...delta.added, ...delta.updated]) byKey.set(result.signalKey, result);

  return [...byKey.values()].sort((a, b) =>
    a.signalKey < b.signalKey ? -1 : a.signalKey > b.signalKey ? 1 : 0,
  );
}

function runRule(rule: Rule, state: WorkspaceState, ctx: RuleContext, today: string): RuleResult[] {
  const threshold = effectiveThreshold(rule, ctx);
  const findings = rule.evaluate({ state, ctx, today, threshold });

  return findings.map((finding) => {
    // Material facts drive the fingerprint. Declaring them on the rule rather
    // than per finding is what stops `daysOverdue` creeping into an identity
    // and resurrecting every reviewed signal at midnight.
    const material: Record<string, unknown> = {};
    for (const name of rule.materialFacts) {
      if (finding.facts[name] !== undefined) material[name] = finding.facts[name];
    }

    return {
      signalKey: signalKey(rule.code, refKey(finding.entityRef), finding.discriminator ?? ''),
      ruleCode: rule.code,
      entityRef: finding.entityRef,
      category: rule.category,
      severity: resolveSeverity(rule, ctx, finding.severity),
      surfaces: rule.surfaces,
      facts: finding.facts,
      conditionFingerprint: conditionFingerprint(material),
      actions: finding.actions ?? [],
      occurredOn: today,
      ...(Object.keys(threshold).length > 0 ? { threshold } : {}),
      ...(finding.dueOn !== undefined ? { dueOn: finding.dueOn } : {}),
    } satisfies RuleResult;
  });
}

export function effectiveThreshold(rule: Rule, ctx: RuleContext): Record<string, number> {
  return { ...(rule.defaults ?? {}), ...(ctx.settings.thresholds[rule.code] ?? {}) };
}

/**
 * A workspace may lower a severity, never raise it.
 *
 * Raising would let a workspace turn an advisory into a blocker the product
 * never designed for — and the Commit Gate reads severity.
 */
function resolveSeverity(rule: Rule, ctx: RuleContext, findingSeverity?: Severity): Severity {
  const override = ctx.settings.severityOverrides[rule.code];
  const ceiling = rule.severity;
  const candidates = [findingSeverity ?? ceiling, override ?? ceiling];
  return candidates.reduce((lowest, next) => (compareSeverity(next, lowest) < 0 ? next : lowest));
}

function isEnabled(rule: Rule, ctx: RuleContext): boolean {
  if (!rule.canDisable) return true;
  return ctx.settings.enabled[rule.code] !== false;
}

function readsAny(rule: Rule, affected: readonly ProjectionKey[]): boolean {
  return affected.some((key) => rule.reads.some((pattern) => matchesPattern(pattern, key)));
}

export function matchesPattern(pattern: ProjectionPattern, key: ProjectionKey): boolean {
  if (pattern.endsWith(':*')) return key.startsWith(pattern.slice(0, -1));
  return pattern === key;
}

// ── Suppression ────────────────────────────────────────────────────────────

/**
 * Whether a disposition hides this signal.
 *
 * The two consequences are the point of the design, not side effects of it:
 * `Reviewed — no change` never expires on a timer — it expires when the
 * situation changes or worsens; and there is no permanent dismissal, because a
 * severity increase always breaks through.
 */
export function suppressed(result: RuleResult, disposition: Disposition | undefined): boolean {
  if (!disposition) return false;
  // Breakthrough. Asserted by a property test: suppression never hides a signal
  // whose severity has increased.
  if (severityRank(result.severity) > severityRank(disposition.atSeverity)) return false;
  if (result.conditionFingerprint !== disposition.atFingerprint) return false;

  if (disposition.disposition === 'REVIEWED') return true;
  // A snooze also lapses on its own date, in workspace-local terms.
  return disposition.snoozeUntil !== undefined && result.occurredOn < disposition.snoozeUntil;
}

/**
 * Health signals cannot be disposed of (spec 04 §2) — a user may disagree in
 * writing, and the annotation shows alongside, but the condition stays visible.
 */
export function canDispose(result: RuleResult): boolean {
  return !result.surfaces.includes('HEALTH');
}

export function visibleSignals(
  results: readonly RuleResult[],
  dispositions: ReadonlyMap<string, Disposition>,
): RuleResult[] {
  return results.filter(
    (result) => !canDispose(result) || !suppressed(result, dispositions.get(result.signalKey)),
  );
}

// ── Health projection ──────────────────────────────────────────────────────

/**
 * Health is the highest severity among a commitment's HEALTH-surfacing signals.
 *
 * Deliberately not merged with attention into one number or one colour: a
 * commitment can be healthy and need attention now, or unhealthy and need
 * nothing from *this* user.
 */
export function healthLevel(results: readonly RuleResult[]): HealthLevel {
  let highest: Severity | null = null;
  for (const result of results) {
    if (!result.surfaces.includes('HEALTH')) continue;
    if (highest === null || compareSeverity(result.severity, highest) > 0)
      highest = result.severity;
  }

  if (highest === 'HIGH') return 'AT_RISK';
  if (highest === 'MEDIUM') return 'WATCH';
  return 'OK';
}

export function healthByCommitment(
  results: readonly RuleResult[],
): ReadonlyMap<string, HealthLevel> {
  const grouped = new Map<string, RuleResult[]>();
  for (const result of results) {
    if (result.entityRef.kind !== 'COMMITMENT') continue;
    const list = grouped.get(result.entityRef.id) ?? [];
    list.push(result);
    grouped.set(result.entityRef.id, list);
  }

  const out = new Map<string, HealthLevel>();
  for (const [id, own] of grouped) out.set(id, healthLevel(own));
  return out;
}
