/**
 * Command handlers for the M1 walking skeleton.
 *
 * Every handler validates in the same fixed order — authorisation, payload,
 * referential existence, invariants, guardrails, apply — so a failure at any
 * stage produces no partial effects.
 *
 * See docs/spec/03-commands-permissions.md §1 and §3.
 */

import {
  isActive,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_TEAM_QUARTER_CAPACITY,
  DEFAULT_VALUE_DRIVERS,
  DEFAULT_CHANGE_LOAD_SETTINGS,
  type CapacityFootprint,
  type CapacityReserve,
  type Commitment,
  type Team,
  type TeamQuarter,
  type Workspace,
  type WorkspaceUser,
} from './entities.js';
import type {
  Command,
  CommandContext,
  CommandEffects,
  CommandResult,
  Consequence,
  EntityChange,
  WorkspaceState,
} from './command.js';
import {
  archivedChange as archived,
  authorise,
  bumped,
  created,
  domainFail as fail,
  event,
  newEnvelope,
  requireName,
  requireText,
  succeed,
  updated,
} from './handler-kit.js';
import { domainError } from './errors.js';
import { capacityKey, commitmentKey, type ProjectionKey } from './refs.js';
import { deliverableCapacity, reservedTotal, resolveUnits, summariseCapacity } from './capacity.js';
import type { CapacityUnits, Confidence, EntityId, OwnerRef, RelativeSize } from './primitives.js';
import { isQuarterId, quarterOfDate, type QuarterId } from './quarter.js';

// ── CreateWorkspace ────────────────────────────────────────────────────────

export type CreateWorkspacePayload = {
  readonly name: string;
  readonly timezone: string;
  readonly currentQuarterId: QuarterId;
  readonly isSample?: boolean;
  readonly ownerDisplayName?: string;
};

/**
 * Creates a workspace from name + timezone alone. Everything else is a smart
 * default — spec 06 §13: first run asks for a name and opens the map.
 */
export function createWorkspace(
  payload: CreateWorkspacePayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const nameError = requireName(payload.name, 80);
  if (nameError) return nameError;
  if (!isQuarterId(payload.currentQuarterId)) {
    return fail('NAME_REQUIRED', { field: 'currentQuarterId' });
  }

  const workspace: Workspace = {
    ...newEnvelope(cmd.workspaceId, cmd, ctx),
    name: payload.name.trim(),
    timezone: payload.timezone,
    currentQuarterId: payload.currentQuarterId,
    isSample: payload.isSample ?? false,
    revision: 1,
    settings: {
      capacity: {
        defaultTeamQuarterCapacity: DEFAULT_TEAM_QUARTER_CAPACITY,
        sizeMapping: DEFAULT_SIZE_MAPPING,
        defaultReserves: DEFAULT_RESERVES,
      },
      changeLoad: DEFAULT_CHANGE_LOAD_SETTINGS,
      valueDrivers: DEFAULT_VALUE_DRIVERS,
      noteMaxLength: 2000,
      milestonesPerCommitment: 6,
    },
  };

  const ref = { kind: 'WORKSPACE', id: workspace.id } as const;
  const owner: WorkspaceUser = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    identitySubject: cmd.actorId,
    displayName: payload.ownerDisplayName?.trim() || cmd.actorId,
    role: 'ADMIN',
  };
  const ownerRef = { kind: 'WORKSPACE_USER', id: owner.id } as const;
  return succeed({
    changes: [created(ref, workspace), created(ownerRef, owner)],
    events: [event(cmd, ctx, 0, 'WORKSPACE_CREATED', [ref, ownerRef], { name: workspace.name })],
    affectedProjections: [],
  });
}

// ── CreateTeam ─────────────────────────────────────────────────────────────

export type CreateTeamPayload = { readonly name: string; readonly description?: string };

export function createTeam(
  state: WorkspaceState,
  payload: CreateTeamPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const nameError = requireName(payload.name, 60);
  if (nameError) return nameError;

  const name = payload.name.trim();
  const clash = [...state.teams.values()].some(
    (team) => isActive(team) && team.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) return fail('DUPLICATE_NAME', { params: { name } });

  const team: Team = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    name,
    defaultQuarterCapacity: state.workspace.settings.capacity.defaultTeamQuarterCapacity,
    displayOrder: state.teams.size,
    active: true,
    ...(payload.description !== undefined ? { description: payload.description } : {}),
  };

  const ref = { kind: 'TEAM', id: team.id } as const;
  return succeed({
    changes: [created(ref, team)],
    events: [event(cmd, ctx, 0, 'TEAM_CREATED', [ref], { name })],
    affectedProjections: [],
    inverse: { ...cmd, id: ctx.ids.next(), name: 'ArchiveTeam', payload: { teamId: team.id } },
  });
}

export type ArchiveTeamPayload = { readonly teamId: EntityId };

/**
 * Hides a team from the map. Blocked while any live footprint still sits on it.
 * Team-quarters archive with the team (spec 01 §12).
 */
export function archiveTeam(
  state: WorkspaceState,
  payload: ArchiveTeamPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const team = state.teams.get(payload.teamId);
  if (!team) return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM', id: payload.teamId } });
  if (!isActive(team)) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const blocking = [...state.footprints.values()].find(
    (footprint) => isActive(footprint) && footprint.teamId === team.id,
  );
  if (blocking) {
    return fail('TEAM_HAS_ACTIVE_FOOTPRINTS', { params: { team: team.name } });
  }

  const after = bumped({ ...team, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId }, ctx);
  const ref = { kind: 'TEAM', id: team.id } as const;
  const changes: EntityChange[] = [archived(ref, team, after)];
  const projections: ProjectionKey[] = [];

  for (const teamQuarter of state.teamQuarters.values()) {
    if (!isActive(teamQuarter) || teamQuarter.teamId !== team.id) continue;
    const archivedQuarter = bumped(
      { ...teamQuarter, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId },
      ctx,
    );
    changes.push(
      archived({ kind: 'TEAM_QUARTER', id: teamQuarter.id }, teamQuarter, archivedQuarter),
    );
    projections.push(capacityKey(team.id, teamQuarter.quarterId));
  }

  return succeed({
    changes,
    events: [event(cmd, ctx, 0, 'TEAM_ARCHIVED', [ref], { name: team.name })],
    affectedProjections: projections,
    inverse: { ...cmd, id: ctx.ids.next(), name: 'RestoreTeam', payload: { teamId: team.id } },
  });
}

