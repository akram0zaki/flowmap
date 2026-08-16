/**
 * Readiness, governance and ownership rules — docs/spec/04-rules-radar.md §4.4.
 *
 * The readiness rules are what the Commit Gate reads. Most of them surface only
 * at `GATE`, because an Idea that is not yet worked up is not a problem — it is
 * an Idea. They become questions at the moment someone proposes committing.
 */

import { holdReserveLabel } from '@flowmap/domain';

import type { Rule, RuleFinding } from '../types.js';
import {
  commitments,
  daysBetween,
  dateOf,
  dependencies,
  footprintsOf,
  impacts,
  isLive,
  isTerminal,
  ref,
  teamQuarters,
  unitsOf,
} from '../helpers.js';

const openCommitment = (id: string) =>
  ({ kind: 'OPEN', ref: ref('COMMITMENT', id), labelKey: 'action.openCommitment' }) as const;

export const RDY_NO_PRIMARY_TEAM: Rule = {
  code: 'RDY_NO_PRIMARY_TEAM',
  category: 'READINESS',
  severity: 'MEDIUM',
  surfaces: ['GATE'],
  reads: ['commitment:*', 'capacity:*'],
  canDisable: false,
  materialFacts: ['commitmentId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (commitment.lifecycle !== 'IDEA' || commitment.primaryTeamId) return [];
      if (footprintsOf(state, commitment.id).length === 0) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: { commitment: commitment.name, commitmentId: commitment.id },
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const RDY_NO_FOOTPRINT: Rule = {
  code: 'RDY_NO_FOOTPRINT',
  category: 'READINESS',
  severity: 'LOW',
  surfaces: ['GATE'],
  reads: ['commitment:*', 'capacity:*'],
  canDisable: true,
  materialFacts: ['commitmentId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (commitment.lifecycle !== 'IDEA' || !commitment.targetQuarterId) return [];
      if (footprintsOf(state, commitment.id).length > 0) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            targetQuarterId: commitment.targetQuarterId,
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const RDY_NO_OUTCOME: Rule = {
  code: 'RDY_NO_OUTCOME',
  category: 'READINESS',
  severity: 'INFO',
  surfaces: ['GATE'],
  reads: ['commitment:*'],
  canDisable: true,
  materialFacts: ['commitmentId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] =>
      commitment.lifecycle !== 'IDEA' || commitment.outcome
        ? []
        : [
            {
              entityRef: ref('COMMITMENT', commitment.id),
              facts: { commitment: commitment.name, commitmentId: commitment.id },
              actions: [openCommitment(commitment.id)],
            },
          ],
    ),
};

export const RDY_NO_PRODUCT_IMPACT: Rule = {
  code: 'RDY_NO_PRODUCT_IMPACT',
  category: 'READINESS',
  severity: 'LOW',
  surfaces: ['GATE', 'INLINE'],
  reads: ['commitment:*', 'changeLoad:*'],
  canDisable: true,
  materialFacts: ['commitmentId'],
  evaluate: ({ state }) => {
    const withImpact = new Set(impacts(state).map((i) => i.commitmentId));

    return commitments(state).flatMap((commitment): RuleFinding[] => {
      if (isTerminal(commitment) || withImpact.has(commitment.id)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            lifecycle: commitment.lifecycle,
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    });
  },
};

export const RDY_NO_DEPENDENCIES_REVIEWED: Rule = {
  code: 'RDY_NO_DEPENDENCIES_REVIEWED',
  category: 'READINESS',
  severity: 'INFO',
  surfaces: ['GATE'],
  reads: ['commitment:*', 'dependencyGraph'],
  canDisable: true,
  materialFacts: ['commitmentId'],
  evaluate: ({ state }) => {
    const withDependencies = new Set(dependencies(state).map((d) => d.sourceCommitmentId));

    return commitments(state).flatMap((commitment): RuleFinding[] => {
      if (commitment.lifecycle !== 'IDEA' || withDependencies.has(commitment.id)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: { commitment: commitment.name, commitmentId: commitment.id },
          actions: [openCommitment(commitment.id)],
        },
      ];
    });
  },
};

export const RDY_LOW_CONFIDENCE_LARGE: Rule = {
  code: 'RDY_LOW_CONFIDENCE_LARGE',
  category: 'READINESS',
  severity: 'MEDIUM',
  surfaces: ['GATE', 'HEALTH'],
  reads: ['commitment:*', 'capacity:*'],
  // The default is the workspace's own L band, resolved at evaluation.
  defaults: { units: 35 },
  ranges: { units: [1, 500] },
  canDisable: true,
  materialFacts: ['commitmentId', 'sizeConfidence'],
  evaluate: ({ state, threshold }) => {
    const large = state.workspace.settings.capacity.sizeMapping.L ?? threshold['units'] ?? 35;

    return commitments(state).flatMap((commitment): RuleFinding[] => {
      if (!isLive(commitment) || commitment.sizeConfidence !== 'LOW') return [];

      const units = unitsOf(state, commitment);
      if (units < large) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            units,
            sizeConfidence: commitment.sizeConfidence,
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    });
  },
};

export const RDY_IDEA_UNREFINED: Rule = {
  code: 'RDY_IDEA_UNREFINED',
  category: 'READINESS',
  severity: 'LOW',
  surfaces: ['RADAR'],
  reads: ['commitment:*', 'capacity:*'],
  defaults: { days: 60 },
  ranges: { days: [7, 365] },
  canDisable: true,
  materialFacts: ['commitmentId'],
  evaluate: ({ state, today, threshold }) => {
    const linked = new Set<string>();
    for (const tq of teamQuarters(state)) {
      for (const reserve of tq.reserves) {
        for (const ideaId of reserve.linkedIdeaIds ?? []) linked.add(ideaId);
      }
    }

    return commitments(state).flatMap((commitment): RuleFinding[] => {
      if (commitment.lifecycle !== 'IDEA') return [];
      if (linked.has(commitment.id) || footprintsOf(state, commitment.id).length > 0) return [];

      const created = dateOf(commitment.createdAt);
      if (!created) return [];
      const age = daysBetween(created, today);
      if (age <= (threshold['days'] ?? 60)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            days: age,
            createdOn: created,
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    });
  },
};

export const RDY_MANDATORY_NO_TARGET: Rule = {
  code: 'RDY_MANDATORY_NO_TARGET',
  category: 'READINESS',
  severity: 'HIGH',
  surfaces: ['GATE', 'RADAR'],
  reads: ['commitment:*'],
  canDisable: false,
  materialFacts: ['commitmentId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] =>
      commitment.class !== 'MANDATORY' || commitment.targetDate || isTerminal(commitment)
        ? []
        : [
            {
              entityRef: ref('COMMITMENT', commitment.id),
              facts: {
                commitment: commitment.name,
                commitmentId: commitment.id,
                lifecycle: commitment.lifecycle,
              },
              actions: [openCommitment(commitment.id)],
            },
          ],
    ),
};

/**
 * Ownership is demanded at the point it matters — commitment — never at capture.
 *
 * Quick Capture has to stay frictionless, so this deliberately does not fire on
 * a newly captured Idea. That is a product decision with a test to prove it.
 */
export const OWN_MISSING: Rule = {
  code: 'OWN_MISSING',
  category: 'OWNERSHIP',
  severity: 'HIGH',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  canDisable: false,
  materialFacts: ['commitmentId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] =>
      !isLive(commitment) || commitment.ownerRef
        ? []
        : [
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
                  command: 'SetOwner',
                  payload: { commitmentId: commitment.id },
                  labelKey: 'action.setOwner',
                },
              ],
            },
          ],
    ),
};

export const OWN_TEAM_ONLY_ACTION_DUE: Rule = {
  code: 'OWN_TEAM_ONLY_ACTION_DUE',
  category: 'OWNERSHIP',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  defaults: { days: 7 },
  ranges: { days: [1, 60] },
  canDisable: true,
  materialFacts: ['commitmentId', 'nextActionDueDate'],
  evaluate: ({ state, today, threshold }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (isTerminal(commitment) || !commitment.nextActionDueDate) return [];

      // A team cannot be nudged; a person can. That is the whole point.
      const owner = commitment.nextActionOwnerRef ?? commitment.ownerRef;
      if (!owner || owner.kind !== 'TEAM') return [];

      const days = daysBetween(today, commitment.nextActionDueDate);
      if (days < 0 || days > (threshold['days'] ?? 7)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            nextActionDueDate: commitment.nextActionDueDate,
            teamId: owner.teamId,
            daysUntil: days,
          },
          dueOn: commitment.nextActionDueDate,
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetNextAction',
              payload: { commitmentId: commitment.id },
              labelKey: 'action.setActionOwner',
            },
          ],
        },
      ];
    }),
};

