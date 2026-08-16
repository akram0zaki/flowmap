/**
 * Timing rules — docs/spec/04-rules-radar.md §4.3.
 *
 * Every comparison here is a calendar-date comparison in the workspace
 * timezone. `today` arrives already resolved, so no rule in this file can
 * accidentally compare an instant against a date and be a day out near midnight.
 */

import { compareQuarters } from '@flowmap/domain';

import type { Rule, RuleFinding } from '../types.js';
import {
  commitments,
  countedFootprintsOf,
  daysBetween,
  dateOf,
  isTerminal,
  lastTouched,
  milestones,
  ref,
} from '../helpers.js';

const openCommitment = (id: string) =>
  ({ kind: 'OPEN', ref: ref('COMMITMENT', id), labelKey: 'action.openCommitment' }) as const;

export const ATT_DATE_REACHED: Rule = {
  code: 'ATT_DATE_REACHED',
  category: 'TIMING',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  canDisable: true,
  materialFacts: ['commitmentId', 'attentionDate'],
  evaluate: ({ state, today }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (isTerminal(commitment) || !commitment.attentionDate) return [];
      if (commitment.attentionDate > today) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            attentionDate: commitment.attentionDate,
            lifecycle: commitment.lifecycle,
          },
          dueOn: commitment.attentionDate,
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const ACT_OVERDUE: Rule = {
  code: 'ACT_OVERDUE',
  category: 'TIMING',
  severity: 'HIGH',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  canDisable: false,
  materialFacts: ['commitmentId', 'nextActionDueDate', 'nextAction'],
  evaluate: ({ state, today }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (isTerminal(commitment) || !commitment.nextActionDueDate) return [];
      if (commitment.nextActionDueDate >= today) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            nextAction: commitment.nextAction ?? '',
            nextActionDueDate: commitment.nextActionDueDate,
            daysOverdue: daysBetween(commitment.nextActionDueDate, today),
          },
          dueOn: commitment.nextActionDueDate,
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const ACT_DUE_SOON: Rule = {
  code: 'ACT_DUE_SOON',
  category: 'TIMING',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  defaults: { days: 7 },
  ranges: { days: [1, 60] },
  canDisable: true,
  materialFacts: ['commitmentId', 'nextActionDueDate', 'nextAction'],
  evaluate: ({ state, today, threshold }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (isTerminal(commitment) || !commitment.nextActionDueDate) return [];

      const days = daysBetween(today, commitment.nextActionDueDate);
      if (days < 0 || days > (threshold['days'] ?? 7)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            nextAction: commitment.nextAction ?? '',
            nextActionDueDate: commitment.nextActionDueDate,
            daysUntil: days,
          },
          dueOn: commitment.nextActionDueDate,
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const ACT_MISSING: Rule = {
  code: 'ACT_MISSING',
  category: 'TIMING',
  severity: 'LOW',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  defaults: { days: 14 },
  ranges: { days: [1, 120] },
  canDisable: true,
  materialFacts: ['commitmentId'],
  evaluate: ({ state, today, threshold }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (commitment.lifecycle !== 'IN_DELIVERY' || commitment.nextAction) return [];

      const touched = dateOf(lastTouched(commitment));
      if (!touched) return [];
      const age = daysBetween(touched, today);
      if (age <= (threshold['days'] ?? 14)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            lastUpdated: touched,
            days: age,
          },
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetNextAction',
              payload: { commitmentId: commitment.id },
              labelKey: 'action.setNextAction',
            },
          ],
        },
      ];
    }),
};