export type RestoreTeamPayload = { readonly teamId: EntityId };

/**
 * Inverse of ArchiveTeam. Restores the team and the team-quarters archived
 * with it, subject to current invariants (spec 01 §12).
 */
export function restoreTeam(
  state: WorkspaceState,
  payload: RestoreTeamPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const team = state.teams.get(payload.teamId);
  if (!team) return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM', id: payload.teamId } });
  if (isActive(team)) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const { archivedAt: _archivedAt, archivedBy: _archivedBy, ...live } = team;
  const after = bumped(live as Team, ctx);
  const ref = { kind: 'TEAM', id: team.id } as const;
  const changes: EntityChange[] = [{ ...updated(ref, team, after), op: 'RESTORE' }];
  const projections: ProjectionKey[] = [];

  for (const teamQuarter of state.teamQuarters.values()) {
    if (isActive(teamQuarter) || teamQuarter.teamId !== team.id) continue;
    const { archivedAt: _at, archivedBy: _by, ...quarterLive } = teamQuarter;
    const restoredQuarter = bumped(quarterLive as TeamQuarter, ctx);
    changes.push({
      ...updated({ kind: 'TEAM_QUARTER', id: teamQuarter.id }, teamQuarter, restoredQuarter),
      op: 'RESTORE',
    });
    projections.push(capacityKey(team.id, teamQuarter.quarterId));
  }

  return succeed({
    changes,
    events: [event(cmd, ctx, 0, 'TEAM_RESTORED', [ref], { name: team.name })],
    affectedProjections: projections,
    inverse: { ...cmd, id: ctx.ids.next(), name: 'ArchiveTeam', payload: { teamId: team.id } },
  });
}

// ── EnsureTeamQuarter ──────────────────────────────────────────────────────

export type EnsureTeamQuarterPayload = {
  readonly teamId: EntityId;
  readonly quarterId: QuarterId;
};

/**
 * Idempotent. A team-quarter is created lazily on first need and is never
 * implicit in a calculation — spec 01 §4.
 */
export function ensureTeamQuarter(
  state: WorkspaceState,
  payload: EnsureTeamQuarterPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const team = state.teams.get(payload.teamId);
  if (!team) return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM', id: payload.teamId } });
  if (!isActive(team)) return fail('ENTITY_ARCHIVED', { params: { name: team.name } });
  if (!isQuarterId(payload.quarterId)) return fail('NAME_REQUIRED', { field: 'quarterId' });

  const existing = findTeamQuarter(state, payload.teamId, payload.quarterId);
  if (existing) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const teamQuarter: TeamQuarter = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    teamId: team.id,
    quarterId: payload.quarterId,
    capacityBaseline: team.defaultQuarterCapacity,
    capacityAdjustment: 0,
    reserves: state.workspace.settings.capacity.defaultReserves.map((reserve) => ({
      ...reserve,
      id: ctx.ids.next(),
    })),
  };

  const ref = { kind: 'TEAM_QUARTER', id: teamQuarter.id } as const;
  return succeed({
    changes: [created(ref, teamQuarter)],
    events: [],
    affectedProjections: [capacityKey(team.id, payload.quarterId)],
  });
}

// ── CreateIdea ─────────────────────────────────────────────────────────────

export type CreateIdeaPayload = { readonly name: string };

/**
 * Quick Capture: a title and nothing else. Everything else is optional and
 * added later in context — spec 06 §9.
 */
export function createIdea(
  payload: CreateIdeaPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const nameError = requireName(payload.name, 140);
  if (nameError) return nameError;

  const commitment: Commitment = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    name: payload.name.trim(),
    lifecycle: 'IDEA',
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    valueDrivers: [],
  };

  const ref = { kind: 'COMMITMENT', id: commitment.id } as const;
  return succeed({
    changes: [created(ref, commitment)],
    events: [event(cmd, ctx, 0, 'IDEA_CAPTURED', [ref], { name: commitment.name })],
    affectedProjections: [commitmentKey(commitment.id)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'ArchiveCommitment',
      payload: { commitmentId: commitment.id },
    },
  });
}

// ── AssignCapacityFootprint ────────────────────────────────────────────────

export type AssignFootprintPayload = {
  readonly commitmentId: EntityId;
  readonly teamId: EntityId;
  readonly quarterId: QuarterId;
  readonly size?: RelativeSize;
  readonly units?: CapacityUnits;
  readonly isPrimary?: boolean;
};

