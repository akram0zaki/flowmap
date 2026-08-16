/**
 * Capacity rules — docs/spec/04-rules-radar.md §4.1.
 *
 * These are the rules that read the vessel: how full it is, whether the work
 * inside it is actually placed, and whether a container has been shrunk without
 * anyone saying why. Overflow is permitted and explained, never blocked — so
 * `CAP_OVERFLOW` is a signal, not a refusal.
 */

import { compareQuarters, ordinalOf, utilisationPercent } from '@flowmap/domain';

import type { Rule, RuleFinding } from '../types.js';
import {
  commitments,
  countedFootprintsOf,
  footprintsOf,
  isLive,
  ref,
  summaryFor,
  teamName,
  teamQuarters,
} from '../helpers.js';

export const CAP_OVERFLOW: Rule = {
  code: 'CAP_OVERFLOW',
  category: 'CAPACITY',
  severity: 'HIGH',
  surfaces: ['RADAR', 'HEALTH', 'INLINE'],
  reads: ['capacity:*'],
  // Overflow is the product's central management fact. A workspace that could
  // switch it off would be a workspace that cannot see its own commitments.
  canDisable: false,
  materialFacts: ['teamId', 'quarterId', 'overflow'],
  evaluate: ({ state }) =>
    teamQuarters(state).flatMap((tq): RuleFinding[] => {
      const summary = summaryFor(state, tq);
      if (summary.overflow <= 0) return [];

      return [
        {
          entityRef: ref('TEAM_QUARTER', tq.id),
          discriminator: `${tq.teamId}:${tq.quarterId}`,
          facts: {
            team: teamName(state, tq.teamId),
            teamId: tq.teamId,
            quarterId: tq.quarterId,
            overflow: summary.overflow,
            committedLoad: summary.committedLoad,
            deliverableCapacity: summary.deliverableCapacity,
            utilisation: utilisationPercent(summary) ?? 0,
          },
          actions: [
            { kind: 'OPEN', ref: ref('TEAM_QUARTER', tq.id), labelKey: 'action.openTeamQuarter' },
          ],
        },
      ];
    }),
};

export const CAP_NEAR_LIMIT: Rule = {
  code: 'CAP_NEAR_LIMIT',
  category: 'CAPACITY',
  severity: 'MEDIUM',
  surfaces: ['RADAR', 'INLINE'],
  reads: ['capacity:*'],
  defaults: { utilisation: 0.95 },
  ranges: { utilisation: [0.5, 1] },
  canDisable: true,
  materialFacts: ['teamId', 'quarterId'],
  evaluate: ({ state, threshold }) =>
    teamQuarters(state).flatMap((tq): RuleFinding[] => {
      const summary = summaryFor(state, tq);
      if (summary.overflow > 0 || summary.deliverableCapacity === 0) return [];

      const ratio = summary.committedLoad / summary.deliverableCapacity;
      if (ratio < (threshold['utilisation'] ?? 0.95)) return [];

      return [
        {
          entityRef: ref('TEAM_QUARTER', tq.id),
          discriminator: `${tq.teamId}:${tq.quarterId}`,
          facts: {
            team: teamName(state, tq.teamId),
            teamId: tq.teamId,
            quarterId: tq.quarterId,
            utilisation: utilisationPercent(summary) ?? 0,
            headroom: summary.headroom,
          },
          actions: [
            { kind: 'OPEN', ref: ref('TEAM_QUARTER', tq.id), labelKey: 'action.openTeamQuarter' },
          ],
        },
      ];
    }),
};

export const CAP_NO_DELIVERABLE: Rule = {
  code: 'CAP_NO_DELIVERABLE',
  category: 'CAPACITY',
  severity: 'HIGH',
  surfaces: ['INLINE'],
  reads: ['capacity:*'],
  canDisable: false,
  materialFacts: ['teamId', 'quarterId'],
  evaluate: ({ state }) =>
    teamQuarters(state).flatMap((tq): RuleFinding[] => {
      const summary = summaryFor(state, tq);
      // Reserves have eaten the whole container while work is still placed in
      // it — every unit in there is over by definition.
      if (summary.deliverableCapacity !== 0 || summary.committedLoad === 0) return [];

      return [
        {
          entityRef: ref('TEAM_QUARTER', tq.id),
          discriminator: `${tq.teamId}:${tq.quarterId}`,
          facts: {
            team: teamName(state, tq.teamId),
            teamId: tq.teamId,
            quarterId: tq.quarterId,
            reserved: summary.reservedTotal,
            effectiveCapacity: summary.effectiveCapacity,
            committedLoad: summary.committedLoad,
          },
          actions: [
            { kind: 'OPEN', ref: ref('TEAM_QUARTER', tq.id), labelKey: 'action.reviewReserves' },
          ],
        },
      ];
    }),
};

