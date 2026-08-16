/**
 * Product rules — docs/spec/04-rules-radar.md §4.6.
 *
 * These answer "where does the change land", which is the question the map
 * cannot answer: the map is organised by who does the work, and a product can
 * be hit by five teams at once without any one of them looking busy.
 */

import type { Commitment, QuarterId, WorkspaceState } from '@flowmap/domain';

import { allChangeLoads } from '../change-load.js';
import type { Rule, RuleFinding } from '../types.js';
import { impacts, isLive, products, ref } from '../helpers.js';

export const PRD_CHANGE_LOAD_HIGH: Rule = {
  code: 'PRD_CHANGE_LOAD_HIGH',
  category: 'PRODUCT',
  severity: 'MEDIUM',
  surfaces: ['RADAR', 'INLINE'],
  reads: ['changeLoad:*', 'commitment:*', 'capacity:*'],
  canDisable: true,
  materialFacts: ['productServiceId', 'quarterId', 'level'],
  evaluate: ({ state }) =>
    allChangeLoads(state).flatMap((load): RuleFinding[] => {
      if (load.level !== 'HIGH') return [];

      return [
        {
          entityRef: ref('PRODUCT_SERVICE', load.productServiceId),
          discriminator: load.quarterId,
          facts: {
            productServiceId: load.productServiceId,
            product: load.product,
            quarterId: load.quarterId,
            level: load.level,
            score: load.score,
            threshold: load.thresholds.high,
            contributors: load.contributors.length,
            // The largest single contributor, so the row says what is driving it
            // rather than only that something is.
            topContributor: load.contributors[0]?.commitment ?? '',
          },
          actions: [
            {
              kind: 'OPEN',
              ref: ref('PRODUCT_SERVICE', load.productServiceId),
              labelKey: 'action.openProduct',
            },
          ],
        },
      ];
    }),
};

/** Impacts that mean the product is genuinely being changed, not merely touched. */
const HEAVY = new Set(['PRIMARY', 'MAJOR']);

export const PRD_CONCENTRATION: Rule = {
  code: 'PRD_CONCENTRATION',
  category: 'PRODUCT',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['changeLoad:*', 'commitment:*'],
  defaults: { impacts: 4 },
  ranges: { impacts: [2, 50] },
  canDisable: true,
  materialFacts: ['productServiceId', 'quarterId', 'count'],
  evaluate: ({ state, threshold }) =>
    groupByProductQuarter(state, (commitment) => isLive(commitment)).flatMap(
      ([productServiceId, quarterId, rows]): RuleFinding[] => {
        const heavy = rows.filter((row) => HEAVY.has(row.type));
        if (heavy.length < (threshold['impacts'] ?? 4)) return [];

        return [
          {
            entityRef: ref('PRODUCT_SERVICE', productServiceId),
            discriminator: quarterId,
            facts: {
              productServiceId,
              product: state.products?.get(productServiceId)?.name ?? productServiceId,
              quarterId,
              count: heavy.length,
            },
            actions: [
              {
                kind: 'OPEN',
                ref: ref('PRODUCT_SERVICE', productServiceId),
                labelKey: 'action.openProduct',
              },
            ],
          },
        ];
      },
    ),
};

export const PRD_MANDATORY_STACK: Rule = {
  code: 'PRD_MANDATORY_STACK',
  category: 'PRODUCT',
  severity: 'HIGH',
  surfaces: ['RADAR'],
  reads: ['changeLoad:*', 'commitment:*'],
  defaults: { count: 2 },
  ranges: { count: [2, 20] },
  canDisable: false,
  materialFacts: ['productServiceId', 'quarterId', 'count'],
  evaluate: ({ state, threshold }) =>
    groupByProductQuarter(
      state,
      (commitment) => isLive(commitment) && commitment.class === 'MANDATORY',
    ).flatMap(([productServiceId, quarterId, rows]): RuleFinding[] => {
      if (rows.length < (threshold['count'] ?? 2)) return [];

      return [
        {
          entityRef: ref('PRODUCT_SERVICE', productServiceId),
          discriminator: quarterId,
          facts: {
            productServiceId,
            product: state.products?.get(productServiceId)?.name ?? productServiceId,
            quarterId,
            count: rows.length,
            // Mandatory work cannot be moved, so naming it is the whole value.
            commitments: rows
              .map((row) => row.commitment)
              .sort()
              .join(', '),
          },
          actions: [
            {
              kind: 'OPEN',
              ref: ref('PRODUCT_SERVICE', productServiceId),
              labelKey: 'action.openProduct',
            },
          ],
        },
      ];
    }),
};

export const PRD_NO_OWNER: Rule = {
  code: 'PRD_NO_OWNER',
  category: 'PRODUCT',
  severity: 'LOW',
  surfaces: ['INLINE'],
  reads: ['changeLoad:*'],
  canDisable: true,
  materialFacts: ['productServiceId'],
  evaluate: ({ state }) => {
    const loaded = new Map(
      allChangeLoads(state)
        .filter((load) => load.level !== 'LOW')
        .map((load) => [load.productServiceId, load]),
    );

    return products(state).flatMap((product): RuleFinding[] => {
      if (product.ownerRef) return [];
      const load = loaded.get(product.id);
      if (!load) return [];

      return [
        {
          entityRef: ref('PRODUCT_SERVICE', product.id),
          facts: {
            productServiceId: product.id,
            product: product.name,
            level: load.level,
            quarterId: load.quarterId,
          },
          actions: [
            {
              kind: 'COMMAND',
              command: 'RenameProductService',
              payload: { productServiceId: product.id },
              labelKey: 'action.setProductOwner',
            },
          ],
        },
      ];
    });
  },
};

/**
 * Impacts grouped by the product and quarter they land in.
 *
 * Quarter comes from where the work is actually placed, falling back to its
 * target quarter — the same rule change load uses, so the two never disagree
 * about which quarter a commitment belongs to.
 */
function groupByProductQuarter(
  state: WorkspaceState,
  include: (commitment: Commitment) => boolean,
): Array<[string, QuarterId, Array<{ type: string; commitment: string }>]> {
  const grouped = new Map<string, Array<{ type: string; commitment: string }>>();

  for (const impact of impacts(state)) {
    const commitment = state.commitments.get(impact.commitmentId);
    if (!commitment || !include(commitment)) continue;

    const quarters = new Set<QuarterId>();
    for (const footprint of state.footprints.values()) {
      if (footprint.commitmentId !== commitment.id || footprint.archivedAt !== undefined) continue;
      quarters.add(footprint.quarterId);
    }
    if (quarters.size === 0 && commitment.targetQuarterId) quarters.add(commitment.targetQuarterId);

    for (const quarterId of quarters) {
      const key = `${impact.productServiceId}|${quarterId}`;
      grouped.set(key, [
        ...(grouped.get(key) ?? []),
        { type: impact.type, commitment: commitment.name },
      ]);
    }
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, rows]) => {
      const [productServiceId, quarterId] = key.split('|') as [string, QuarterId];
      return [productServiceId, quarterId, rows];
    });
}

export const PRODUCT_RULES: readonly Rule[] = [
  PRD_CHANGE_LOAD_HIGH,
  PRD_CONCENTRATION,
  PRD_MANDATORY_STACK,
  PRD_NO_OWNER,
];