export function assignCapacityFootprint(
  state: WorkspaceState,
  payload: AssignFootprintPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  }
  if (!isActive(commitment)) return fail('ENTITY_ARCHIVED', { params: { name: commitment.name } });

  const team = state.teams.get(payload.teamId);
  if (!team) return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM', id: payload.teamId } });

  const closed = closedTeamQuarter(state, payload.teamId, payload.quarterId);
  if (closed) return fail('QUARTER_CLOSED', { params: { quarter: payload.quarterId } });

  const duplicate = [...state.footprints.values()].find(
    (f) =>
      isActive(f) &&
      f.commitmentId === payload.commitmentId &&
      f.teamId === payload.teamId &&
      f.quarterId === payload.quarterId,
  );
  if (duplicate) {
    return fail('DUPLICATE_FOOTPRINT', {
      entityRef: { kind: 'CAPACITY_FOOTPRINT', id: duplicate.id },
      params: { name: commitment.name, team: team.name, quarter: payload.quarterId },
    });
  }

  const resolved = resolveFootprintUnits(payload, state);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const footprint: CapacityFootprint = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    commitmentId: commitment.id,
    teamId: team.id,
    quarterId: payload.quarterId,
    units: resolved.value.units,
    unitsSource: resolved.value.source,
    isPrimary: payload.isPrimary ?? false,
    ...(payload.size !== undefined ? { sizeAtCreation: payload.size } : {}),
  };

  const ref = { kind: 'CAPACITY_FOOTPRINT', id: footprint.id } as const;
  return succeed({
    changes: [created(ref, footprint)],
    events: [
      event(cmd, ctx, 0, 'FOOTPRINT_ASSIGNED', [ref, { kind: 'COMMITMENT', id: commitment.id }], {
        commitment: commitment.name,
        team: team.name,
        quarter: payload.quarterId,
        units: footprint.units,
      }),
    ],
    affectedProjections: [capacityKey(team.id, payload.quarterId), commitmentKey(commitment.id)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'RemoveCapacityFootprint',
      payload: { footprintId: footprint.id },
    },
    ...overflowConsequence(state, payload.teamId, payload.quarterId, resolved.value.units),
  });
}

// ── MoveCapacityFootprint ──────────────────────────────────────────────────

export type MoveFootprintPayload = {
  readonly footprintId: EntityId;
  readonly teamId?: EntityId;
  readonly quarterId?: QuarterId;
};

export function moveCapacityFootprint(
  state: WorkspaceState,
  payload: MoveFootprintPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const footprint = state.footprints.get(payload.footprintId);
  if (!footprint || !isActive(footprint)) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'CAPACITY_FOOTPRINT', id: payload.footprintId },
    });
  }

  const teamId = payload.teamId ?? footprint.teamId;
  const quarterId = payload.quarterId ?? footprint.quarterId;
  if (teamId === footprint.teamId && quarterId === footprint.quarterId) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  if (!state.teams.has(teamId)) {
    return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM', id: teamId } });
  }
  if (closedTeamQuarter(state, footprint.teamId, footprint.quarterId)) {
    return fail('QUARTER_CLOSED', { params: { quarter: footprint.quarterId } });
  }
  if (closedTeamQuarter(state, teamId, quarterId)) {
    return fail('QUARTER_CLOSED', { params: { quarter: quarterId } });
  }

  const duplicate = [...state.footprints.values()].find(
    (f) =>
      isActive(f) &&
      f.id !== footprint.id &&
      f.commitmentId === footprint.commitmentId &&
      f.teamId === teamId &&
      f.quarterId === quarterId,
  );
  if (duplicate) return fail('DUPLICATE_FOOTPRINT', { params: { quarter: quarterId } });

  const after = bumped({ ...footprint, teamId, quarterId }, ctx);
  const ref = { kind: 'CAPACITY_FOOTPRINT', id: footprint.id } as const;

  return succeed({
    changes: [updated(ref, footprint, after)],
    events: [
      event(cmd, ctx, 0, 'FOOTPRINT_MOVED', [ref], {
        fromTeam: footprint.teamId,
        fromQuarter: footprint.quarterId,
        toTeam: teamId,
        toQuarter: quarterId,
        units: footprint.units,
      }),
    ],
    affectedProjections: [
      capacityKey(footprint.teamId, footprint.quarterId),
      capacityKey(teamId, quarterId),
      commitmentKey(footprint.commitmentId),
    ],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'MoveCapacityFootprint',
      payload: {
        footprintId: footprint.id,
        teamId: footprint.teamId,
        quarterId: footprint.quarterId,
      },
    },
    ...overflowConsequence(state, teamId, quarterId, footprint.units),
  });
}

// ── ResizeCapacityFootprint ────────────────────────────────────────────────

export type ResizeFootprintPayload = {
  readonly footprintId: EntityId;
  readonly size?: RelativeSize;
  readonly units?: CapacityUnits;
};

export function resizeCapacityFootprint(
  state: WorkspaceState,
  payload: ResizeFootprintPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const footprint = state.footprints.get(payload.footprintId);
  if (!footprint || !isActive(footprint)) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'CAPACITY_FOOTPRINT', id: payload.footprintId },
    });
  }
  if (closedTeamQuarter(state, footprint.teamId, footprint.quarterId)) {
    return fail('QUARTER_CLOSED', { params: { quarter: footprint.quarterId } });
  }

  const resolved = resolveFootprintUnits(payload, state);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (resolved.value.units === footprint.units) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const after = bumped(
    {
      ...footprint,
      units: resolved.value.units,
      unitsSource: resolved.value.source,
      ...(payload.size !== undefined ? { sizeAtCreation: payload.size } : {}),
    },
    ctx,
  );
  const ref = { kind: 'CAPACITY_FOOTPRINT', id: footprint.id } as const;

  return succeed({
    changes: [updated(ref, footprint, after)],
    events: [
      event(cmd, ctx, 0, 'FOOTPRINT_RESIZED', [ref], {
        fromUnits: footprint.units,
        toUnits: after.units,
      }),
    ],
    affectedProjections: [
      capacityKey(footprint.teamId, footprint.quarterId),
      commitmentKey(footprint.commitmentId),
    ],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'ResizeCapacityFootprint',
      payload: { footprintId: footprint.id, units: footprint.units },
    },
    ...overflowConsequence(
      state,
      footprint.teamId,
      footprint.quarterId,
      after.units - footprint.units,
    ),
  });
}

// ── RemoveCapacityFootprint ────────────────────────────────────────────────

export type RemoveFootprintPayload = { readonly footprintId: EntityId };