export const TGT_MISSED: Rule = {
  code: 'TGT_MISSED',
  category: 'TIMING',
  severity: 'HIGH',
  surfaces: ['RADAR', 'HEALTH'],
  reads: ['commitment:*'],
  canDisable: false,
  materialFacts: ['commitmentId', 'targetDate'],
  evaluate: ({ state, today }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (isTerminal(commitment) || !commitment.targetDate) return [];
      if (commitment.targetDate >= today) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            targetDate: commitment.targetDate,
            lifecycle: commitment.lifecycle,
            daysOverdue: daysBetween(commitment.targetDate, today),
          },
          dueOn: commitment.targetDate,
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const TGT_APPROACHING: Rule = {
  code: 'TGT_APPROACHING',
  category: 'TIMING',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  defaults: { days: 30 },
  ranges: { days: [1, 180] },
  canDisable: true,
  materialFacts: ['commitmentId', 'targetDate'],
  evaluate: ({ state, today, threshold }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (commitment.lifecycle === 'DONE' || !commitment.targetDate) return [];

      const days = daysBetween(today, commitment.targetDate);
      if (days < 0 || days > (threshold['days'] ?? 30)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            targetDate: commitment.targetDate,
            daysUntil: days,
          },
          dueOn: commitment.targetDate,
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const TGT_QUARTER_OVERRUN: Rule = {
  code: 'TGT_QUARTER_OVERRUN',
  category: 'TIMING',
  severity: 'MEDIUM',
  surfaces: ['HEALTH', 'INLINE'],
  reads: ['commitment:*', 'capacity:*'],
  canDisable: true,
  materialFacts: ['commitmentId', 'targetQuarterId', 'latestQuarterId'],
  evaluate: ({ state }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (isTerminal(commitment) || !commitment.targetQuarterId) return [];

      const own = countedFootprintsOf(state, commitment);
      if (own.length === 0) return [];

      const latest = own
        .map((f) => f.quarterId)
        .sort(compareQuarters)
        .at(-1)!;
      if (compareQuarters(latest, commitment.targetQuarterId) <= 0) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            targetQuarterId: commitment.targetQuarterId,
            latestQuarterId: latest,
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

/** Not started means the work has not begun: an Idea, or committed but not in delivery. */
const NOT_STARTED: ReadonlySet<string> = new Set(['IDEA', 'COMMITTED']);

export const LSS_PASSED: Rule = {
  code: 'LSS_PASSED',
  category: 'TIMING',
  severity: 'HIGH',
  surfaces: ['RADAR', 'HEALTH'],
  reads: ['commitment:*'],
  canDisable: false,
  materialFacts: ['commitmentId', 'latestSafeStart', 'lifecycle'],
  evaluate: ({ state, today }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (!commitment.latestSafeStart || !NOT_STARTED.has(commitment.lifecycle)) return [];
      if (commitment.latestSafeStart >= today) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            latestSafeStart: commitment.latestSafeStart,
            lifecycle: commitment.lifecycle,
            daysOverdue: daysBetween(commitment.latestSafeStart, today),
          },
          dueOn: commitment.latestSafeStart,
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const LSS_APPROACHING: Rule = {
  code: 'LSS_APPROACHING',
  category: 'TIMING',
  severity: 'MEDIUM',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  defaults: { days: 14 },
  ranges: { days: [1, 120] },
  canDisable: true,
  materialFacts: ['commitmentId', 'latestSafeStart', 'lifecycle'],
  evaluate: ({ state, today, threshold }) =>
    commitments(state).flatMap((commitment): RuleFinding[] => {
      if (!commitment.latestSafeStart || !NOT_STARTED.has(commitment.lifecycle)) return [];

      const days = daysBetween(today, commitment.latestSafeStart);
      if (days < 0 || days > (threshold['days'] ?? 14)) return [];

      return [
        {
          entityRef: ref('COMMITMENT', commitment.id),
          facts: {
            commitment: commitment.name,
            commitmentId: commitment.id,
            latestSafeStart: commitment.latestSafeStart,
            lifecycle: commitment.lifecycle,
            daysUntil: days,
          },
          dueOn: commitment.latestSafeStart,
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const MS_OVERDUE: Rule = {
  code: 'MS_OVERDUE',
  category: 'TIMING',
  severity: 'HIGH',
  surfaces: ['RADAR', 'HEALTH'],
  reads: ['commitment:*'],
  canDisable: false,
  materialFacts: ['milestoneId', 'targetDate', 'status'],
  evaluate: ({ state, today }) =>
    milestones(state).flatMap((milestone): RuleFinding[] => {
      if (milestone.status !== 'PLANNED' || !milestone.targetDate) return [];
      if (milestone.targetDate >= today) return [];

      const commitment = state.commitments.get(milestone.commitmentId);
      if (!commitment || isTerminal(commitment)) return [];

      return [
        {
          entityRef: ref('MILESTONE', milestone.id),
          facts: {
            milestoneId: milestone.id,
            milestone: milestone.name,
            commitment: commitment.name,
            commitmentId: commitment.id,
            targetDate: milestone.targetDate,
            status: milestone.status,
            daysOverdue: daysBetween(milestone.targetDate, today),
          },
          dueOn: milestone.targetDate,
          actions: [
            {
              kind: 'COMMAND',
              command: 'SetMilestoneStatus',
              payload: { milestoneId: milestone.id },
              labelKey: 'action.setMilestoneStatus',
            },
          ],
        },
      ];
    }),
};

export const MS_DUE_SOON: Rule = {
  code: 'MS_DUE_SOON',
  category: 'TIMING',
  severity: 'LOW',
  surfaces: ['RADAR'],
  reads: ['commitment:*'],
  defaults: { days: 14 },
  ranges: { days: [1, 90] },
  canDisable: true,
  materialFacts: ['milestoneId', 'targetDate', 'status'],
  evaluate: ({ state, today, threshold }) =>
    milestones(state).flatMap((milestone): RuleFinding[] => {
      if (milestone.status !== 'PLANNED' || !milestone.targetDate) return [];

      const days = daysBetween(today, milestone.targetDate);
      if (days < 0 || days > (threshold['days'] ?? 14)) return [];

      const commitment = state.commitments.get(milestone.commitmentId);
      if (!commitment || isTerminal(commitment)) return [];

      return [
        {
          entityRef: ref('MILESTONE', milestone.id),
          facts: {
            milestoneId: milestone.id,
            milestone: milestone.name,
            commitment: commitment.name,
            commitmentId: commitment.id,
            targetDate: milestone.targetDate,
            status: milestone.status,
            daysUntil: days,
          },
          dueOn: milestone.targetDate,
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const MS_MISSED_FLAGGED: Rule = {
  code: 'MS_MISSED_FLAGGED',
  category: 'TIMING',
  severity: 'MEDIUM',
  surfaces: ['HEALTH'],
  reads: ['commitment:*'],
  canDisable: false,
  materialFacts: ['milestoneId', 'status'],
  evaluate: ({ state }) =>
    milestones(state).flatMap((milestone): RuleFinding[] => {
      // MISSED is set by a human, never derived — so this reports a judgement
      // someone made, not a date that passed.
      if (milestone.status !== 'MISSED') return [];

      const commitment = state.commitments.get(milestone.commitmentId);
      if (!commitment || isTerminal(commitment)) return [];

      return [
        {
          entityRef: ref('MILESTONE', milestone.id),
          facts: {
            milestoneId: milestone.id,
            milestone: milestone.name,
            commitment: commitment.name,
            commitmentId: commitment.id,
            status: milestone.status,
            ...(milestone.targetDate ? { targetDate: milestone.targetDate } : {}),
          },
          actions: [openCommitment(commitment.id)],
        },
      ];
    }),
};

export const TIMING_RULES: readonly Rule[] = [
  ATT_DATE_REACHED,
  ACT_OVERDUE,
  ACT_DUE_SOON,
  ACT_MISSING,
  TGT_MISSED,
  TGT_APPROACHING,
  TGT_QUARTER_OVERRUN,
  LSS_PASSED,
  LSS_APPROACHING,
  MS_OVERDUE,
  MS_DUE_SOON,
  MS_MISSED_FLAGGED,
];
