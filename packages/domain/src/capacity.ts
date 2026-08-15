/**
 * The capacity arithmetic. Integer arithmetic throughout — no floats in any
 * total. Utilisation is the only ratio, and it is presented rounded.
 *
 * Normative source: docs/spec/02-capacity-model.md §2.
 */

import type { CapacityUnits, EntityId, RelativeSize } from './primitives.js';
import type { CapacityFootprint, Commitment, SizeMapping, TeamQuarter } from './entities.js';
import { isActive } from './entities.js';
import { ordinalOf, type QuarterId } from './quarter.js';
import { err, ok, type Result } from './errors.js';

export type CapacitySummary = {
  readonly teamId: EntityId;
  readonly quarterId: QuarterId;
  readonly effectiveCapacity: CapacityUnits;
  readonly reservedTotal: CapacityUnits;
  readonly deliverableCapacity: CapacityUnits;
  readonly committedLoad: CapacityUnits;
  /** Negative when over capacity. */
  readonly headroom: number;
  readonly overflow: CapacityUnits;
  /** `null` when there is no deliverable capacity — never Infinity or NaN. */
  readonly utilisation: number | null;
};

export function effectiveCapacity(tq: TeamQuarter): CapacityUnits {
  return Math.max(0, tq.capacityBaseline + tq.capacityAdjustment);
}

export function reservedTotal(tq: TeamQuarter): CapacityUnits {
  return tq.reserves.reduce((sum, reserve) => sum + reserve.amount, 0);
}

export function deliverableCapacity(tq: TeamQuarter): CapacityUnits {
  return Math.max(0, effectiveCapacity(tq) - reservedTotal(tq));
}

/**
 * Whether a footprint contributes to a team-quarter's load.
 *
 * R2: COMMITTED and IN_DELIVERY both consume.
 * R3: DONE counts in the current or a past quarter, and zero in a future one —
 *     otherwise a team's utilisation falsely drops as work completes mid-quarter.
 * R4: ON_HOLD never counts as load. Preserved hold capacity becomes a HOLD
 *     reserve instead, so headroom always reconciles with what is on screen.
 */
export function isCounted(
  footprint: CapacityFootprint,
  commitment: Commitment,
  currentQuarterId: QuarterId,
): boolean {
  if (!isActive(footprint) || !isActive(commitment)) return false;

  switch (commitment.lifecycle) {
    case 'COMMITTED':
    case 'IN_DELIVERY':
      return true;
    case 'DONE':
      return ordinalOf(footprint.quarterId) <= ordinalOf(currentQuarterId);
    case 'IDEA':
    case 'ON_HOLD':
    case 'DROPPED':
      return false;
  }
}

export type CapacityInput = {
  readonly teamQuarter: TeamQuarter;
  readonly footprints: readonly CapacityFootprint[];
  readonly commitmentsById: ReadonlyMap<EntityId, Commitment>;
  readonly currentQuarterId: QuarterId;
};

export function summariseCapacity(input: CapacityInput): CapacitySummary {
  const { teamQuarter, footprints, commitmentsById, currentQuarterId } = input;

  const committedLoad = footprints.reduce((sum, footprint) => {
    if (footprint.teamId !== teamQuarter.teamId || footprint.quarterId !== teamQuarter.quarterId) {
      return sum;
    }
    const commitment = commitmentsById.get(footprint.commitmentId);
    if (commitment === undefined) return sum;
    return isCounted(footprint, commitment, currentQuarterId) ? sum + footprint.units : sum;
  }, 0);

  const deliverable = deliverableCapacity(teamQuarter);
  const headroom = deliverable - committedLoad;

  return {
    teamId: teamQuarter.teamId,
    quarterId: teamQuarter.quarterId,
    effectiveCapacity: effectiveCapacity(teamQuarter),
    reservedTotal: reservedTotal(teamQuarter),
    deliverableCapacity: deliverable,
    committedLoad,
    headroom,
    overflow: Math.max(0, -headroom),
    utilisation: deliverable === 0 ? null : committedLoad / deliverable,
  };
}

/** Whole percent, rounded half-up. `null` when there is no deliverable capacity. */
export function utilisationPercent(summary: CapacitySummary): number | null {
  return summary.utilisation === null ? null : Math.round(summary.utilisation * 100);
}

export function isOverCapacity(summary: CapacitySummary): boolean {
  return summary.overflow > 0;
}

// ── Size mapping ───────────────────────────────────────────────────────────

/**
 * Resolves a relative size to units. XL has no mapping and must be entered
 * explicitly — docs/spec/02-capacity-model.md §4.
 *
 * The result is frozen onto the footprint at creation. Changing the workspace
 * mapping later never re-costs an existing plan.
 */
export function resolveUnits(size: RelativeSize, mapping: SizeMapping): Result<CapacityUnits> {
  if (size === 'XL') return err('XL_REQUIRES_EXPLICIT_UNITS', { field: 'size' });
  return ok(mapping[size]);
}

/** Bands total units back to a label for display. Derived, never stored. */
export function sizeSummary(totalUnits: CapacityUnits, mapping: SizeMapping): RelativeSize {
  if (totalUnits <= mapping.XS) return 'XS';
  if (totalUnits <= mapping.S) return 'S';
  if (totalUnits <= mapping.M) return 'M';
  if (totalUnits <= mapping.L) return 'L';
  return 'XL';
}

// ── Aggregates ─────────────────────────────────────────────────────────────

export type CapacityAggregate = {
  readonly load: CapacityUnits;
  readonly capacity: CapacityUnits;
  readonly overflowingCells: number;
  /** `null` when the window has no deliverable capacity at all. */
  readonly pressure: number | null;
};

/**
 * Aggregates MUST come from the same per-cell summaries the map draws, so that
 * the sum of cells always equals the aggregate (property-tested).
 */
export function aggregateCapacity(summaries: readonly CapacitySummary[]): CapacityAggregate {
  let load = 0;
  let capacity = 0;
  let overflowingCells = 0;

  for (const summary of summaries) {
    load += summary.committedLoad;
    capacity += summary.deliverableCapacity;
    if (summary.overflow > 0) overflowingCells += 1;
  }

  return { load, capacity, overflowingCells, pressure: capacity === 0 ? null : load / capacity };
}