export function removeCapacityFootprint(
  state: WorkspaceState,
  payload: RemoveFootprintPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const footprint = state.footprints.get(payload.footprintId);
  if (!footprint) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'CAPACITY_FOOTPRINT', id: payload.footprintId },
    });
  }
  if (!isActive(footprint)) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }
  if (closedTeamQuarter(state, footprint.teamId, footprint.quarterId)) {
    return fail('QUARTER_CLOSED', { params: { quarter: footprint.quarterId } });
  }

  // Archive, never delete — links and history survive (spec 01 §12).
  const after = bumped({ ...footprint, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId }, ctx);
  const ref = { kind: 'CAPACITY_FOOTPRINT', id: footprint.id } as const;

  return succeed({
    changes: [archived(ref, footprint, after)],
    events: [
      event(cmd, ctx, 0, 'FOOTPRINT_REMOVED', [ref], {
        team: footprint.teamId,
        quarter: footprint.quarterId,
        units: footprint.units,
      }),
    ],
    affectedProjections: [
      capacityKey(footprint.teamId, footprint.quarterId),
      commitmentKey(footprint.commitmentId),
    ],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'RestoreCapacityFootprint',
      payload: { footprintId: footprint.id },
    },
  });
}

// ── RestoreCapacityFootprint ───────────────────────────────────────────────

export type RestoreFootprintPayload = { readonly footprintId: EntityId };

/**
 * Un-archives a footprint. Archive is reversible by design (spec 01 §12), which
 * is also what makes removal undoable — the id, and therefore every reference to
 * it, survives.
 */
export function restoreCapacityFootprint(
  state: WorkspaceState,
  payload: RestoreFootprintPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const footprint = state.footprints.get(payload.footprintId);
  if (!footprint) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'CAPACITY_FOOTPRINT', id: payload.footprintId },
    });
  }
  if (isActive(footprint)) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }
  if (closedTeamQuarter(state, footprint.teamId, footprint.quarterId)) {
    return fail('QUARTER_CLOSED', { params: { quarter: footprint.quarterId } });
  }

  const { archivedAt: _archivedAt, archivedBy: _archivedBy, ...rest } = footprint;
  const after = bumped(rest as CapacityFootprint, ctx);
  const ref = { kind: 'CAPACITY_FOOTPRINT', id: footprint.id } as const;

  return succeed({
    changes: [{ ...updated(ref, footprint, after), op: 'RESTORE' }],
    events: [
      event(cmd, ctx, 0, 'FOOTPRINT_RESTORED', [ref], {
        team: footprint.teamId,
        quarter: footprint.quarterId,
        units: footprint.units,
      }),
    ],
    affectedProjections: [
      capacityKey(footprint.teamId, footprint.quarterId),
      commitmentKey(footprint.commitmentId),
    ],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'RemoveCapacityFootprint',
      payload: { footprintId: footprint.id },
    },
  });
}

// ── ReorderTeams ───────────────────────────────────────────────────────────

export type ReorderTeamsPayload = { readonly orderedTeamIds: readonly EntityId[] };

/**
 * The Planner's explicit row order.
 *
 * Alphabetical is only the seed. Once a lead has arranged the rows the order is
 * theirs, and nothing — least of all pressure — may reshuffle it: a map that
 * rearranges itself cannot be learned (spec 06 §3.1).
 *
 * Teams the payload does not name keep their relative order *after* the ones it
 * does, rather than being dropped somewhere arbitrary. That matters because the
 * caller's list can be one team out of date — created on another machine, or by
 * an import — and losing a row off the board is a worse outcome than putting a
 * new one last.
 */
export function reorderTeams(
  state: WorkspaceState,
  payload: ReorderTeamsPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const seen = new Set<EntityId>();
  for (const teamId of payload.orderedTeamIds) {
    const team = state.teams.get(teamId);
    if (!team) return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM', id: teamId } });
    if (!isActive(team)) return fail('ENTITY_ARCHIVED', { params: { name: team.name } });
    if (seen.has(teamId)) return fail('DUPLICATE_NAME', { params: { name: team.name } });
    seen.add(teamId);
  }

  const before = currentTeamOrder(state);
  const ordered = [
    ...payload.orderedTeamIds.map((id) => state.teams.get(id)!),
    ...before.filter((team) => !seen.has(team.id)),
  ];

  const changes = ordered.flatMap((team, index) =>
    team.displayOrder === index
      ? []
      : [
          updated(
            { kind: 'TEAM', id: team.id },
            team,
            bumped({ ...team, displayOrder: index }, ctx),
          ),
        ],
  );

  if (changes.length === 0) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  return succeed({
    changes,
    events: [
      event(cmd, ctx, 0, 'TEAMS_REORDERED', [], {
        count: changes.length,
        first: ordered[0]?.name ?? '',
      }),
    ],
    affectedProjections: [],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'ReorderTeams',
      payload: { orderedTeamIds: before.map((team) => team.id) },
    },
  });
}

// ── SplitCapacityFootprint ─────────────────────────────────────────────────

export type SplitFootprintPayload = {
  readonly footprintId: EntityId;
  readonly into: readonly { readonly quarterId: QuarterId; readonly units: CapacityUnits }[];
  /**
   * Ids to restore rather than create, for the parts the source does not
   * become, in `into` order with the source's own entry skipped.
   *
   * Only a `MergeCapacityFootprints` inverse supplies these. Without them a redo
   * would rebuild the same split out of brand-new entities, leaving the archived
   * originals behind and dropping whatever the user had selected.
   */
  readonly reuseFootprintIds?: readonly EntityId[];
};

/**
 * Divides one placement across quarters. The sum must equal the original: a
 * split redistributes work, it never quietly changes how much there is.
 *
 * The source footprint becomes the part in its own quarter where there is one,
 * so the primary placement — and every reference to it — stays where the
 * commitment already sits. Only the parts that move are new.
 *
 * See docs/spec/03-commands-permissions.md §3.4.
 */
