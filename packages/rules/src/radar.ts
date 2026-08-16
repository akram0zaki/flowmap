/**
 * Radar grouping and modes — docs/spec/04-rules-radar.md §6.
 *
 * Radar groups by **reason**, not by commitment name. That is the whole design:
 * a list sorted by name is a directory of things that are wrong; a list grouped
 * by why they are wrong is a plan for the morning.
 *
 * Pure — the view renders what this returns.
 */

import type { EntityRef, IsoDate } from '@flowmap/domain';

import { compareSeverity, type RuleResult, type Severity } from './types.js';
import { daysBetween } from './helpers.js';

export type RadarMode = 'MINE' | 'PORTFOLIO';

/** Fixed order. Spec 04 §6.2 — the sequence is the product, not a preference. */
export const RADAR_GROUPS = [
  'ACTION_NOW',
  'THIS_WEEK',
  'EMERGING',
  'CAPACITY',
  'DEPENDENCIES',
  'OWNERSHIP',
  'IDEA_DECISIONS',
  'STALE',
  'PATTERNS',
  'INTEGRITY',
] as const;

export type RadarGroupId = (typeof RADAR_GROUPS)[number];

export type RadarGroup = {
  readonly id: RadarGroupId;
  readonly signals: readonly RuleResult[];
};

/** Staleness rules, which get their own group rather than sitting under health. */
const STALE_CODES: ReadonlySet<string> = new Set([
  'HLT_STALE_DELIVERY',
  'HLT_STALE_COMMITTED',
  'HLT_STALE_HELD',
]);

/**
 * The first group a signal qualifies for wins.
 *
 * Order matters more than exhaustiveness here: a HIGH-severity dependency due
 * today belongs under "Action needed now", not under "Dependencies", and a lead
 * scanning the top of the list must not have to check nine groups for it.
 */
export function groupOf(signal: RuleResult, today: IsoDate): RadarGroupId {
  if (signal.category === 'INTEGRITY') return 'INTEGRITY';

  if (signal.dueOn !== undefined) {
    const days = daysBetween(today, signal.dueOn);
    if (signal.severity === 'HIGH' && days <= 0) return 'ACTION_NOW';
    if (days >= 0 && days <= 7) return 'THIS_WEEK';
    if (days >= 0 && days <= 30) return 'EMERGING';
    // An overdue signal that is not HIGH still needs answering today.
    if (days < 0) return 'ACTION_NOW';
  }

  if (signal.category === 'CAPACITY') return 'CAPACITY';
  if (signal.category === 'DEPENDENCY') return 'DEPENDENCIES';
  if (signal.category === 'OWNERSHIP') return 'OWNERSHIP';
  if (signal.category === 'READINESS') return 'IDEA_DECISIONS';
  if (STALE_CODES.has(signal.ruleCode)) return 'STALE';
  if (signal.category === 'PRODUCT' || signal.category === 'HISTORY') return 'PATTERNS';
  return 'STALE';
}

/**
 * Within a group: severity descending, then `dueOn` ascending, then entity name.
 *
 * The final tiebreak is the entity name rather than the signal key, because a
 * key is a hash — ordering by it would look random to the person reading it.
 */
export function compareSignals(a: RuleResult, b: RuleResult): number {
  const bySeverity = compareSeverity(b.severity, a.severity);
  if (bySeverity !== 0) return bySeverity;

  const aDue = a.dueOn ?? '9999-12-31';
  const bDue = b.dueOn ?? '9999-12-31';
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;

  const aName = String(a.facts['commitment'] ?? a.facts['team'] ?? a.facts['product'] ?? '');
  const bName = String(b.facts['commitment'] ?? b.facts['team'] ?? b.facts['product'] ?? '');
  if (aName !== bName) return aName.localeCompare(bName);

  // Last resort, so the order is total and a golden file can assert it.
  return a.signalKey < b.signalKey ? -1 : a.signalKey > b.signalKey ? 1 : 0;
}

export function groupSignals(signals: readonly RuleResult[], today: IsoDate): RadarGroup[] {
  const buckets = new Map<RadarGroupId, RuleResult[]>();
  for (const signal of signals) {
    const id = groupOf(signal, today);
    buckets.set(id, [...(buckets.get(id) ?? []), signal]);
  }

  return RADAR_GROUPS.flatMap((id) => {
    const own = buckets.get(id);
    if (!own || own.length === 0) return [];
    return [{ id, signals: [...own].sort(compareSignals) }];
  });
}

/**
 * My Radar: explicit individual ownership only.
 *
 * Team-owned items never appear here. That exclusion is what makes My Radar
 * usable as a personal to-do surface rather than a second inbox — if everything
 * a team owns landed on every member's list, nobody would read either list.
 */
export function isMine(signal: RuleResult, ownedRefs: ReadonlySet<string>): boolean {
  return ownedRefs.has(refKeyOf(signal.entityRef));
}

export function filterMode(
  signals: readonly RuleResult[],
  mode: RadarMode,
  ownedRefs: ReadonlySet<string>,
): RuleResult[] {
  return mode === 'PORTFOLIO' ? [...signals] : signals.filter((s) => isMine(s, ownedRefs));
}

function refKeyOf(ref: EntityRef): string {
  return ref.kind === 'PRODUCT_QUARTER'
    ? `PRODUCT_QUARTER:${ref.productServiceId}:${ref.quarterId}`
    : `${ref.kind}:${ref.id}`;
}

/**
 * Which entities the current user owns individually.
 *
 * Resolved from the workspace rather than assumed by the caller, so "mine"
 * means the same thing on every surface. A team the user belongs to is
 * deliberately not included — see `isMine`.
 */
export function resolveOwnedRefs(input: {
  readonly personId?: string;
  readonly commitments: Iterable<{
    id: string;
    ownerRef?: { kind: string; personId?: string };
    nextActionOwnerRef?: { kind: string; personId?: string };
  }>;
  readonly dependencies?: Iterable<{ id: string; ownerRef?: { kind: string; personId?: string } }>;
  readonly decisions?: Iterable<{ id: string; ownerRef?: { kind: string; personId?: string } }>;
  readonly milestones?: Iterable<{ id: string; commitmentId: string }>;
}): Set<string> {
  const owned = new Set<string>();
  const { personId } = input;
  if (!personId) return owned;

  const isMe = (ref?: { kind: string; personId?: string }) =>
    ref?.kind === 'PERSON' && ref.personId === personId;

  for (const commitment of input.commitments) {
    if (isMe(commitment.ownerRef) || isMe(commitment.nextActionOwnerRef)) {
      owned.add(`COMMITMENT:${commitment.id}`);
    }
  }
  for (const dependency of input.dependencies ?? []) {
    if (isMe(dependency.ownerRef)) owned.add(`DEPENDENCY:${dependency.id}`);
  }
  for (const decision of input.decisions ?? []) {
    if (isMe(decision.ownerRef)) owned.add(`DECISION:${decision.id}`);
  }
  // A milestone belongs to whoever owns the commitment it sits inside.
  for (const milestone of input.milestones ?? []) {
    if (owned.has(`COMMITMENT:${milestone.commitmentId}`)) {
      owned.add(`MILESTONE:${milestone.id}`);
    }
  }

  return owned;
}

/** Counts per rule code, for the settings screen's "how many right now". */
export function countByRule(signals: readonly RuleResult[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    counts.set(signal.ruleCode, (counts.get(signal.ruleCode) ?? 0) + 1);
  }
  return counts;
}

export function countBySeverity(signals: readonly RuleResult[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const signal of signals) counts[signal.severity] += 1;
  return counts;
}
