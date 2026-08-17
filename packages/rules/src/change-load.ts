/**
 * Product change load — docs/spec/04-rules-radar.md §5.
 *
 * How much change one product or service is absorbing in one quarter.
 * Deterministic, explainable, configurable — and it returns its own arithmetic
 * so the panel can show the working rather than a number nobody can argue with.
 *
 * Ideas contribute nothing at baseline. They contribute in a scenario, where
 * the scenario has given them ghost footprints; that is what `lifecycleFactor`
 * expresses, and why it is a factor rather than a filter.
 */

import type {
  Commitment,
  EntityId,
  ProductImpactType,
  QuarterId,
  WorkspaceState,
} from '@flowmap/domain';

import { commitments, impacts, unitsInQuarter } from './helpers.js';

export type ChangeLoadLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type ChangeLoadContributor = {
  readonly commitmentId: EntityId;
  readonly commitment: string;
  readonly impactType: ProductImpactType;
  readonly units: number;
  readonly impactBase: number;
  readonly sizeFactor: number;
  readonly classFactor: number;
  readonly contribution: number;
};

export type ChangeLoad = {
  readonly productServiceId: EntityId;
  readonly product: string;
  readonly quarterId: QuarterId;
  readonly score: number;
  readonly level: ChangeLoadLevel;
  /** Descending by contribution, so the panel reads as an explanation. */
  readonly contributors: readonly ChangeLoadContributor[];
  readonly thresholds: { readonly medium: number; readonly high: number };
};

/** Two decimal places, so a score is comparable and stable across runs. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type ChangeLoadOptions = { readonly includeScenarioIdeas?: boolean };

export function changeLoadFor(
  state: WorkspaceState,
  productServiceId: EntityId,
  quarterId: QuarterId,
  options: ChangeLoadOptions = {},
): ChangeLoad {
  const settings = state.workspace.settings.changeLoad;
  const product = state.products?.get(productServiceId);

  const own = impacts(state).filter((impact) => impact.productServiceId === productServiceId);
  const byCommitment = new Map(own.map((impact) => [impact.commitmentId, impact]));

  const contributors: ChangeLoadContributor[] = [];

  for (const commitment of commitments(state)) {
    const impact = byCommitment.get(commitment.id);
    if (!impact) continue;

    const lifecycleFactor = lifecycleWeight(commitment, options.includeScenarioIdeas ?? false);
    if (lifecycleFactor === 0) continue;

    const units = unitsFor(state, commitment, quarterId, options.includeScenarioIdeas ?? false);
    if (units === null) continue;

    const impactBase = settings.impactBase[impact.type];
    // A commitment that is large for the delivery organisation lands
    // proportionally more change on the product it touches.
    const sizeFactor = clamp(units / settings.referenceUnits, 0.5, 3.0);
    const classFactor = commitment.class === 'MANDATORY' ? settings.mandatoryFactor : 1.0;
    const contribution = impactBase * sizeFactor * classFactor * lifecycleFactor;

    contributors.push({
      commitmentId: commitment.id,
      commitment: commitment.name,
      impactType: impact.type,
      units,
      impactBase,
      sizeFactor: round2(sizeFactor),
      classFactor,
      contribution: round2(contribution),
    });
  }

  contributors.sort(
    (a, b) => b.contribution - a.contribution || a.commitment.localeCompare(b.commitment),
  );

  const score = round2(contributors.reduce((sum, c) => sum + c.contribution, 0));

  return {
    productServiceId,
    product: product?.name ?? productServiceId,
    quarterId,
    score,
    level:
      score < settings.thresholdMedium ? 'LOW' : score < settings.thresholdHigh ? 'MEDIUM' : 'HIGH',
    contributors,
    thresholds: { medium: settings.thresholdMedium, high: settings.thresholdHigh },
  };
}

/**
 * Units this commitment places on the quarter, or `null` when it does not land
 * there at all.
 *
 * The fallback matters: work with a target quarter but no footprints yet is
 * still change heading at the product, and pretending otherwise would let a
 * product look quiet right up until everything is placed at once.
 */
function unitsFor(
  state: WorkspaceState,
  commitment: Commitment,
  quarterId: QuarterId,
  includeScenarioIdeas: boolean,
): number | null {
  if (includeScenarioIdeas && commitment.lifecycle === 'IDEA') {
    const ghostUnits = [...state.footprints.values()]
      .filter(
        (footprint) =>
          footprint.archivedAt === undefined &&
          footprint.commitmentId === commitment.id &&
          footprint.quarterId === quarterId,
      )
      .reduce((sum, footprint) => sum + footprint.units, 0);
    if (ghostUnits > 0) return ghostUnits;
  }
  const placed = unitsInQuarter(state, commitment, quarterId);
  if (placed > 0) return placed;

  const anyFootprints = [...state.footprints.values()].some(
    (f) => f.commitmentId === commitment.id && f.archivedAt === undefined,
  );
  if (anyFootprints) return null;

  return commitment.targetQuarterId === quarterId ? 0 : null;
}

function lifecycleWeight(commitment: Commitment, includeScenarioIdeas: boolean): number {
  return commitment.lifecycle === 'COMMITTED' ||
    commitment.lifecycle === 'IN_DELIVERY' ||
    (includeScenarioIdeas && commitment.lifecycle === 'IDEA')
    ? 1.0
    : 0.0;
}

/** Every (product, quarter) pair that has any change landing on it. */
export function allChangeLoads(
  state: WorkspaceState,
  options: ChangeLoadOptions = {},
): ChangeLoad[] {
  const pairs = new Set<string>();

  for (const impact of impacts(state)) {
    const commitment = state.commitments.get(impact.commitmentId);
    if (!commitment || lifecycleWeight(commitment, options.includeScenarioIdeas ?? false) === 0)
      continue;

    const quarters = new Set<QuarterId>();
    for (const footprint of state.footprints.values()) {
      if (footprint.commitmentId !== commitment.id || footprint.archivedAt !== undefined) continue;
      quarters.add(footprint.quarterId);
    }
    if (quarters.size === 0 && commitment.targetQuarterId) quarters.add(commitment.targetQuarterId);

    for (const quarterId of quarters) pairs.add(`${impact.productServiceId}|${quarterId}`);
  }

  return [...pairs]
    .sort()
    .map((pair) => {
      const [productServiceId, quarterId] = pair.split('|') as [EntityId, QuarterId];
      return changeLoadFor(state, productServiceId, quarterId, options);
    })
    .filter((load) => load.contributors.length > 0);
}