export function splitCapacityFootprint(
  state: WorkspaceState,
  payload: SplitFootprintPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const footprint = state.footprints.get(payload.footprintId);
  if (!footprint || !isActive(footprint)) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'CAPACITY_FOOTPRINT', id: payload.footprintId },
    });
  }

  const parts = payload.into;
  if (parts.length === 0) {
    return fail('SPLIT_UNITS_MISMATCH', { params: { expected: footprint.units, actual: 0 } });
  }

  const quarters = new Set<string>();
  let total = 0;
  for (const part of parts) {
    if (!isQuarterId(part.quarterId)) return fail('NAME_REQUIRED', { field: 'quarterId' });
    if (!Number.isInteger(part.units) || part.units <= 0) {
      return fail('FOOTPRINT_UNITS_MUST_BE_POSITIVE', { field: 'units' });
    }
    if (quarters.has(part.quarterId)) {
      return fail('DUPLICATE_FOOTPRINT', { params: { quarter: part.quarterId } });
    }
    quarters.add(part.quarterId);
    total += part.units;
  }

  if (total !== footprint.units) {
    return fail('SPLIT_UNITS_MISMATCH', { params: { expected: footprint.units, actual: total } });
  }

  if (closedTeamQuarter(state, footprint.teamId, footprint.quarterId)) {
    return fail('QUARTER_CLOSED', { params: { quarter: footprint.quarterId } });
  }
  for (const part of parts) {
    if (closedTeamQuarter(state, footprint.teamId, part.quarterId)) {
      return fail('QUARTER_CLOSED', { params: { quarter: part.quarterId } });
    }
    // Somewhere else on this team already holds this commitment in that
    // quarter, so the split would produce two placements of one thing in one
    // container — which is what DUPLICATE_FOOTPRINT exists to prevent.
    const clash = [...state.footprints.values()].find(
      (f) =>
        isActive(f) &&
        f.id !== footprint.id &&
        f.commitmentId === footprint.commitmentId &&
        f.teamId === footprint.teamId &&
        f.quarterId === part.quarterId,
    );
    if (clash) return fail('DUPLICATE_FOOTPRINT', { params: { quarter: part.quarterId } });
  }

  // The source keeps its own quarter when the split leaves work there.
  const keepIndex = Math.max(
    0,
    parts.findIndex((part) => part.quarterId === footprint.quarterId),
  );
  const kept = parts[keepIndex]!;
  const moved = parts.filter((_, index) => index !== keepIndex);

  if (moved.length === 0) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const after = bumped(
    {
      ...footprint,
      quarterId: kept.quarterId,
      units: kept.units,
      unitsSource: 'EXPLICIT' as const,
    },
    ctx,
  );
  const sourceRef = { kind: 'CAPACITY_FOOTPRINT', id: footprint.id } as const;

  const partIds: EntityId[] = [];
  const changes: EntityChange[] = [updated(sourceRef, footprint, after)];
  const projections = new Set<ProjectionKey>([
    capacityKey(footprint.teamId, footprint.quarterId),
    capacityKey(footprint.teamId, kept.quarterId),
    commitmentKey(footprint.commitmentId),
  ]);

  moved.forEach((part, index) => {
    const reuseId = payload.reuseFootprintIds?.[index];
    const restoring = reuseId === undefined ? undefined : state.footprints.get(reuseId);

    // A part is never primary: exactly one primary footprint per commitment,
    // and the source keeps it.
    const placement = {
      commitmentId: footprint.commitmentId,
      teamId: footprint.teamId,
      quarterId: part.quarterId,
      units: part.units,
      unitsSource: 'EXPLICIT' as const,
      isPrimary: false,
    };

    if (restoring) {
      const { archivedAt: _at, archivedBy: _by, ...live } = restoring;
      const ref = { kind: 'CAPACITY_FOOTPRINT', id: restoring.id } as const;
      changes.push({
        ...updated(ref, restoring, bumped({ ...live, ...placement } as CapacityFootprint, ctx)),
        op: 'RESTORE',
      });
      partIds.push(restoring.id);
    } else {
      const fresh: CapacityFootprint = {
        ...newEnvelope(ctx.ids.next(), cmd, ctx),
        ...placement,
      };
      changes.push(created({ kind: 'CAPACITY_FOOTPRINT', id: fresh.id }, fresh));
      partIds.push(fresh.id);
    }
    projections.add(capacityKey(footprint.teamId, part.quarterId));
  });

  const commitment = state.commitments.get(footprint.commitmentId);
  return succeed({
    changes,
    events: [
      event(cmd, ctx, 0, 'FOOTPRINT_SPLIT', [sourceRef], {
        commitment: commitment?.name ?? footprint.commitmentId,
        parts: parts.length,
        units: footprint.units,
        quarters: parts.map((part) => `${part.quarterId}:${part.units}`).join(', '),
      }),
    ],
    affectedProjections: [...projections],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'MergeCapacityFootprints',
      payload: { intoFootprintId: footprint.id, fromFootprintIds: partIds },
    },
    ...splitConsequences(state, footprint, parts, keepIndex),
  });
}

// ── MergeCapacityFootprints ────────────────────────────────────────────────

export type MergeFootprintsPayload = {
  readonly intoFootprintId: EntityId;
  readonly fromFootprintIds: readonly EntityId[];
};

/**
 * Puts a split back together. Introduced as the exact inverse of
 * `SplitCapacityFootprint` — undoing a split has to restore one placement, and
 * `CommandEffects.inverse` is a single command by design.
 *
 * Not in the spec's command table; flagged as a decision taken rather than
 * smuggled in. It is deliberately narrow: same commitment, same team, units
 * conserved.
 */
