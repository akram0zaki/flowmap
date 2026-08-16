/**
 * Lifecycle transitions and the Commit Gate.
 *
 * The transition table is data, not scattered `if` statements — every legal move
 * is in one place, and everything absent from it is rejected.
 *
 * Normative source: docs/spec/01-domain-model.md §5.2 and 05-scenarios-qbr.md §8.
 */

import type { Commitment, Lifecycle, WorkspaceRole } from './entities.js';

export type TransitionName =
  | 'PassCommitGate'
  | 'RevertCommitGate'
  | 'StartDelivery'
  | 'CorrectToCommitted'
  | 'HoldCommitment'
  | 'ResumeCommitment'
  | 'CompleteCommitment'
  | 'DropCommitment';

export type Transition = {
  readonly name: TransitionName;
  readonly from: readonly Lifecycle[];
  /** `PRIOR_ACTIVE` resolves to `priorActiveLifecycle` at execution time. */
  readonly to: Lifecycle | 'PRIOR_ACTIVE';
  readonly requires: WorkspaceRole;
};

export const TRANSITIONS: readonly Transition[] = [
  { name: 'PassCommitGate', from: ['IDEA'], to: 'COMMITTED', requires: 'PLANNER' },
  { name: 'RevertCommitGate', from: ['COMMITTED'], to: 'IDEA', requires: 'PLANNER' },
  { name: 'StartDelivery', from: ['COMMITTED'], to: 'IN_DELIVERY', requires: 'PLANNER' },
  { name: 'CorrectToCommitted', from: ['IN_DELIVERY'], to: 'COMMITTED', requires: 'PLANNER' },
  {
    name: 'HoldCommitment',
    from: ['COMMITTED', 'IN_DELIVERY'],
    to: 'ON_HOLD',
    requires: 'PLANNER',
  },
  { name: 'ResumeCommitment', from: ['ON_HOLD'], to: 'PRIOR_ACTIVE', requires: 'PLANNER' },
  { name: 'CompleteCommitment', from: ['IN_DELIVERY'], to: 'DONE', requires: 'PLANNER' },
  {
    name: 'DropCommitment',
    from: ['IDEA', 'COMMITTED', 'IN_DELIVERY', 'ON_HOLD'],
    to: 'DROPPED',
    requires: 'CONTRIBUTOR', // Planner in practice, except from IDEA — see §3.3.
  },
];

export const TERMINAL_LIFECYCLES: readonly Lifecycle[] = ['DONE', 'DROPPED'];

export function isTerminal(lifecycle: Lifecycle): boolean {
  return TERMINAL_LIFECYCLES.includes(lifecycle);
}

export function findTransition(name: TransitionName): Transition {
  const transition = TRANSITIONS.find((t) => t.name === name);
  if (!transition) throw new Error(`Unknown transition: ${name}`);
  return transition;
}

export function canTransition(name: TransitionName, from: Lifecycle): boolean {
  return findTransition(name).from.includes(from);
}

/**
 * Resolves the destination, following `PRIOR_ACTIVE` back to the state the
 * commitment was in before it was held.
 */
export function resolveTarget(transition: Transition, commitment: Commitment): Lifecycle {
  if (transition.to !== 'PRIOR_ACTIVE') return transition.to;
  // A hold always records where it came from; COMMITTED is the safe default if
  // an older row predates that field.
  return commitment.priorActiveLifecycle ?? 'COMMITTED';
}

/** Every legal (from, name) pair, for exhaustive testing. */
export function legalTransitions(): Array<{ from: Lifecycle; name: TransitionName }> {
  return TRANSITIONS.flatMap((t) => t.from.map((from) => ({ from, name: t.name })));
}

// ── Commit Gate readiness ──────────────────────────────────────────────────

export const GATE_BLOCKERS = [
  'COMMIT_GATE_PRIMARY_TEAM_REQUIRED',
  'COMMIT_GATE_FOOTPRINT_REQUIRED',
  'COMMIT_GATE_PRIMARY_FOOTPRINT_MISMATCH',
  'MANDATORY_TARGET_DATE_REQUIRED',
] as const;

export type GateBlocker = (typeof GATE_BLOCKERS)[number];

/**
 * Advisory readiness gaps. These never block — a Planner may commit past all of
 * them, and the checklist exists so the decision is informed, not prevented.
 * See docs/spec/03-commands-permissions.md §6.2.
 */
export const GATE_ADVISORIES = [
  'RDY_NO_OWNER',
  'RDY_NO_TARGET',
  'RDY_NO_OUTCOME',
  'RDY_NO_PRODUCT_IMPACT',
  'RDY_NO_DEPENDENCIES_REVIEWED',
  'RDY_LOW_CONFIDENCE_LARGE',
  'RDY_SPANS_MANY_QUARTERS',
] as const;

export type GateAdvisory = (typeof GATE_ADVISORIES)[number];

export type GateReadiness = {
  readonly blockers: readonly GateBlocker[];
  readonly advisories: readonly GateAdvisory[];
  readonly ready: boolean;
};
