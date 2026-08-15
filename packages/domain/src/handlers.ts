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
  type Commitment,
  type Team,
  type TeamQuarter,
  type Workspace,
} from './entities.js';
import type {
  Command,
  CommandContext,
  CommandEffects,
  CommandResult,
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
  succeed,
  updated,
} from './handler-kit.js';
import { domainError } from './errors.js';
import { capacityKey, commitmentKey, type ProjectionKey } from './refs.js';
import { deliverableCapacity, reservedTotal, resolveUnits, summariseCapacity } from './capacity.js';
import type { CapacityUnits, EntityId, RelativeSize } from './primitives.js';
import { isQuarterId, type QuarterId } from './quarter.js';

// ── CreateWorkspace ────────────────────────────────────────────────────────

export type CreateWorkspacePayload = {
  readonly name: string;
  readonly timezone: string;
  readonly currentQuarterId: QuarterId;
  readonly isSample?: boolean;
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
  return succeed({
    changes: [created(ref, workspace)],
    events: [event(cmd, ctx, 0, 'WORKSPACE_CREATED', [ref], { name: workspace.name })],
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

// ── Shared helpers ─────────────────────────────────────────────────────────

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
  const tq = findTeamQuarter(state, teamId, quarterId);
  if (!tq) return {};

  const before = summariseCapacity({
    teamQuarter: tq,
    footprints: [...state.footprints.values()],
    commitmentsById: state.commitments,
    currentQuarterId: state.workspace.currentQuarterId,
  });

  const projectedLoad = before.committedLoad + loadDelta;
  const newOverflow = Math.max(0, projectedLoad - before.deliverableCapacity);
  if (newOverflow === 0) return {};

  return {
    consequences: [{ kind: 'CAPACITY', teamId, quarterId, loadDelta, newOverflow }],
  };
}

export const CAPACITY_PROJECTION_HELPERS = { deliverableCapacity, reservedTotal };
export type { ProjectionKey };