export function mergeCapacityFootprints(
  state: WorkspaceState,
  payload: MergeFootprintsPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const target = state.footprints.get(payload.intoFootprintId);
  if (!target || !isActive(target)) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'CAPACITY_FOOTPRINT', id: payload.intoFootprintId },
    });
  }
  if (closedTeamQuarter(state, target.teamId, target.quarterId)) {
    return fail('QUARTER_CLOSED', { params: { quarter: target.quarterId } });
  }

  const sources: CapacityFootprint[] = [];
  for (const id of payload.fromFootprintIds) {
    const source = state.footprints.get(id);
    if (!source) return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'CAPACITY_FOOTPRINT', id } });
    if (!isActive(source)) continue;
    if (source.id === target.id) continue;
    if (source.commitmentId !== target.commitmentId || source.teamId !== target.teamId) {
      return fail('SPLIT_UNITS_MISMATCH', {
        params: { expected: target.commitmentId, actual: source.commitmentId },
      });
    }
    if (closedTeamQuarter(state, source.teamId, source.quarterId)) {
      return fail('QUARTER_CLOSED', { params: { quarter: source.quarterId } });
    }
    sources.push(source);
  }

  if (sources.length === 0) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const gained = sources.reduce((sum, source) => sum + source.units, 0);
  const after = bumped({ ...target, units: target.units + gained }, ctx);
  const targetRef = { kind: 'CAPACITY_FOOTPRINT', id: target.id } as const;

  const changes = [
    updated(targetRef, target, after),
    ...sources.map((source) =>
      archived(
        { kind: 'CAPACITY_FOOTPRINT', id: source.id },
        source,
        bumped({ ...source, archivedAt: ctx.clock.now(), archivedBy: ctx.actorId }, ctx),
      ),
    ),
  ];

  const commitment = state.commitments.get(target.commitmentId);
  return succeed({
    changes,
    events: [
      event(cmd, ctx, 0, 'FOOTPRINTS_MERGED', [targetRef], {
        commitment: commitment?.name ?? target.commitmentId,
        parts: sources.length + 1,
        units: after.units,
      }),
    ],
    affectedProjections: [
      ...new Set<ProjectionKey>([
        capacityKey(target.teamId, target.quarterId),
        ...sources.map((source) => capacityKey(source.teamId, source.quarterId)),
        commitmentKey(target.commitmentId),
      ]),
    ],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'SplitCapacityFootprint',
      payload: {
        footprintId: target.id,
        into: [
          { quarterId: target.quarterId, units: target.units },
          ...sources.map((source) => ({ quarterId: source.quarterId, units: source.units })),
        ],
        reuseFootprintIds: sources.map((source) => source.id),
      },
    },
  });
}

// ── Refinement reserve links ───────────────────────────────────────────────

export type RefinementLinkPayload = {
  readonly reserveId: EntityId;
  readonly ideaId: EntityId;
};

/**
 * Records that a refinement bucket supports an Idea.
 *
 * Qualitative only, and the constraint is the whole point: the link allocates no
 * units, creates no footprint, and changes no lifecycle. It is the only way an
 * uncommitted Idea appears on the map at all — as a connector to the reserve
 * band, and in that reserve's tooltip. See docs/spec/02-capacity-model.md §5.1.
 */
export function linkIdeaToRefinementReserve(
  state: WorkspaceState,
  payload: RefinementLinkPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  return refinementLink(state, payload, cmd, ctx, 'LINK');
}

export function unlinkIdeaFromRefinementReserve(
  state: WorkspaceState,
  payload: RefinementLinkPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  return refinementLink(state, payload, cmd, ctx, 'UNLINK');
}

function refinementLink(
  state: WorkspaceState,
  payload: RefinementLinkPayload,
  cmd: Command,
  ctx: CommandContext,
  direction: 'LINK' | 'UNLINK',
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const holder = [...state.teamQuarters.values()].find(
    (tq) => isActive(tq) && tq.reserves.some((reserve) => reserve.id === payload.reserveId),
  );
  if (!holder) {
    return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM_QUARTER', id: payload.reserveId } });
  }
  if (holder.closedAt !== undefined) {
    return fail('QUARTER_CLOSED', { params: { quarter: holder.quarterId } });
  }

  const reserve = holder.reserves.find((candidate) => candidate.id === payload.reserveId)!;
  if (reserve.type !== 'REFINEMENT') {
    return fail('REFINEMENT_LINK_NOT_PERMITTED', {
      params: { reserve: reserve.label, type: reserve.type },
    });
  }

  const idea = state.commitments.get(payload.ideaId);
  if (!idea) {
    return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'COMMITMENT', id: payload.ideaId } });
  }
  if (!isActive(idea)) return fail('ENTITY_ARCHIVED', { params: { name: idea.name } });
  // Committed work consumes a footprint, not a refinement bucket. Allowing the
  // link past the gate would put the same work in two places on the map.
  if (idea.lifecycle !== 'IDEA') {
    return fail('REFINEMENT_LINK_NOT_PERMITTED', {
      params: { name: idea.name, lifecycle: idea.lifecycle },
    });
  }

  const linked = reserve.linkedIdeaIds ?? [];
  const already = linked.includes(payload.ideaId);
  if (direction === 'LINK' ? already : !already) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const nextLinked =
    direction === 'LINK'
      ? [...linked, payload.ideaId]
      : linked.filter((id) => id !== payload.ideaId);

  const reserves: CapacityReserve[] = holder.reserves.map((candidate) =>
    candidate.id === reserve.id
      ? // Dropping the key entirely when the last link goes keeps the reserve
        // byte-identical to one that never had any, so `changedFields` stays
        // truthful and an export round-trips.
        nextLinked.length === 0
        ? withoutLinks(candidate)
        : { ...candidate, linkedIdeaIds: nextLinked }
      : candidate,
  );

  const after = bumped({ ...holder, reserves }, ctx);
  const ref = { kind: 'TEAM_QUARTER', id: holder.id } as const;

  return succeed({
    changes: [updated(ref, holder, after)],
    events: [
      event(
        cmd,
        ctx,
        0,
        direction === 'LINK' ? 'IDEA_LINKED_TO_REFINEMENT' : 'IDEA_UNLINKED_FROM_REFINEMENT',
        [ref, { kind: 'COMMITMENT', id: idea.id }],
        { idea: idea.name, reserve: reserve.label, quarter: holder.quarterId },
      ),
    ],
    // The capacity projection is untouched by design — a link allocates nothing
    // — but the reserve's tooltip and the Ideas lane both read this container.
    affectedProjections: [capacityKey(holder.teamId, holder.quarterId), commitmentKey(idea.id)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name:
        direction === 'LINK' ? 'UnlinkIdeaFromRefinementReserve' : 'LinkIdeaToRefinementReserve',
      payload,
    },
  });
}

