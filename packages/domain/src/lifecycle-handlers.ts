/**
 * Lifecycle command handlers, including the Commit Gate.
 *
 * Crossing the gate means the organisation is accepting capacity consumption
 * into the baseline. It is not an approval workflow: there is no routing, no
 * sign-off, and no queue — only a small set of integrity checks that block, and
 * a checklist that informs.
 *
 * See docs/spec/05-scenarios-qbr.md §8.
 */

import type { CapacityFootprint, Commitment, Lifecycle } from './entities.js';
import { isActive } from './entities.js';
import type { Command, CommandContext, CommandResult, EntityChange } from './command.js';
import type { EntityId } from './primitives.js';
import {
  findTransition,
  resolveTarget,
  type GateAdvisory,
  type GateBlocker,
  type GateReadiness,
  type TransitionName,
} from './lifecycle.js';
import {
  authorise,
  bumped,
  domainFail,
  event,
  succeed,
  updated,
  type HandlerState,
} from './handler-kit.js';
import { capacityKey, commitmentKey, type ProjectionKey } from './refs.js';

const HOLD_RESERVE_PREFIX = 'Held: ';

// ── Readiness ──────────────────────────────────────────────────────────────

export type ReadinessInput = {
  readonly commitment: Commitment;
  readonly footprints: readonly CapacityFootprint[];
  readonly hasProductImpact: boolean;
  readonly dependenciesReviewed: boolean;
  readonly largeThreshold: number;
};

/**
 * Pure, and exported, because the UI shows this checklist *before* the user
 * commits — the gate dialog and the handler must never disagree about what is
 * blocking.
 */
export function assessCommitGate(input: ReadinessInput): GateReadiness {
  const { commitment, footprints } = input;
  const own = footprints.filter((f) => f.commitmentId === commitment.id && isActive(f));

  const blockers: GateBlocker[] = [];
  if (!commitment.primaryTeamId) blockers.push('COMMIT_GATE_PRIMARY_TEAM_REQUIRED');
  if (own.length === 0) blockers.push('COMMIT_GATE_FOOTPRINT_REQUIRED');

  if (commitment.primaryTeamId && own.length > 0) {
    const primary = own.filter((f) => f.isPrimary);
    const matches = primary.length === 1 && primary[0]!.teamId === commitment.primaryTeamId;
    // A primary team with no footprint of its own is an accountability label,
    // which is exactly what the model refuses to allow.
    if (!matches) blockers.push('COMMIT_GATE_PRIMARY_FOOTPRINT_MISMATCH');
  }

  if (commitment.class === 'MANDATORY' && commitment.targetDate === undefined) {
    blockers.push('MANDATORY_TARGET_DATE_REQUIRED');
  }

  const advisories: GateAdvisory[] = [];
  if (!commitment.ownerRef) advisories.push('RDY_NO_OWNER');
  if (!commitment.targetQuarterId && !commitment.targetDate) advisories.push('RDY_NO_TARGET');
  if (!commitment.outcome) advisories.push('RDY_NO_OUTCOME');
  if (!input.hasProductImpact) advisories.push('RDY_NO_PRODUCT_IMPACT');
  if (!input.dependenciesReviewed) advisories.push('RDY_NO_DEPENDENCIES_REVIEWED');

  const totalUnits = own.reduce((sum, f) => sum + f.units, 0);
  if (totalUnits >= input.largeThreshold && commitment.sizeConfidence === 'LOW') {
    advisories.push('RDY_LOW_CONFIDENCE_LARGE');
  }

  const quarters = new Set(own.map((f) => f.quarterId));
  if (quarters.size > 3) advisories.push('RDY_SPANS_MANY_QUARTERS');

  return { blockers, advisories, ready: blockers.length === 0 };
}

// ── Transition handler ─────────────────────────────────────────────────────

export type LifecyclePayload = {
  readonly commitmentId: EntityId;
  /** HoldCommitment only. Converts the load into a labelled HOLD reserve. */
  readonly preserveCapacity?: boolean;
  /** PassCommitGate only. Records that the Planner accepted a known overflow. */
  readonly acceptOverflow?: boolean;
  readonly dependenciesReviewed?: boolean;
};

const EVENT_BY_TRANSITION: Record<TransitionName, string> = {
  PassCommitGate: 'COMMITMENT_COMMITTED',
  RevertCommitGate: 'COMMITMENT_UNCOMMITTED',
  StartDelivery: 'DELIVERY_STARTED',
  CorrectToCommitted: 'DELIVERY_CORRECTED',
  HoldCommitment: 'COMMITMENT_HELD',
  ResumeCommitment: 'COMMITMENT_RESUMED',
  CompleteCommitment: 'COMMITMENT_COMPLETED',
  DropCommitment: 'COMMITMENT_DROPPED',
};

const INVERSE_BY_TRANSITION: Partial<Record<TransitionName, TransitionName>> = {
  PassCommitGate: 'RevertCommitGate',
  RevertCommitGate: 'PassCommitGate',
  StartDelivery: 'CorrectToCommitted',
  CorrectToCommitted: 'StartDelivery',
  HoldCommitment: 'ResumeCommitment',
  ResumeCommitment: 'HoldCommitment',
};