export const OWN_DEPENDENCY_MISSING: Rule = {
  code: 'OWN_DEPENDENCY_MISSING',
  category: 'OWNERSHIP',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['dependencyGraph'],
  canDisable: true,
  materialFacts: ['dependencyId', 'neededBy'],
  evaluate: ({ state }) =>
    dependencies(state).flatMap((dependency): RuleFinding[] => {
      if (!dependency.neededBy || dependency.ownerRef) return [];
      if (dependency.status === 'RESOLVED') return [];

      return [
        {
          entityRef: ref('DEPENDENCY', dependency.id),
          facts: {
            dependencyId: dependency.id,
            neededBy: dependency.neededBy,
            type: dependency.type,
          },
          dueOn: dependency.neededBy,
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetDependencyOwner',
              payload: { dependencyId: dependency.id },
              labelKey: 'action.setDependencyOwner',
            },
          ],
        },
      ];
    }),
};

export const OWN_ARCHIVED: Rule = {
  code: 'OWN_ARCHIVED',
  category: 'OWNERSHIP',
  severity: 'LOW',
  surfaces: ['INLINE'],
  reads: ['commitment:*'],
  canDisable: true,
  materialFacts: ['commitmentId', 'personId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      const owner = commitment.ownerRef;
      if (owner?.kind !== 'PERSON' || isTerminal(commitment)) return [];

      const person = state.people?.get(owner.personId);
      // Absent entirely is a dangling reference, which INT_DANGLING_REF owns.
      if (!person || person.archivedAt === undefined) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            personId: owner.personId,
            person: person.displayName,
          },
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetOwner',
              payload: { commitmentId: commitment.id },
              labelKey: 'action.setOwner',
            },
          ],
        },
      ];
    }),
};