function withoutLinks(reserve: CapacityReserve): CapacityReserve {
  const { linkedIdeaIds: _linkedIdeaIds, ...rest } = reserve;
  return rest;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/** Active teams in the order the board draws them: explicit first, name as the seed. */
function currentTeamOrder(state: WorkspaceState): Team[] {
  return [...state.teams.values()]
    .filter((team) => isActive(team) && team.active)
    .sort((a, b) =>
      a.displayOrder === b.displayOrder
        ? a.name.localeCompare(b.name)
        : a.displayOrder - b.displayOrder,
    );
}

/** One consequence per quarter a split pushes past its deliverable capacity. */
function splitConsequences(
  state: WorkspaceState,
  footprint: CapacityFootprint,
  parts: readonly { quarterId: QuarterId; units: CapacityUnits }[],
  keepIndex: number,
): Pick<CommandEffects, 'consequences'> | Record<string, never> {
  const consequences = parts.flatMap((part, index) => {
    // The source quarter gives up whatever it no longer holds; every other
    // quarter takes on the part that landed there.
    const delta = index === keepIndex ? part.units - footprint.units : part.units;
    const overflow = overflowFor(state, footprint.teamId, part.quarterId, delta);
    return overflow ? [overflow] : [];
  });

  return consequences.length > 0 ? { consequences } : {};
}

function findTeamQuarter(
  state: WorkspaceState,
  teamId: EntityId,
  quarterId: QuarterId,
): TeamQuarter | undefined {
  return [...state.teamQuarters.values()].find(
    (tq) => tq.teamId === teamId && tq.quarterId === quarterId && isActive(tq),
  );
}

function closedTeamQuarter(state: WorkspaceState, teamId: EntityId, quarterId: QuarterId): boolean {
  return findTeamQuarter(state, teamId, quarterId)?.closedAt !== undefined;
}

type ResolvedUnits =
  | { ok: true; value: { units: CapacityUnits; source: 'SIZE_MAPPING' | 'EXPLICIT' } }
  | { ok: false; error: ReturnType<typeof domainError> };

/**
 * Units win over size when both are given: an explicit number is always a
 * deliberate statement, a size is a shorthand.
 */
function resolveFootprintUnits(
  payload: { size?: RelativeSize; units?: CapacityUnits },
  state: WorkspaceState,
): ResolvedUnits {
  if (payload.units !== undefined) {
    if (!Number.isInteger(payload.units) || payload.units <= 0) {
      return {
        ok: false,
        error: domainError('FOOTPRINT_UNITS_MUST_BE_POSITIVE', { field: 'units' }),
      };
    }
    return { ok: true, value: { units: payload.units, source: 'EXPLICIT' } };
  }

  if (payload.size === undefined) {
    return {
      ok: false,
      error: domainError('FOOTPRINT_UNITS_MUST_BE_POSITIVE', { field: 'units' }),
    };
  }

  const result = resolveUnits(payload.size, state.workspace.settings.capacity.sizeMapping);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, value: { units: result.value, source: 'SIZE_MAPPING' } };
}

/**
 * Overflow is permitted and explained, never blocked (spec 02 §6). The handler
 * reports it as a consequence so the UI can open the trade-off panel.
 */
function overflowConsequence(
  state: WorkspaceState,
  teamId: EntityId,
  quarterId: QuarterId,
  loadDelta: number,
): Pick<CommandEffects, 'consequences'> | Record<string, never> {
  const overflow = overflowFor(state, teamId, quarterId, loadDelta);
  return overflow ? { consequences: [overflow] } : {};
}

function overflowFor(
  state: WorkspaceState,
  teamId: EntityId,
  quarterId: QuarterId,
  loadDelta: number,
): Consequence | null {
  const tq = findTeamQuarter(state, teamId, quarterId);
  if (!tq) return null;

  const before = summariseCapacity({
    teamQuarter: tq,
    footprints: [...state.footprints.values()],
    commitmentsById: state.commitments,
    currentQuarterId: state.workspace.currentQuarterId,
  });

  const projectedLoad = before.committedLoad + loadDelta;
  const newOverflow = Math.max(0, projectedLoad - before.deliverableCapacity);
  if (newOverflow === 0) return null;

  return { kind: 'CAPACITY', teamId, quarterId, loadDelta, newOverflow };
}

/** Spec 02 §9: management notes are capped, and the cap is a domain rule. */
const MANAGEMENT_NOTE_MAX = 2000;

// ── UpdateCommitment ───────────────────────────────────────────────────────

/**
 * The editable fields of a commitment.
 *
 * A closed set, listed explicitly rather than a `Partial<Commitment>`, because
 * lifecycle, placement and the audit envelope are all changed by their own
 * commands and must not be reachable through a generic patch. `null` clears a
 * field; omitting it leaves the field alone — the two are different, and a
 * property sheet needs to say both.
 */
export type UpdateCommitmentPayload = {
  readonly commitmentId: EntityId;
  readonly name?: string;
  readonly class?: Commitment['class'];
  readonly importance?: Commitment['importance'];
  readonly ownerRef?: OwnerRef | null;
  readonly targetQuarterId?: QuarterId | null;
  readonly targetDate?: string | null;
  readonly sizeConfidence?: Confidence | null;
  readonly timingConfidence?: Confidence | null;
  readonly scopeConfidence?: Confidence | null;
  readonly outcome?: string | null;
  readonly valueDrivers?: readonly string[];
  readonly attentionDate?: string | null;
  readonly latestSafeStart?: string | null;
  readonly nextAction?: string | null;
  readonly nextActionOwnerRef?: OwnerRef | null;
  readonly nextActionDueDate?: string | null;
  readonly managementNote?: string | null;
};