export function applyTransition(
  name: TransitionName,
  state: HandlerState,
  payload: LifecyclePayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const transition = findTransition(name);

  // DropCommitment is Contributor-only from IDEA; Planner from anywhere else.
  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment) {
    return domainFail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  }

  const required =
    name === 'DropCommitment' && commitment.lifecycle !== 'IDEA' ? 'PLANNER' : transition.requires;
  const unauthorised = authorise(ctx, required);
  if (unauthorised) return unauthorised;

  if (!isActive(commitment)) {
    return domainFail('ENTITY_ARCHIVED', { params: { name: commitment.name } });
  }

  if (!transition.from.includes(commitment.lifecycle)) {
    return domainFail('ILLEGAL_LIFECYCLE_TRANSITION', {
      entityRef: { kind: 'COMMITMENT', id: commitment.id },
      params: { from: commitment.lifecycle, to: String(transition.to) },
    });
  }

  if (name === 'PassCommitGate') {
    const readiness = assessCommitGate({
      commitment,
      footprints: [...state.footprints.values()],
      hasProductImpact: state.hasProductImpact?.(commitment.id) ?? true,
      dependenciesReviewed: payload.dependenciesReviewed ?? true,
      largeThreshold: state.workspace.settings.capacity.sizeMapping.L,
    });

    const blocker = readiness.blockers[0];
    if (blocker) {
      return domainFail(blocker, {
        entityRef: { kind: 'COMMITMENT', id: commitment.id },
        params: { name: commitment.name },
      });
    }
  }

  // RevertCommitGate is only safe while delivery has never started, otherwise a
  // commitment could lose the capacity it is actively consuming.
  if (name === 'RevertCommitGate' && commitment.committedAt !== undefined) {
    const everDelivered = state.everInDelivery?.(commitment.id) ?? false;
    if (everDelivered) {
      return domainFail('ILLEGAL_LIFECYCLE_TRANSITION', {
        entityRef: { kind: 'COMMITMENT', id: commitment.id },
        params: { from: 'IN_DELIVERY', to: 'IDEA' },
      });
    }
  }

  const target = resolveTarget(transition, commitment);
  const own = [...state.footprints.values()].filter(
    (f) => f.commitmentId === commitment.id && isActive(f),
  );

  const after = bumped(nextCommitment(commitment, name, target, own, ctx), ctx);
  const ref = { kind: 'COMMITMENT', id: commitment.id } as const;

  const changes: EntityChange[] = [updated(ref, commitment, after)];
  const projections: ProjectionKey[] = [commitmentKey(commitment.id)];
  for (const footprint of own) projections.push(capacityKey(footprint.teamId, footprint.quarterId));

  const inverseName = INVERSE_BY_TRANSITION[name];

  return succeed({
    changes,
    events: [
      event(cmd, ctx, 0, EVENT_BY_TRANSITION[name], [ref], {
        name: commitment.name,
        from: commitment.lifecycle,
        to: target,
        units: own.reduce((sum, f) => sum + f.units, 0),
        ...(payload.acceptOverflow ? { overflowAccepted: true } : {}),
      }),
    ],
    affectedProjections: projections,
    ...(inverseName
      ? {
          inverse: {
            ...cmd,
            id: ctx.ids.next(),
            name: inverseName,
            payload: { commitmentId: commitment.id },
          },
        }
      : {}),
  });
}

function nextCommitment(
  commitment: Commitment,
  name: TransitionName,
  target: Lifecycle,
  own: readonly CapacityFootprint[],
  ctx: CommandContext,
): Commitment {
  const base: Commitment = { ...commitment, lifecycle: target };

  switch (name) {
    case 'PassCommitGate':
      return {
        ...base,
        committedAt: ctx.clock.now(),
        committedBy: ctx.actorId,
        // Frozen so HLT_GROWN can compare against what was actually agreed.
        unitsAtCommit: own.reduce((sum, f) => sum + f.units, 0),
        lastMeaningfulUpdateAt: ctx.clock.now(),
      };

    case 'RevertCommitGate': {
      const { committedAt: _c, committedBy: _b, unitsAtCommit: _u, ...rest } = base;
      return { ...rest, lastMeaningfulUpdateAt: ctx.clock.now() };
    }

    case 'HoldCommitment':
      return {
        ...base,
        priorActiveLifecycle: commitment.lifecycle as 'COMMITTED' | 'IN_DELIVERY',
        lastMeaningfulUpdateAt: ctx.clock.now(),
      };

    case 'ResumeCommitment': {
      const { priorActiveLifecycle: _p, ...rest } = base;
      return { ...rest, lastMeaningfulUpdateAt: ctx.clock.now() };
    }

    default:
      return { ...base, lastMeaningfulUpdateAt: ctx.clock.now() };
  }
}

/**
 * The reserve label a preserved hold creates. Exported so the UI can recognise
 * system-managed hold reserves without string-matching in three places.
 */
export function holdReserveLabel(commitmentName: string): string {
  return `${HOLD_RESERVE_PREFIX}${commitmentName}`;
}

export function isHoldReserveLabel(label: string): boolean {
  return label.startsWith(HOLD_RESERVE_PREFIX);
}