// ── Health (§4.5) ──────────────────────────────────────────────────────────

function staleness(
  code: 'HLT_STALE_DELIVERY' | 'HLT_STALE_COMMITTED',
  lifecycle: 'IN_DELIVERY' | 'COMMITTED',
  severity: 'MEDIUM' | 'LOW',
  surfaces: readonly ('RADAR' | 'HEALTH')[],
  days: number,
): Rule {
  return {
    code,
    category: 'HEALTH',
    severity,
    surfaces,
    reads: ['commitment:*'],
    defaults: { days },
    ranges: { days: [1, 365] },
    canDisable: true,
    materialFacts: ['commitmentId'],
    evaluate: ({ state, today, threshold }) =>
      commitments(state).flatMap((commitment): RuleFinding[] => {
        if (commitment.lifecycle !== lifecycle) return [];

        // The later of a meaningful change and an explicit review, so "reviewed —
        // no change" genuinely resets the clock.
        const touched = dateOf(
          commitment.lastMeaningfulUpdateAt && commitment.lastReviewedAt
            ? commitment.lastMeaningfulUpdateAt > commitment.lastReviewedAt
              ? commitment.lastMeaningfulUpdateAt
              : commitment.lastReviewedAt
            : (commitment.lastMeaningfulUpdateAt ??
                commitment.lastReviewedAt ??
                commitment.updatedAt),
        );
        if (!touched) return [];

        const age = daysBetween(touched, today);
        if (age <= (threshold['days'] ?? days)) return [];

        return [
          {
            entityRef: ref('COMMITMENT', commitment.id),
            facts: {
              commitment: commitment.name,
              commitmentId: commitment.id,
              lastUpdated: touched,
              days: age,
              lifecycle: commitment.lifecycle,
            },
            actions: [openCommitment(commitment.id)],
          },
        ];
      }),
  };
}

export const HLT_STALE_DELIVERY = staleness(
  'HLT_STALE_DELIVERY',
  'IN_DELIVERY',
  'MEDIUM',
  ['RADAR', 'HEALTH'],
  21,
);

export const HLT_STALE_COMMITTED = staleness(
  'HLT_STALE_COMMITTED',
  'COMMITTED',
  'LOW',
  ['RADAR'],
  45,
);

