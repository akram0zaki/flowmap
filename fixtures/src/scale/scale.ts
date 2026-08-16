/**
 * Scale fixtures: 25, 100 and 500 commitments.
 *
 * Deterministically generated from the validation fixture's *shape* rather than
 * randomly, so a benchmark run is comparable with the one before it and a
 * regression is a diff rather than a feeling. Spec 11 §5.2.
 *
 * Proportions come from the real fixture — roughly 1.8 footprints per
 * commitment, spread across teams and quarters, with the same mix of
 * lifecycles and classes. A pile of identical rows would benchmark the
 * renderer's best case and tell us nothing.
 *
 * No ambient randomness, clock or ids: everything is derived from the index, so
 * the same call always produces the same workspace.
 */

import type {
  CapacityFootprint,
  Commitment,
  CommitmentClass,
  Lifecycle,
  QuarterId,
  Team,
  TeamQuarter,
  Workspace,
} from '@flowmap/domain';
import { envelope, fixtureId } from '@flowmap/testing';

import { validationFixture } from '../validation/validation.js';

export type ScaleFixture = {
  readonly workspace: Workspace;
  readonly teams: readonly Team[];
  readonly teamQuarters: readonly TeamQuarter[];
  readonly commitments: readonly Commitment[];
  readonly footprints: readonly CapacityFootprint[];
};

/** Cycled rather than sampled, so the mix is exact at every size. */
const LIFECYCLES: readonly Lifecycle[] = [
  'COMMITTED',
  'IN_DELIVERY',
  'COMMITTED',
  'IDEA',
  'IN_DELIVERY',
  'DONE',
  'COMMITTED',
  'ON_HOLD',
];

const CLASSES: readonly CommitmentClass[] = [
  'STRATEGIC',
  'MANDATORY',
  'DISCRETIONARY',
  'OPERATIONAL',
  'STRATEGIC',
];

/** Enough to hold the load at every scale without every team overflowing. */
const TEAM_COUNT = 20;
const UNIT_SIZES = [5, 10, 15, 20, 25, 35] as const;

export function scaleFixture(commitmentCount: 25 | 100 | 500): ScaleFixture {
  const base = validationFixture();
  const horizon = base.horizon;
  const workspaceId = base.workspace.id;

  const teams: Team[] = Array.from({ length: TEAM_COUNT }, (_, index) => ({
    ...envelope({ id: fixtureId(`scale-team-${index}`) }),
    workspaceId,
    name: `Team ${String(index + 1).padStart(2, '0')}`,
    defaultQuarterCapacity: 100,
    displayOrder: index,
    active: true,
  }));

  const teamQuarters: TeamQuarter[] = teams.flatMap((team) =>
    horizon.map((quarterId) => ({
      ...envelope({ id: fixtureId(`scale-tq-${team.displayOrder}-${quarterId}`) }),
      workspaceId,
      teamId: team.id,
      quarterId,
      capacityBaseline: 100,
      capacityAdjustment: 0,
      reserves: [
        {
          id: fixtureId(`scale-res-${team.displayOrder}-${quarterId}`),
          type: 'BAU_SUPPORT' as const,
          label: 'BAU & support',
          amount: 15,
        },
      ],
    })),
  );

  const commitments: Commitment[] = [];
  const footprints: CapacityFootprint[] = [];

  for (let index = 0; index < commitmentCount; index++) {
    const id = fixtureId(`scale-commitment-${index}`);
    const lifecycle = LIFECYCLES[index % LIFECYCLES.length]!;
    const primaryTeam = teams[index % teams.length]!;

    commitments.push({
      ...envelope({ id }),
      workspaceId,
      name: `Commitment ${String(index + 1).padStart(3, '0')}`,
      lifecycle,
      class: CLASSES[index % CLASSES.length]!,
      importance: index % 3 === 0 ? 'HIGH' : index % 3 === 1 ? 'MEDIUM' : 'LOW',
      primaryTeamId: primaryTeam.id,
      valueDrivers: [],
      ...(lifecycle === 'IDEA'
        ? {}
        : { committedAt: '2026-04-01T09:00:00Z', committedBy: 'local:fixture-planner' }),
    });

    // Ideas hold no capacity — that invariant has to survive at scale too.
    if (lifecycle === 'IDEA') continue;

    // Roughly 1.8 footprints per commitment: every one gets a primary, and
    // every fifth spills onto a second team the way real work does.
    const quarter = horizon[index % horizon.length] as QuarterId;
    footprints.push(placement(workspaceId, id, primaryTeam.id, quarter, index, true));

    if (index % 5 !== 0) {
      const second = teams[(index + 7) % teams.length]!;
      const nextQuarter = horizon[(index + 1) % horizon.length] as QuarterId;
      footprints.push(placement(workspaceId, id, second.id, nextQuarter, index + 1, false));
    }
  }

  return {
    workspace: { ...base.workspace, name: `Scale ${commitmentCount}` },
    teams,
    teamQuarters,
    commitments,
    footprints,
  };
}

function placement(
  workspaceId: string,
  commitmentId: string,
  teamId: string,
  quarterId: QuarterId,
  seed: number,
  isPrimary: boolean,
): CapacityFootprint {
  return {
    ...envelope({ id: fixtureId(`scale-fp-${commitmentId}-${teamId}-${quarterId}`) }),
    workspaceId,
    commitmentId,
    teamId,
    quarterId,
    units: UNIT_SIZES[seed % UNIT_SIZES.length]!,
    unitsSource: 'EXPLICIT',
    isPrimary,
  };
}
