/**
 * Shared accessors and date arithmetic for the rule catalogue.
 *
 * Every day comparison in this package goes through here, in the workspace
 * timezone's calendar date. Rules never touch `Date.now()` or a locale — the
 * date arrives already resolved on `RuleInput.today`.
 */

import {
  isActive,
  isCounted,
  summariseCapacity,
  type CapacityFootprint,
  type CapacitySummary,
  type Commitment,
  type Decision,
  type Dependency,
  type EntityId,
  type EntityRef,
  type ExternalLink,
  type Milestone,
  type ProductImpact,
  type ProductService,
  type QuarterId,
  type Team,
  type TeamQuarter,
  type WorkspaceState,
} from '@flowmap/domain';

import type { IsoDate } from '@flowmap/domain';

const MS_PER_DAY = 86_400_000;

/**
 * Days from `from` to `to`, positive when `to` is later.
 *
 * Parsed as UTC midnight rather than through the platform's local-time parser:
 * both inputs are already calendar dates in the workspace timezone, so any
 * further zone conversion would shift them by a day near a boundary — which is
 * exactly the class of bug a "due today" rule must not have.
 */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / MS_PER_DAY);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(utcMidnight(date) + days * MS_PER_DAY);
}

function utcMidnight(date: IsoDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function toIsoDate(ms: number): IsoDate {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Lifecycles that are over. No timing rule fires on one. */
export const TERMINAL: ReadonlySet<Commitment['lifecycle']> = new Set(['DONE', 'DROPPED']);

export function isTerminal(commitment: Commitment): boolean {
  return TERMINAL.has(commitment.lifecycle);
}

/** Work past the Commit Gate and not finished. */
export function isLive(commitment: Commitment): boolean {
  return commitment.lifecycle === 'COMMITTED' || commitment.lifecycle === 'IN_DELIVERY';
}

// ── Collections ────────────────────────────────────────────────────────────

export function commitments(state: WorkspaceState): Commitment[] {
  return [...state.commitments.values()].filter(isActive);
}

export function footprints(state: WorkspaceState): CapacityFootprint[] {
  return [...state.footprints.values()].filter(isActive);
}

export function teams(state: WorkspaceState): Team[] {
  return [...state.teams.values()].filter((team) => isActive(team) && team.active);
}

export function teamQuarters(state: WorkspaceState): TeamQuarter[] {
  return [...state.teamQuarters.values()].filter(isActive);
}

export function dependencies(state: WorkspaceState): Dependency[] {
  return [...(state.dependencies?.values() ?? [])].filter(isActive);
}

export function decisions(state: WorkspaceState): Decision[] {
  return [...(state.decisions?.values() ?? [])].filter(isActive);
}

export function milestones(state: WorkspaceState): Milestone[] {
  return [...(state.milestones?.values() ?? [])].filter(isActive);
}

export function impacts(state: WorkspaceState): ProductImpact[] {
  return [...(state.productImpacts?.values() ?? [])].filter(isActive);
}

export function products(state: WorkspaceState): ProductService[] {
  return [...(state.products?.values() ?? [])].filter((p) => isActive(p) && p.active);
}

export function links(state: WorkspaceState): ExternalLink[] {
  return [...(state.externalLinks?.values() ?? [])].filter(isActive);
}

// ── Derived views the rules keep asking for ────────────────────────────────

export function footprintsOf(state: WorkspaceState, commitmentId: EntityId): CapacityFootprint[] {
  return footprints(state).filter((f) => f.commitmentId === commitmentId);
}

/** Footprints that actually consume capacity right now. */
export function countedFootprintsOf(
  state: WorkspaceState,
  commitment: Commitment,
): CapacityFootprint[] {
  return footprintsOf(state, commitment.id).filter((f) =>
    isCounted(f, commitment, state.workspace.currentQuarterId),
  );
}

export function unitsOf(state: WorkspaceState, commitment: Commitment): number {
  return countedFootprintsOf(state, commitment).reduce((sum, f) => sum + f.units, 0);
}

/** Counted units for one commitment in one quarter, across every team. */
export function unitsInQuarter(
  state: WorkspaceState,
  commitment: Commitment,
  quarterId: QuarterId,
): number {
  return countedFootprintsOf(state, commitment)
    .filter((f) => f.quarterId === quarterId)
    .reduce((sum, f) => sum + f.units, 0);
}

export function summaryFor(state: WorkspaceState, tq: TeamQuarter): CapacitySummary {
  return summariseCapacity({
    teamQuarter: tq,
    footprints: footprints(state),
    commitmentsById: state.commitments,
    currentQuarterId: state.workspace.currentQuarterId,
  });
}

export function teamName(state: WorkspaceState, teamId: EntityId): string {
  return state.teams.get(teamId)?.name ?? teamId;
}

export function commitmentName(state: WorkspaceState, commitmentId: EntityId): string {
  return state.commitments.get(commitmentId)?.name ?? commitmentId;
}

/** Names whatever a dependency points at, whichever of the four kinds it is. */
export function targetName(state: WorkspaceState, target: Dependency['target']): string {
  switch (target.kind) {
    case 'COMMITMENT':
      return commitmentName(state, target.id);
    case 'TEAM':
      return teamName(state, target.id);
    case 'MILESTONE':
      return state.milestones?.get(target.id)?.name ?? target.id;
    case 'DECISION':
      return state.decisions?.get(target.id)?.name ?? target.id;
  }
}

/** The entity a dependency target points at, when it is one we hold. */
export function targetEntity(
  state: WorkspaceState,
  target: Dependency['target'],
): { archived: boolean; exists: boolean } {
  const lookup =
    target.kind === 'COMMITMENT'
      ? state.commitments.get(target.id)
      : target.kind === 'TEAM'
        ? state.teams.get(target.id)
        : target.kind === 'MILESTONE'
          ? state.milestones?.get(target.id)
          : state.decisions?.get(target.id);

  return { exists: lookup !== undefined, archived: lookup !== undefined && !isActive(lookup) };
}

export function commitmentRef(id: EntityId): EntityRef {
  return { kind: 'COMMITMENT', id };
}

export function ref(kind: EntityRef['kind'], id: EntityId): EntityRef {
  return { kind, id } as EntityRef;
}

/** Unresolved means still in the way. */
export function isUnresolved(status: Dependency['status']): boolean {
  return status !== 'RESOLVED';
}

/**
 * The freshness measure the staleness rules compare against: the later of a
 * meaningful change and an explicit "reviewed — no change".
 */
export function lastTouched(commitment: Commitment): string | undefined {
  const a = commitment.lastMeaningfulUpdateAt;
  const b = commitment.lastReviewedAt;
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

/** An instant reduced to its calendar date, for comparison against `today`. */
export function dateOf(instant: string | undefined): IsoDate | undefined {
  return instant?.slice(0, 10);
}