export const CAP_PRIMARY_FOOTPRINT_MISSING: Rule = {
  code: 'CAP_PRIMARY_FOOTPRINT_MISSING',
  category: 'CAPACITY',
  severity: 'HIGH',
  surfaces: ['HEALTH', 'GATE'],
  reads: ['capacity:*', 'commitment:*'],
  canDisable: false,
  materialFacts: ['commitmentId', 'primaryTeamId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (!isLive(commitment) || !commitment.primaryTeamId) return [];

      const own = footprintsOf(state, commitment.id);
      const hasPrimary = own.some((f) => f.isPrimary && f.teamId === commitment.primaryTeamId);
      if (hasPrimary) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            primaryTeamId: commitment.primaryTeamId,
            primaryTeam: teamName(state, commitment.primaryTeamId),
            footprints: own.length,
          },
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetPrimaryFootprint',
              payload: { commitmentId: commitment.id, teamId: commitment.primaryTeamId },
              labelKey: 'action.setPrimaryFootprint',
            },
          ],
        },
      ];
    }),
};

export const CAP_NO_FOOTPRINT: Rule = {
  code: 'CAP_NO_FOOTPRINT',
  category: 'CAPACITY',
  severity: 'HIGH',
  surfaces: ['HEALTH'],
  reads: ['capacity:*', 'commitment:*'],
  canDisable: false,
  materialFacts: ['commitmentId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (!isLive(commitment)) return [];
      if (countedFootprintsOf(state, commitment).length > 0) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            lifecycle: commitment.lifecycle,
          },
          actions: [
            {
              kind: 'COMMAND',
              command: 'AssignCapacityFootprint',
              payload: { commitmentId: commitment.id },
              labelKey: 'action.assignFootprint',
            },
          ],
        },
      ];
    }),
};

export const CAP_SPAN_LONG: Rule = {
  code: 'CAP_SPAN_LONG',
  category: 'CAPACITY',
  severity: 'LOW',
  surfaces: ['INLINE'],
  reads: ['capacity:*', 'commitment:*'],
  defaults: { quarters: 3 },
  ranges: { quarters: [2, 12] },
  canDisable: true,
  materialFacts: ['commitmentId', 'span'],
  evaluate: ({ state, threshold }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      const own = countedFootprintsOf(state, commitment);
      if (own.length === 0) return [];

      const quarters = [...new Set(own.map((f) => f.quarterId))].sort(compareQuarters);
      const first = quarters[0]!;
      const last = quarters[quarters.length - 1]!;
      const span = ordinalOf(last) - ordinalOf(first) + 1;
      if (span <= (threshold['quarters'] ?? 3)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            span,
            from: first,
            to: last,
          },
          actions: [
            {
              kind: 'OPEN',
              ref: ref('COMMITMENT', commitment.id),
              labelKey: 'action.considerSplit',
            },
          ],
        },
      ];
    }),
};

export const CAP_ADJUSTMENT_UNEXPLAINED: Rule = {
  code: 'CAP_ADJUSTMENT_UNEXPLAINED',
  category: 'CAPACITY',
  severity: 'INFO',
  surfaces: ['INLINE'],
  reads: ['capacity:*'],
  canDisable: true,
  materialFacts: ['teamId', 'quarterId', 'adjustment'],
  evaluate: ({ state }) =>
    teamQuarters(state).flatMap((tq): RuleFinding[] => {
      // An overload with a visible symptom and no visible cause is the thing
      // this rule exists to prevent.
      if (tq.capacityAdjustment === 0 || tq.adjustmentNote) return [];

      return [
        {
          entityRef: ref('TEAM_QUARTER', tq.id),
          discriminator: `${tq.teamId}:${tq.quarterId}`,
          facts: {
            team: teamName(state, tq.teamId),
            teamId: tq.teamId,
            quarterId: tq.quarterId,
            adjustment: tq.capacityAdjustment,
          },
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetCapacityAdjustment',
              payload: { teamQuarterId: tq.id },
              labelKey: 'action.addAdjustmentNote',
            },
          ],
        },
      ];
    }),
};

export const CAPACITY_RULES: readonly Rule[] = [
  CAP_OVERFLOW,
  CAP_NEAR_LIMIT,
  CAP_NO_DELIVERABLE,
  CAP_PRIMARY_FOOTPRINT_MISSING,
  CAP_NO_FOOTPRINT,
  CAP_SPAN_LONG,
  CAP_ADJUSTMENT_UNEXPLAINED,
];
