import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  aggregateCapacity,
  deliverableCapacity,
  effectiveCapacity,
  isCounted,
  reservedTotal,
  resolveUnits,
  sizeSummary,
  summariseCapacity,
  utilisationPercent,
  type CapacityInput,
} from './capacity.js';
import {
  DEFAULT_SIZE_MAPPING,
  type CapacityFootprint,
  type Commitment,
  type Lifecycle,
  type TeamQuarter,
} from './entities.js';
import type { EntityId } from './primitives.js';
import type { QuarterId } from './quarter.js';

const NOW = '2026-08-15T09:00:00Z';
const WORKSPACE = 'ws-1';
const CURRENT_QUARTER: QuarterId = '2026-Q3';

function env(id: string) {
  return {
    id,
    workspaceId: WORKSPACE,
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'actor',
    updatedAt: NOW,
    updatedBy: 'actor',
  };
}

function teamQuarter(over: Partial<TeamQuarter> = {}): TeamQuarter {
  return {
    ...env('tq-1'),
    teamId: 'team-payments',
    quarterId: '2026-Q4',
    capacityBaseline: 100,
    capacityAdjustment: 0,
    reserves: [],
    ...over,
  };
}

function commitment(
  id: EntityId,
  lifecycle: Lifecycle,
  over: Partial<Commitment> = {},
): Commitment {
  return {
    ...env(id),
    name: id,
    lifecycle,
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    valueDrivers: [],
    ...over,
  };
}

function footprint(
  id: EntityId,
  commitmentId: EntityId,
  units: number,
  over: Partial<CapacityFootprint> = {},
): CapacityFootprint {
  return {
    ...env(id),
    commitmentId,
    teamId: 'team-payments',
    quarterId: '2026-Q4',
    units,
    unitsSource: 'EXPLICIT',
    isPrimary: false,
    ...over,
  };
}

function input(
  tq: TeamQuarter,
  pairs: readonly (readonly [Commitment, CapacityFootprint])[],
): CapacityInput {
  return {
    teamQuarter: tq,
    footprints: pairs.map(([, f]) => f),
    commitmentsById: new Map(pairs.map(([c]) => [c.id, c])),
    currentQuarterId: CURRENT_QUARTER,
  };
}

describe('worked example — docs/spec/02-capacity-model.md §2.2', () => {
  // Payments, 2026-Q4: one vacancy, three reserves, three counted footprints.
  // The workspace's current quarter is also 2026-Q4, which is what makes the
  // DONE footprint count (R3).
  const tq = teamQuarter({
    capacityAdjustment: -10,
    reserves: [
      { id: 'r1', type: 'BAU_SUPPORT', label: 'BAU & support', amount: 15 },
      { id: 'r2', type: 'REFINEMENT', label: 'Refinement', amount: 5 },
      {
        id: 'r3',
        type: 'HOLD',
        label: 'Held: Card tokenisation',
        amount: 20,
        systemManaged: true,
      },
    ],
  });

  const sepa = commitment('sepa', 'COMMITTED');
  const fraud = commitment('fraud', 'IN_DELIVERY');
  const legacy = commitment('legacy', 'DONE');

  const summary = summariseCapacity({
    ...input(tq, [
      [sepa, footprint('f1', 'sepa', 35, { isPrimary: true })],
      [fraud, footprint('f2', 'fraud', 20)],
      [legacy, footprint('f3', 'legacy', 5)],
    ]),
    currentQuarterId: '2026-Q4',
  });

  it('reproduces every figure in the spec table', () => {
    expect(summary.effectiveCapacity).toBe(90);
    expect(summary.reservedTotal).toBe(40);
    expect(summary.deliverableCapacity).toBe(50);
    expect(summary.committedLoad).toBe(60);
    expect(summary.headroom).toBe(-10);
    expect(summary.overflow).toBe(10);
    expect(utilisationPercent(summary)).toBe(120);
  });
});