const EDITABLE_FIELDS = [
  'name',
  'class',
  'importance',
  'ownerRef',
  'targetQuarterId',
  'targetDate',
  'sizeConfidence',
  'timingConfidence',
  'scopeConfidence',
  'outcome',
  'valueDrivers',
  'attentionDate',
  'latestSafeStart',
  'nextAction',
  'nextActionOwnerRef',
  'nextActionDueDate',
  'managementNote',
] as const;

/**
 * Fields whose change means the work itself moved on, rather than someone
 * tidying a label. Only these refresh `lastMeaningfulUpdateAt`, which the
 * staleness rules read — otherwise fixing a typo would make a forgotten
 * commitment look freshly reviewed.
 */
const MEANINGFUL_FIELDS: ReadonlySet<string> = new Set([
  'targetQuarterId',
  'targetDate',
  'outcome',
  'nextAction',
  'nextActionDueDate',
  'latestSafeStart',
  'class',
  'importance',
]);

export function updateCommitment(
  state: WorkspaceState,
  payload: UpdateCommitmentPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;

  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  }
  if (!isActive(commitment)) return fail('ENTITY_ARCHIVED', { params: { name: commitment.name } });

  if (payload.name !== undefined) {
    const invalid = requireName(payload.name, 200);
    if (invalid) return invalid;
  }
  if (payload.outcome != null) {
    const invalid = requireText(payload.outcome, 500);
    if (invalid) return invalid;
  }
  if (payload.managementNote != null) {
    const invalid = requireText(payload.managementNote, MANAGEMENT_NOTE_MAX);
    if (invalid) return invalid;
  }
  if (payload.targetQuarterId != null && !isQuarterId(payload.targetQuarterId)) {
    return fail('IMPORT_INVALID_ENUM_VALUE', {
      params: { field: 'targetQuarterId', value: payload.targetQuarterId },
    });
  }

  // Build the patch from what was actually supplied. `null` clears.
  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = payload[field];
    if (value === undefined) continue;
    patch[field] = value === null ? undefined : value;
  }

  const changed = Object.keys(patch).filter(
    (field) =>
      JSON.stringify(patch[field]) !==
      JSON.stringify((commitment as unknown as Record<string, unknown>)[field]),
  );
  if (changed.length === 0) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const meaningful = changed.some((field) => MEANINGFUL_FIELDS.has(field));
  const after = bumped(
    {
      ...commitment,
      ...patch,
      ...(meaningful ? { lastMeaningfulUpdateAt: ctx.clock.now() } : {}),
    } as Commitment,
    ctx,
  );

  // Setting a date derives the quarter, per spec 02 §4 — the two must not be
  // allowed to disagree, and the date is the more precise statement.
  const withDerived =
    payload.targetDate != null && payload.targetQuarterId === undefined
      ? { ...after, targetQuarterId: quarterOfDate(payload.targetDate).id }
      : after;

  const ref = { kind: 'COMMITMENT', id: commitment.id } as const;
  const before: Record<string, unknown> = { commitmentId: commitment.id };
  for (const field of changed) {
    before[field] = (commitment as unknown as Record<string, unknown>)[field] ?? null;
  }

  return succeed({
    changes: [updated(ref, commitment, withDerived)],
    events: [
      event(cmd, ctx, 0, 'COMMITMENT_UPDATED', [ref], {
        commitment: commitment.name,
        fields: changed.join(', '),
      }),
    ],
    affectedProjections: [commitmentKey(commitment.id)],
    inverse: { ...cmd, id: ctx.ids.next(), name: 'UpdateCommitment', payload: before },
  });
}

// ── SetPrimaryTeam ─────────────────────────────────────────────────────────

export type SetPrimaryTeamPayload = {
  readonly commitmentId: EntityId;
  readonly teamId: EntityId;
};

/**
 * Which team owns this work.
 *
 * Needed because the Commit Gate requires the primary footprint to sit on the
 * primary team, and dragging an Idea onto a row is a statement about exactly
 * that: *this* team does it. Without this command the drop had to leave the
 * primary team alone, the gate refused, and the placement silently reverted —
 * so an Idea could only ever be dropped on the one row it already named.
 *
 * Deliberately narrow. It is not a general commitment editor; it changes one
 * field, and the inverse restores whatever was there before, including nothing.
 */
export function setPrimaryTeam(
  state: WorkspaceState,
  payload: SetPrimaryTeamPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const commitment = state.commitments.get(payload.commitmentId);
  if (!commitment) {
    return fail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'COMMITMENT', id: payload.commitmentId },
    });
  }
  if (!isActive(commitment)) return fail('ENTITY_ARCHIVED', { params: { name: commitment.name } });

  const team = state.teams.get(payload.teamId);
  if (!team) return fail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM', id: payload.teamId } });
  if (!isActive(team)) return fail('ENTITY_ARCHIVED', { params: { name: team.name } });

  if (commitment.primaryTeamId === payload.teamId) {
    return succeed({ changes: [], events: [], affectedProjections: [] });
  }

  const after = bumped({ ...commitment, primaryTeamId: payload.teamId }, ctx);
  const ref = { kind: 'COMMITMENT', id: commitment.id } as const;

  return succeed({
    changes: [updated(ref, commitment, after)],
    events: [
      event(cmd, ctx, 0, 'PRIMARY_TEAM_SET', [ref, { kind: 'TEAM', id: team.id }], {
        commitment: commitment.name,
        team: team.name,
      }),
    ],
    affectedProjections: [commitmentKey(commitment.id)],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'SetPrimaryTeam',
      // Restoring "no primary team" is not expressible, so the inverse is only
      // recorded when there was one to go back to.
      payload: { commitmentId: commitment.id, teamId: commitment.primaryTeamId ?? payload.teamId },
    },
  });
}

export const CAPACITY_PROJECTION_HELPERS = { deliverableCapacity, reservedTotal };
export type { ProjectionKey };
