/**
 * Rule evaluation for the app.
 *
 * The engine is pure and synchronous, so this is a `useMemo` rather than an
 * effect: signals are a function of state, not a thing that happens to it. That
 * also means there is no cache to invalidate and no window in which the board
 * and the Radar disagree.
 *
 * Incremental evaluation exists for the moment this becomes too slow at 500
 * commitments — the engine already supports it, and `affectedProjections` is
 * already on every command result. It is deliberately not wired in yet: a
 * memo that recomputes in a few milliseconds is simpler and cannot drift.
 */

import { useMemo } from 'react';
import {
  ALL_RULES,
  NO_RULE_SETTINGS,
  evaluateAll,
  healthByCommitment,
  resolveOwnedRefs,
  visibleSignals,
  type Disposition,
  type HealthLevel,
  type RuleResult,
  type RuleSettings,
} from '@flowmap/rules';
import type { DomainEvent, WorkspaceState } from '@flowmap/domain';

export type SignalView = {
  /** Everything the rules found, before any disposition is applied. */
  readonly all: readonly RuleResult[];
  /** What Radar shows: attention signals this user has not disposed of. */
  readonly visible: readonly RuleResult[];
  readonly health: ReadonlyMap<string, HealthLevel>;
  readonly dispositions: ReadonlyMap<string, Disposition>;
  readonly ownedRefs: ReadonlySet<string>;
  readonly today: string;
};

export const EMPTY_SIGNALS: SignalView = {
  all: [],
  visible: [],
  health: new Map(),
  dispositions: new Map(),
  ownedRefs: new Set(),
  today: '',
};

export function useSignals(
  state: WorkspaceState | null,
  input: {
    readonly actorId: string;
    readonly personId?: string;
    readonly settings?: RuleSettings;
    readonly now: () => string;
    /** Event log, for the one rule a snapshot cannot answer. */
    readonly events?: readonly DomainEvent[];
  },
): SignalView {
  const { actorId, personId, settings, now, events } = input;

  return useMemo(() => {
    if (!state) return EMPTY_SIGNALS;

    const today = todayIn(now(), state.workspace.timezone);

    const ownedRefs = resolveOwnedRefs({
      ...(personId !== undefined ? { personId } : {}),
      commitments: [...state.commitments.values()],
      dependencies: [...(state.dependencies?.values() ?? [])],
      decisions: [...(state.decisions?.values() ?? [])],
      milestones: [...(state.milestones?.values() ?? [])],
    });

    const all = evaluateAll(ALL_RULES, state, {
      clock: { now, today: () => today },
      timezone: state.workspace.timezone,
      settings: settings ?? NO_RULE_SETTINGS,
      actorId,
      ownedRefs,
      ...(personId !== undefined ? { personId } : {}),
      ...(events
        ? {
            history: {
              quarterMovedLater: countQuarterMoves(events),
              closedQuarters: closedQuarterReviews(events),
            },
          }
        : {}),
    });

    // Dispositions are per user: this actor's opinions, nobody else's.
    const dispositions = new Map<string, Disposition>();
    for (const row of state.signalDispositions?.values() ?? []) {
      if (row.archivedAt !== undefined || row.actorId !== actorId) continue;
      dispositions.set(row.signalKey, row);
    }

    return {
      all,
      visible: visibleSignals(all, dispositions),
      health: healthByCommitment(all),
      dispositions,
      ownedRefs,
      today,
    };
  }, [state, actorId, personId, settings, now, events]);
}

/**
 * How many times each commitment's target quarter has moved later.
 *
 * Derived from the event log rather than stored on the entity: a counter on the
 * commitment would be a second source of truth that sync has to keep honest,
 * and the events already say it.
 */
function countQuarterMoves(events: readonly DomainEvent[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  for (const event of events) {
    if (event.eventType !== 'COMMITMENT_UPDATED') continue;
    const fields = String(event.facts['fields'] ?? '');
    if (!fields.includes('targetQuarterId')) continue;

    for (const ref of event.entityRefs) {
      if (ref.kind !== 'COMMITMENT') continue;
      counts.set(ref.id, (counts.get(ref.id) ?? 0) + 1);
    }
  }

  return counts;
}

function closedQuarterReviews(events: readonly DomainEvent[]) {
  return events
    .filter((event) => event.eventType === 'QUARTER_CLOSED')
    .map((event) => ({
      quarterId: String(event.facts['quarterId'] ?? ''),
      outcomes: Array.isArray(event.facts['outcomes'])
        ? (event.facts['outcomes'] as Array<{
            teamId: string;
            operationalLoad: 'BELOW' | 'ABOUT' | 'ABOVE';
            capacity: 'LOWER' | 'ABOUT' | 'HIGHER';
          }>)
        : [],
      carriedByTeam:
        (event.facts['carriedByTeam'] as Readonly<Record<string, number>> | undefined) ?? {},
      sizeRatiosByTeam:
        (event.facts['sizeRatiosByTeam'] as
          Readonly<Record<string, readonly number[]>> | undefined) ?? {},
    }))
    .filter((review) => review.quarterId.length > 0);
}

/**
 * Today's calendar date in the workspace timezone.
 *
 * The app is the right place for this: `Intl` is banned in the pure packages
 * precisely so the resolved date is handed to them rather than computed inside
 * a rule, where it would make every comparison locale-dependent.
 */
export function todayIn(nowIso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowIso));
}
