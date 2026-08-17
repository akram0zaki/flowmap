/**
 * Quarter review, carry-over and close commands (M5).
 *
 * The review is a pure projection until a Planner closes the quarter. The
 * command then records the judgements in its event facts, creates carry-over
 * footprints and freezes the affected capacity containers atomically.
 */

import { isActive, type CapacityFootprint, type TeamQuarter, type Workspace } from './entities.js';
import type {
  Command,
  CommandContext,
  CommandResult,
  EntityChange,
  WorkspaceState,
} from './command.js';
import { deliverableCapacity, summariseCapacity } from './capacity.js';
import {
  authorise,
  bumped,
  created,
  domainFail,
  event,
  newEnvelope,
  succeed,
  updated,
} from './handler-kit.js';
import { nextQuarter, type QuarterId } from './quarter.js';
import type { CapacityUnits, EntityId } from './primitives.js';
import type { EntityRef } from './refs.js';

export type OperationalJudgement = 'BELOW' | 'ABOUT' | 'ABOVE';
export type CapacityJudgement = 'LOWER' | 'ABOUT' | 'HIGHER';

export type QuarterOutcome = {
  readonly teamId: EntityId;
  readonly operationalLoad: OperationalJudgement;
  readonly capacity: CapacityJudgement;
  readonly note?: string;
};

export type QuarterReviewTeam = {
  readonly teamId: EntityId;
  readonly team: string;
  readonly plannedDeliverableCapacity: CapacityUnits;
  readonly finalDeliverableCapacity: CapacityUnits;
  readonly committedLoadAtClose: CapacityUnits;
  readonly completedCommitmentIds: readonly EntityId[];
  readonly unfinishedCommitmentIds: readonly EntityId[];
  readonly droppedCommitmentIds: readonly EntityId[];
};

export type QuarterReviewDraft = {
  readonly quarterId: QuarterId;
  readonly teams: readonly QuarterReviewTeam[];
};

export type CarryOverDestination = {
  readonly teamId: EntityId;
  readonly quarterId: QuarterId;
  readonly units: CapacityUnits;
  readonly isPrimary?: boolean;
};

export type CarryOverProposal = {
  readonly originFootprintId: EntityId;
  readonly commitmentId: EntityId;
  readonly commitment: string;
  readonly sourceTeamId: EntityId;
  readonly sourceQuarterId: QuarterId;
  readonly units: CapacityUnits;
  readonly defaultDestination: CarryOverDestination;
};

export type CarryOverDecision =
  | { readonly originFootprintId: EntityId; readonly action: 'DECLINE' }
  | {
      readonly originFootprintId: EntityId;
      readonly action: 'CARRY';
      readonly destinations: readonly CarryOverDestination[];
    };

export function openQuarterReview(state: WorkspaceState, quarterId: QuarterId): QuarterReviewDraft {
  const teamRows = [...state.teams.values()]
    .filter((team) => isActive(team) && team.active)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
    .map((team) => {
      const holder = [...state.teamQuarters.values()].find(
        (item) => isActive(item) && item.teamId === team.id && item.quarterId === quarterId,
      );
      const inTeam = [...state.footprints.values()].filter(
        (footprint) =>
          isActive(footprint) && footprint.teamId === team.id && footprint.quarterId === quarterId,
      );
      const commitments = inTeam
        .map((footprint) => state.commitments.get(footprint.commitmentId))
        .filter((item): item is NonNullable<typeof item> => item !== undefined && isActive(item));
      const summary = holder
        ? summariseCapacity({
            teamQuarter: holder,
            footprints: inTeam,
            commitmentsById: state.commitments,
            currentQuarterId: state.workspace.currentQuarterId,
          })
        : null;
      const ids = (lifecycle: string) => [
        ...new Set(
          commitments.filter((item) => item.lifecycle === lifecycle).map((item) => item.id),
        ),
      ];
      return {
        teamId: team.id,
        team: team.name,
        // A workspace has no quarter-open snapshot until M6 portability ships.
        // Capacity containers themselves are immutable once closed, so their
        // opening baseline plus reserves is the honest available figure.
        plannedDeliverableCapacity: holder ? deliverableCapacity(holder) : 0,
        finalDeliverableCapacity: summary?.deliverableCapacity ?? 0,
        committedLoadAtClose: summary?.committedLoad ?? 0,
        completedCommitmentIds: ids('DONE'),
        unfinishedCommitmentIds: [
          ...new Set(
            commitments
              .filter((item) => item.lifecycle === 'COMMITTED' || item.lifecycle === 'IN_DELIVERY')
              .map((item) => item.id),
          ),
        ],
        droppedCommitmentIds: ids('DROPPED'),
      } satisfies QuarterReviewTeam;
    });
  return { quarterId, teams: teamRows };
}