describe('the counted predicate', () => {
  const tq = teamQuarter();

  it.each([
    ['COMMITTED', 20],
    ['IN_DELIVERY', 20],
    ['IDEA', 0],
    ['ON_HOLD', 0],
    ['DROPPED', 0],
  ] as const)('%s contributes %i units', (lifecycle, expected) => {
    const c = commitment('c', lifecycle);
    const summary = summariseCapacity(input(tq, [[c, footprint('f', 'c', 20)]]));
    expect(summary.committedLoad).toBe(expected);
  });

  // R3 — otherwise a team's utilisation falsely drops as work completes.
  it('counts DONE work in the current quarter', () => {
    const done = commitment('done', 'DONE');
    const summary = summariseCapacity(
      input(teamQuarter({ quarterId: CURRENT_QUARTER }), [
        [done, footprint('f', 'done', 15, { quarterId: CURRENT_QUARTER })],
      ]),
    );
    expect(summary.committedLoad).toBe(15);
  });

  it('counts DONE work in a past quarter', () => {
    const done = commitment('done', 'DONE');
    const summary = summariseCapacity(
      input(teamQuarter({ quarterId: '2026-Q1' }), [
        [done, footprint('f', 'done', 15, { quarterId: '2026-Q1' })],
      ]),
    );
    expect(summary.committedLoad).toBe(15);
  });

  it('does not count DONE work in a future quarter', () => {
    const done = commitment('done', 'DONE');
    const summary = summariseCapacity(
      input(teamQuarter({ quarterId: '2027-Q2' }), [
        [done, footprint('f', 'done', 15, { quarterId: '2027-Q2' })],
      ]),
    );
    expect(summary.committedLoad).toBe(0);
  });

  it('ignores archived commitments and archived footprints', () => {
    const archivedCommitment = commitment('a', 'COMMITTED', { archivedAt: NOW });
    const live = commitment('b', 'COMMITTED');

    expect(
      summariseCapacity(input(teamQuarter(), [[archivedCommitment, footprint('f1', 'a', 30)]]))
        .committedLoad,
    ).toBe(0);

    expect(
      summariseCapacity(
        input(teamQuarter(), [[live, footprint('f2', 'b', 30, { archivedAt: NOW })]]),
      ).committedLoad,
    ).toBe(0);
  });

  it('ignores footprints belonging to another team or quarter', () => {
    const c = commitment('c', 'COMMITTED');
    const summary = summariseCapacity(
      input(teamQuarter(), [
        [c, footprint('f1', 'c', 30, { teamId: 'team-platform' })],
        [c, footprint('f2', 'c', 30, { quarterId: '2027-Q1' })],
      ]),
    );
    expect(summary.committedLoad).toBe(0);
  });

  it('ignores a footprint whose commitment is missing from the index', () => {
    const summary = summariseCapacity({
      teamQuarter: teamQuarter(),
      footprints: [footprint('f', 'ghost', 40)],
      commitmentsById: new Map(),
      currentQuarterId: CURRENT_QUARTER,
    });
    expect(summary.committedLoad).toBe(0);
  });
});

describe('R4 — held capacity moves to reserves, never to load', () => {
  const held = commitment('held', 'ON_HOLD', { priorActiveLifecycle: 'COMMITTED' });
  const fp = footprint('f', 'held', 20);

  it('leaves headroom unchanged when the hold preserves capacity', () => {
    const before = summariseCapacity(input(teamQuarter(), [[commitment('held', 'COMMITTED'), fp]]));

    const afterHold = summariseCapacity(
      input(
        teamQuarter({
          reserves: [
            {
              id: 'r-hold',
              type: 'HOLD',
              label: 'Held: held',
              amount: 20,
              systemManaged: true,
            },
          ],
        }),
        [[held, fp]],
      ),
    );

    expect(afterHold.headroom).toBe(before.headroom);
    expect(afterHold.committedLoad).toBe(0);
    expect(afterHold.reservedTotal).toBe(20);
  });

  it('releases capacity when the hold does not preserve it', () => {
    const released = summariseCapacity(input(teamQuarter(), [[held, fp]]));
    expect(released.headroom).toBe(100);
    expect(released.reservedTotal).toBe(0);
  });
});

describe('degenerate capacity', () => {
  it('reports null utilisation rather than Infinity when nothing is deliverable', () => {
    const tq = teamQuarter({
      reserves: [{ id: 'r', type: 'OTHER', label: 'All of it', amount: 100 }],
    });
    const summary = summariseCapacity(
      input(tq, [[commitment('c', 'COMMITTED'), footprint('f', 'c', 10)]]),
    );

    expect(summary.deliverableCapacity).toBe(0);
    expect(summary.utilisation).toBeNull();
    expect(utilisationPercent(summary)).toBeNull();
    expect(summary.overflow).toBe(10);
  });

  it('never reports negative effective capacity', () => {
    expect(effectiveCapacity(teamQuarter({ capacityAdjustment: -500 }))).toBe(0);
    expect(deliverableCapacity(teamQuarter({ capacityAdjustment: -500 }))).toBe(0);
  });

  // The command layer rejects this state with RESERVES_EXCEED_CAPACITY. If a
  // corrupted or externally-edited store ever presents it, we clamp rather than
  // report a negative pool — spec 02 §9 invariant 1.
  it('clamps rather than going negative when reserves exceed capacity', () => {
    const tq = teamQuarter({
      capacityBaseline: 100,
      reserves: [{ id: 'r', type: 'OTHER', label: 'Too much', amount: 140 }],
    });
    expect(deliverableCapacity(tq)).toBe(0);
    expect(reservedTotal(tq)).toBe(140);
  });
});

describe('size mapping', () => {
  it.each([
    ['XS', 5],
    ['S', 10],
    ['M', 20],
    ['L', 35],
  ] as const)('%s resolves to %i units', (size, units) => {
    const result = resolveUnits(size, DEFAULT_SIZE_MAPPING);
    expect(result.ok && result.value).toBe(units);
  });

  it('refuses XL without explicit units', () => {
    const result = resolveUnits('XL', DEFAULT_SIZE_MAPPING);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('XL_REQUIRES_EXPLICIT_UNITS');
  });

  it.each([
    [3, 'XS'],
    [5, 'XS'],
    [10, 'S'],
    [18, 'M'],
    [35, 'L'],
    [36, 'XL'],
    [120, 'XL'],
  ] as const)('%i units summarises as %s', (units, expected) => {
    expect(sizeSummary(units, DEFAULT_SIZE_MAPPING)).toBe(expected);
  });
});