export const HLT_STALE_HELD: Rule = {
  code: 'HLT_STALE_HELD',
  category: 'HEALTH',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['commitment:*', 'capacity:*'],
  defaults: { days: 60 },
  ranges: { days: [1, 365] },
  canDisable: true,
  materialFacts: ['commitmentId'],
  evaluate: ({ state, today, threshold }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (commitment.lifecycle !== 'ON_HOLD') return [];

      // "Capacity preserved" is a HOLD reserve, not a footprint: holding work
      // converts its load into a labelled reserve and stops counting the
      // footprints (spec 02 §7). Looking for counted footprints here found
      // nothing, always — a rule that could never fire.
      const label = holdReserveLabel(commitment.name);
      const held = teamQuarters(state).flatMap((tq) =>
        tq.reserves.filter((reserve) => reserve.type === 'HOLD' && reserve.label === label),
      );
      // A hold that released its capacity is a decision, not a leak.
      if (held.length === 0) return [];

      const since = dateOf(commitment.updatedAt);
      if (!since) return [];
      const age = daysBetween(since, today);
      if (age <= (threshold['days'] ?? 60)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            days: age,
            units: held.reduce((sum, reserve) => sum + reserve.amount, 0),
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

/**
 * Work whose target quarter keeps sliding.
 *
 * The count comes from the event log via `ctx.history`, not from the entity: a
 * snapshot knows where the target is, never how many times it moved. When the
 * caller has not computed it the rule stays silent rather than reporting zero,
 * because "no history loaded" and "never moved" are different answers.
 */
export const HLT_MOVED_REPEATEDLY: Rule = {
  code: 'HLT_MOVED_REPEATEDLY',
  category: 'HEALTH',
  severity: 'MEDIUM',
  surfaces: ['HEALTH'],
  reads: ['commitment:*'],
  defaults: { moves: 2 },
  ranges: { moves: [1, 20] },
  canDisable: true,
  materialFacts: ['commitmentId', 'moves'],
  evaluate: ({ state, ctx, threshold }) => {
    const moves = ctx.history?.quarterMovedLater;
    if (!moves) return [];

    return commitments(state).flatMap((commitment): RuleFinding[] => {
      if (isTerminal(commitment)) return [];

      const count = moves.get(commitment.id) ?? 0;
      if (count < (threshold['moves'] ?? 2)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            moves: count,
            ...(commitment.targetQuarterId ? { targetQuarterId: commitment.targetQuarterId } : {}),
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    });
  },
};

export const HLT_GROWN: Rule = {
  code: 'HLT_GROWN',
  category: 'HEALTH',
  severity: 'MEDIUM',
  surfaces: ['HEALTH'],
  reads: ['commitment:*', 'capacity:*'],
  defaults: { percent: 50 },
  ranges: { percent: [5, 500] },
  canDisable: true,
  materialFacts: ['commitmentId', 'unitsAtCommit'],
  evaluate: ({ state, threshold }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      const at = commitment.unitsAtCommit;
      if (!isLive(commitment) || at === undefined || at <= 0) return [];

      const now = unitsOf(state, commitment);
      const growth = ((now - at) / at) * 100;
      if (growth < (threshold['percent'] ?? 50)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            unitsAtCommit: at,
            units: now,
            percent: Math.round(growth),
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const READINESS_RULES: readonly Rule[] = [
  RDY_NO_PRIMARY_TEAM,
  RDY_NO_FOOTPRINT,
  RDY_NO_OUTCOME,
  RDY_NO_PRODUCT_IMPACT,
  RDY_NO_DEPENDENCIES_REVIEWED,
  RDY_LOW_CONFIDENCE_LARGE,
  RDY_IDEA_UNREFINED,
  RDY_MANDATORY_NO_TARGET,
  OWN_MISSING,
  OWN_TEAM_ONLY_ACTION_DUE,
  OWN_DEPENDENCY_MISSING,
  OWN_ARCHIVED,
];

export const HEALTH_RULES: readonly Rule[] = [
  HLT_STALE_DELIVERY,
  HLT_STALE_COMMITTED,
  HLT_STALE_HELD,
  HLT_MOVED_REPEATEDLY,
  HLT_GROWN,
];