export function proposeCarryOver(state: WorkspaceState, quarterId: QuarterId): CarryOverProposal[] {
  return [...state.footprints.values()]
    .filter((footprint) => {
      const commitment = state.commitments.get(footprint.commitmentId);
      return (
        isActive(footprint) &&
        footprint.quarterId === quarterId &&
        commitment !== undefined &&
        isActive(commitment) &&
        (commitment.lifecycle === 'COMMITTED' || commitment.lifecycle === 'IN_DELIVERY')
      );
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((footprint) => {
      const commitment = state.commitments.get(footprint.commitmentId)!;
      return {
        originFootprintId: footprint.id,
        commitmentId: commitment.id,
        commitment: commitment.name,
        sourceTeamId: footprint.teamId,
        sourceQuarterId: quarterId,
        units: footprint.units,
        defaultDestination: {
          teamId: footprint.teamId,
          quarterId: nextQuarter(quarterId),
          units: footprint.units,
          isPrimary: footprint.isPrimary,
        },
      };
    });
}

export type CloseQuarterPayload = {
  readonly quarterId: QuarterId;
  readonly outcomes: readonly QuarterOutcome[];
  readonly carryOver: readonly CarryOverDecision[];
};

export function closeQuarter(
  state: WorkspaceState,
  payload: CloseQuarterPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  const holders = [...state.teamQuarters.values()].filter(
    (holder) => isActive(holder) && holder.quarterId === payload.quarterId,
  );
  if (holders.some((holder) => holder.closedAt !== undefined))
    return domainFail('QUARTER_ALREADY_CLOSED', { params: { quarter: payload.quarterId } });
  const proposals = proposeCarryOver(state, payload.quarterId);
  const decisions = new Map(payload.carryOver.map((item) => [item.originFootprintId, item]));
  const missing = proposals.filter((proposal) => !decisions.has(proposal.originFootprintId));
  if (missing.length > 0)
    return domainFail('CARRY_OVER_NOT_REVIEWED', {
      params: { count: missing.length, quarter: payload.quarterId },
    });
  if (payload.outcomes.some((outcome) => outcome.note !== undefined && outcome.note.length > 280)) {
    return domainFail('NOTE_TOO_LONG', {
      params: {
        max: 280,
        actual: Math.max(...payload.outcomes.map((item) => item.note?.length ?? 0)),
      },
    });
  }

  const changes: EntityChange[] = [];
  const eventRefs: EntityRef[] = holders.map((holder) => ({ kind: 'TEAM_QUARTER', id: holder.id }));
  const createdTargetKeys = new Set<string>();
  for (const proposal of proposals) {
    const decision = decisions.get(proposal.originFootprintId)!;
    if (decision.action === 'DECLINE') continue;
    if (
      decision.destinations.length === 0 ||
      decision.destinations.some((destination) => destination.units <= 0)
    ) {
      return domainFail('FOOTPRINT_UNITS_MUST_BE_POSITIVE');
    }
    const origin = state.footprints.get(proposal.originFootprintId)!;
    const originAfter = bumped({ ...origin, closedAsUnfinished: true }, ctx);
    changes.push(updated({ kind: 'CAPACITY_FOOTPRINT', id: origin.id }, origin, originAfter));
    eventRefs.push({ kind: 'CAPACITY_FOOTPRINT', id: origin.id });
    for (const destination of decision.destinations) {
      const holderKey = `${destination.teamId}:${destination.quarterId}`;
      const exists = [...state.teamQuarters.values()].some(
        (item) =>
          isActive(item) &&
          item.teamId === destination.teamId &&
          item.quarterId === destination.quarterId,
      );
      const destinationAlreadyClosed = [...state.teamQuarters.values()].some(
        (item) =>
          isActive(item) &&
          item.teamId === destination.teamId &&
          item.quarterId === destination.quarterId &&
          item.closedAt !== undefined,
      );
      if (destinationAlreadyClosed)
        return domainFail('QUARTER_CLOSED', {
          params: { quarter: destination.quarterId },
        });
      if (!exists && !createdTargetKeys.has(holderKey)) {
        const team = state.teams.get(destination.teamId);
        if (!team || !isActive(team))
          return domainFail('ENTITY_NOT_FOUND', {
            entityRef: { kind: 'TEAM', id: destination.teamId },
          });
        const holder: TeamQuarter = {
          ...newEnvelope(ctx.ids.next(), cmd, ctx),
          teamId: team.id,
          quarterId: destination.quarterId,
          capacityBaseline: team.defaultQuarterCapacity,
          capacityAdjustment: 0,
          reserves: state.workspace.settings.capacity.defaultReserves.map((reserve) => ({
            ...reserve,
            id: ctx.ids.next(),
          })),
        };
        changes.push(created({ kind: 'TEAM_QUARTER', id: holder.id }, holder));
        createdTargetKeys.add(holderKey);
      }
      const footprint: CapacityFootprint = {
        ...newEnvelope(ctx.ids.next(), cmd, ctx),
        commitmentId: proposal.commitmentId,
        teamId: destination.teamId,
        quarterId: destination.quarterId,
        units: destination.units,
        unitsSource: 'CARRY_OVER',
        isPrimary: destination.isPrimary ?? false,
        carryOverFromQuarterId: payload.quarterId,
        carryOverFromFootprintId: origin.id,
      };
      changes.push(created({ kind: 'CAPACITY_FOOTPRINT', id: footprint.id }, footprint));
      eventRefs.push({ kind: 'CAPACITY_FOOTPRINT', id: footprint.id });
    }
  }
  for (const holder of holders) {
    const after = bumped({ ...holder, closedAt: ctx.clock.now() }, ctx);
    changes.push(updated({ kind: 'TEAM_QUARTER', id: holder.id }, holder, after));
  }
  const workspace: Workspace = state.workspace;
  const workspaceAfter = bumped(
    {
      ...workspace,
      currentQuarterId: nextQuarter(payload.quarterId),
      revision: workspace.revision + 1,
    },
    ctx,
  );
  changes.push(updated({ kind: 'WORKSPACE', id: workspace.id }, workspace, workspaceAfter));
  const carriedByTeam: Record<string, number> = {};
  const sizeRatiosByTeam: Record<string, number[]> = {};
  for (const proposal of proposals) {
    const decision = decisions.get(proposal.originFootprintId)!;
    if (decision.action === 'CARRY') {
      carriedByTeam[proposal.sourceTeamId] =
        (carriedByTeam[proposal.sourceTeamId] ?? 0) + proposal.units;
    }
    const commitment = state.commitments.get(proposal.commitmentId)!;
    if (commitment.unitsAtCommit && commitment.unitsAtCommit > 0) {
      const ratios = sizeRatiosByTeam[proposal.sourceTeamId] ?? [];
      ratios.push(proposal.units / commitment.unitsAtCommit);
      sizeRatiosByTeam[proposal.sourceTeamId] = ratios;
    }
  }
  return succeed({
    changes,
    events: [
      event(cmd, ctx, 0, 'QUARTER_CLOSED', eventRefs, {
        quarterId: payload.quarterId,
        outcomes: payload.outcomes,
        carryOver: payload.carryOver,
        carriedByTeam,
        sizeRatiosByTeam,
      }),
    ],
    affectedProjections: ['radar'],
    consequences: [{ kind: 'IRREVERSIBLE', noteKey: 'quarter.closeBarrier' }],
  });
}

export type ReopenQuarterPayload = { readonly quarterId: QuarterId; readonly confirmed: boolean };

export function reopenQuarter(
  state: WorkspaceState,
  payload: ReopenQuarterPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'ADMIN');
  if (unauthorised) return unauthorised;
  if (!payload.confirmed)
    return domainFail('QUARTER_CLOSED', { params: { quarter: payload.quarterId } });
  const holders = [...state.teamQuarters.values()].filter(
    (holder) =>
      isActive(holder) && holder.quarterId === payload.quarterId && holder.closedAt !== undefined,
  );
  if (holders.length === 0)
    return domainFail('QUARTER_ALREADY_CLOSED', { params: { quarter: payload.quarterId } });
  const changes = holders.map((holder) => {
    const { closedAt: _closedAt, ...open } = holder;
    return updated({ kind: 'TEAM_QUARTER', id: holder.id }, holder, bumped(open, ctx));
  });
  return succeed({
    changes,
    events: [
      event(
        cmd,
        ctx,
        0,
        'QUARTER_REOPENED',
        holders.map((holder) => ({ kind: 'TEAM_QUARTER' as const, id: holder.id })),
        { quarterId: payload.quarterId },
      ),
    ],
    affectedProjections: ['radar'],
    consequences: [{ kind: 'IRREVERSIBLE', noteKey: 'quarter.reopenBarrier' }],
  });
}