describe('properties', () => {
  const anyReserves = fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 5 });
  const anyUnits = fc.array(fc.integer({ min: 1, max: 60 }), { maxLength: 8 });

  it('deliverable capacity is never negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: -200, max: 50 }),
        anyReserves,
        (baseline, adjustment, amounts) => {
          const tq = teamQuarter({
            capacityBaseline: baseline,
            capacityAdjustment: adjustment,
            reserves: amounts.map((amount, i) => ({
              id: `r${i}`,
              type: 'OTHER' as const,
              label: `r${i}`,
              amount,
            })),
          });
          expect(deliverableCapacity(tq)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('load equals the sum of counted footprint units and nothing else', () => {
    fc.assert(
      fc.property(anyUnits, (unitList) => {
        const pairs = unitList.map((units, i) => {
          const c = commitment(`c${i}`, 'COMMITTED');
          return [c, footprint(`f${i}`, `c${i}`, units)] as const;
        });
        const summary = summariseCapacity(input(teamQuarter(), pairs));
        expect(summary.committedLoad).toBe(unitList.reduce((a, b) => a + b, 0));
      }),
    );
  });

  // Reserves that exceed capacity are rejected by the command layer
  // (RESERVES_EXCEED_CAPACITY), so this property only holds over legal states.
  // The clamped behaviour of the impossible state is asserted separately below.
  const legalReserves = fc
    .array(fc.integer({ min: 0, max: 20 }), { maxLength: 4 })
    .filter((amounts) => amounts.reduce((a, b) => a + b, 0) <= 100);

  it('reserves never change load, only headroom', () => {
    fc.assert(
      fc.property(anyUnits, legalReserves, (unitList, amounts) => {
        const pairs = unitList.map((units, i) => {
          const c = commitment(`c${i}`, 'COMMITTED');
          return [c, footprint(`f${i}`, `c${i}`, units)] as const;
        });
        const reserves = amounts.map((amount, i) => ({
          id: `r${i}`,
          type: 'OTHER' as const,
          label: `r${i}`,
          amount,
        }));

        const withoutReserves = summariseCapacity(input(teamQuarter(), pairs));
        const withReserves = summariseCapacity(input(teamQuarter({ reserves }), pairs));

        expect(withReserves.committedLoad).toBe(withoutReserves.committedLoad);
        expect(withReserves.headroom).toBe(
          withoutReserves.headroom - amounts.reduce((a, b) => a + b, 0),
        );
      }),
    );
  });

  it('the sum of cells equals the aggregate over any window', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 })), {
          minLength: 1,
          maxLength: 12,
        }),
        (cells) => {
          const summaries = cells.map(([capacity, load], i) => {
            const tq = teamQuarter({
              id: `tq${i}`,
              teamId: `team${i}`,
              capacityBaseline: capacity,
            });
            const c = commitment(`c${i}`, 'COMMITTED');
            return summariseCapacity({
              teamQuarter: tq,
              footprints:
                load > 0 ? [footprint(`f${i}`, `c${i}`, load, { teamId: `team${i}` })] : [],
              commitmentsById: new Map([[c.id, c]]),
              currentQuarterId: CURRENT_QUARTER,
            });
          });

          const aggregate = aggregateCapacity(summaries);
          expect(aggregate.load).toBe(summaries.reduce((sum, s) => sum + s.committedLoad, 0));
          expect(aggregate.capacity).toBe(
            summaries.reduce((sum, s) => sum + s.deliverableCapacity, 0),
          );
          expect(aggregate.overflowingCells).toBe(summaries.filter((s) => s.overflow > 0).length);
        },
      ),
    );
  });

  it('reservedTotal is the sum of reserve amounts', () => {
    fc.assert(
      fc.property(anyReserves, (amounts) => {
        const tq = teamQuarter({
          reserves: amounts.map((amount, i) => ({
            id: `r${i}`,
            type: 'OTHER' as const,
            label: `r${i}`,
            amount,
          })),
        });
        expect(reservedTotal(tq)).toBe(amounts.reduce((a, b) => a + b, 0));
      }),
    );
  });
});

describe('isCounted is total over the lifecycle enum', () => {
  const lifecycles: Lifecycle[] = [
    'IDEA',
    'COMMITTED',
    'IN_DELIVERY',
    'ON_HOLD',
    'DONE',
    'DROPPED',
  ];

  it('returns a boolean for every lifecycle state', () => {
    for (const lifecycle of lifecycles) {
      const result = isCounted(
        footprint('f', 'c', 10),
        commitment('c', lifecycle),
        CURRENT_QUARTER,
      );
      expect(typeof result).toBe('boolean');
    }
  });
});
