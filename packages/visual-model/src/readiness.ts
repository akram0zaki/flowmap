/**
 * How far an Idea has been worked up.
 *
 * Deliberately not a second Commit Gate. `assessCommitGate` is the authority and
 * runs at the gate itself, where it can see product impacts and dependency
 * review; this reports on the subset the board has loaded.
 *
 * The distinction that matters here is between decisions and placement. An Idea
 * never occupies a team-quarter block — that is an invariant, not an oversight —
 * so "has a footprint" is always false in the lane and useless as a signal. What
 * varies, and what a lead is actually sorting on, is which decisions have been
 * taken: who owns it, when it is wanted, what it is for. When those are settled
 * the only step left is placing it, and the rail says so.
 *
 * See docs/spec/05-scenarios-qbr.md §8.
 */

import type { CapacityFootprint, Commitment, EntityId } from '@flowmap/domain';
import { isActive } from '@flowmap/domain';

/** The decisions an Idea needs before it is worth placing, in the order asked. */
export const READINESS_GAPS = ['PRIMARY_TEAM', 'TARGET', 'OWNER', 'OUTCOME'] as const;

export type ReadinessGap = (typeof READINESS_GAPS)[number];

/** Without a team there is nothing to place it into, so this one is hard. */
const BLOCKING: ReadonlySet<ReadinessGap> = new Set(['PRIMARY_TEAM']);

export type Readiness = {
  /** Decisions still outstanding, blockers first. */
  readonly gaps: readonly ReadinessGap[];
  readonly blocking: readonly ReadinessGap[];
  /** Every decision taken — the only step left is placing it on a team-quarter. */
  readonly readyToPlace: boolean;
  /** How many of the four decisions are settled. Drives the rail's meter. */
  readonly settled: number;
  /** Units already sketched against teams. Zero for any Idea, by invariant. */
  readonly plannedUnits: number;
};

export function ideaReadiness(
  commitment: Commitment,
  footprints: readonly CapacityFootprint[],
): Readiness {
  const own = footprints.filter((f) => f.commitmentId === commitment.id && isActive(f));
  const gaps: ReadinessGap[] = [];

  if (!commitment.primaryTeamId) gaps.push('PRIMARY_TEAM');
  if (!commitment.targetQuarterId && !commitment.targetDate) gaps.push('TARGET');
  if (!commitment.ownerRef) gaps.push('OWNER');
  if (!commitment.outcome) gaps.push('OUTCOME');

  return {
    gaps,
    blocking: gaps.filter((gap) => BLOCKING.has(gap)),
    readyToPlace: gaps.length === 0,
    settled: READINESS_GAPS.length - gaps.length,
    plannedUnits: own.reduce((sum, f) => sum + f.units, 0),
  };
}

export type IdeaReadinessMap = ReadonlyMap<EntityId, Readiness>;

export function readinessForIdeas(
  commitments: ReadonlyMap<EntityId, Commitment>,
  footprints: ReadonlyMap<EntityId, CapacityFootprint>,
): IdeaReadinessMap {
  const all = [...footprints.values()];
  const out = new Map<EntityId, Readiness>();

  for (const commitment of commitments.values()) {
    if (!isActive(commitment) || commitment.lifecycle !== 'IDEA') continue;
    out.set(commitment.id, ideaReadiness(commitment, all));
  }
  return out;
}
