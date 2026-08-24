/**
 * Editing the capacity a team-quarter is built from.
 *
 * Reserves are the part of a quarter that is spoken for before anyone commits
 * anything: BAU and support, refinement, overhead. They are what makes
 * `deliverableCapacity` smaller than `effectiveCapacity`, and therefore what
 * every utilisation figure on the board is measured against. Until now they
 * were seeded from a constant and could never be changed, so a team whose BAU
 * is really 30 had no way to say so and every figure it showed was wrong.
 *
 * Three levels, each one the default for the next:
 *
 *   workspace settings → team defaults → the team-quarter itself
 *
 * The lower two are overrides and both are optional: a team with no defaults of
 * its own follows the workspace, and a quarter is seeded once, at the moment it
 * is materialised, and thereafter belongs to itself. That last part is the rule
 * that matters — a default is what a *new* container starts from, never a live
 * reference. Changing a default cannot silently rewrite a quarter someone has
 * already planned against. Applying it to quarters that already exist is a
 * separate decision, and the caller makes it explicitly by asking for each one.
 *
 * Normative source: docs/spec/02-capacity-model.md §5 and 03-commands-permissions.md §3.1–3.2.
 *
 * Deviation from spec 03 §3.2, recorded deliberately: the spec lists
 * `AddReserve` / `UpdateReserve` / `RemoveReserve` as three commands over one
 * reserve each. This implements `SetTeamQuarterReserves`, which replaces the
 * list. The editor is a form over a handful of amounts, and applying a team's
 * defaults to an existing quarter is exactly a replacement — expressing either
 * as a sequence of three command types would produce several undo entries for
 * one decision, and leave the intermediate states of a partially applied set
 * observable. The guardrails the triple exists to enforce are enforced here in
 * one place instead.
 */

import { effectiveCapacity } from './capacity.js';
import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
import type { CapacityUnits, EntityId } from './primitives.js';
import type {
  CapacityReserve,
  DefaultReserve,
  ReserveType,
  Team,
  TeamQuarter,
} from './entities.js';
import { isActive } from './entities.js';
import { authorise, bumped, domainFail, event, succeed, updated } from './handler-kit.js';

/**
 * A reserve as the user describes it: a type, a label, and an amount. No id —
 * ids belong to the reserves that actually exist on a team-quarter, and are
 * preserved across an edit so a refinement reserve keeps the Ideas linked to it.
 */
export type ReserveInput = {
  readonly type: ReserveType;
  readonly label: string;
  readonly amount: CapacityUnits;
};

/** Longest a reserve label may be. Long enough to say what it is, not why. */
const MAX_LABEL = 60;

/**
 * `HOLD` reserves are created and removed by holding and resuming work, and
 * exist to keep held work's capacity visible without counting it. A person
 * editing a form must not be able to conjure or delete one.
 */
function rejectSystemManaged(reserves: readonly ReserveInput[]): CommandResult | null {
  return reserves.some((reserve) => reserve.type === 'HOLD')
    ? domainFail('RESERVE_IS_SYSTEM_MANAGED', { params: { type: 'HOLD' } })
    : null;
}

function validate(
  reserves: readonly ReserveInput[],
  capacity: CapacityUnits,
): CommandResult | null {
  const systemManaged = rejectSystemManaged(reserves);
  if (systemManaged) return systemManaged;

  for (const reserve of reserves) {
    if (!reserve.label.trim()) return domainFail('NAME_REQUIRED', { field: 'label' });
    if (reserve.label.trim().length > MAX_LABEL) {
      return domainFail('NAME_TOO_LONG', { field: 'label', params: { max: MAX_LABEL } });
    }
    // Whole and not negative. A reserve of nothing is a reserve you removed.
    if (!Number.isInteger(reserve.amount) || reserve.amount < 0) {
      return domainFail('FOOTPRINT_UNITS_MUST_BE_POSITIVE', { field: 'amount' });
    }
  }

  // The guardrail that gives the figures meaning: reserving more than the team
  // has would make deliverable capacity negative, and every ratio built on it
  // nonsense. Spec 02 §5.
  const total = reserves.reduce((sum, reserve) => sum + reserve.amount, 0);
  if (total > capacity) {
    return domainFail('RESERVES_EXCEED_CAPACITY', {
      params: { reserved: total, capacity },
    });
  }
  return null;
}

function requireCapacity(units: unknown): CommandResult | null {
  return Number.isInteger(units) && (units as number) > 0
    ? null
    : domainFail('FOOTPRINT_UNITS_MUST_BE_POSITIVE', { field: 'capacity' });
}

const cleaned = (reserves: readonly ReserveInput[]): DefaultReserve[] =>
  reserves.map((reserve) => ({
    type: reserve.type,
    label: reserve.label.trim(),
    amount: reserve.amount,
  }));

// ── SetDefaultReserves ─────────────────────────────────────────────────────

export type SetDefaultReservesPayload = {
  readonly reserves: readonly ReserveInput[];
  /** The capacity the reserves are checked against; the workspace default. */
  readonly defaultTeamQuarterCapacity?: CapacityUnits;
};

/**
 * The workspace's starting point for every team that has not overridden it.
 * Affects team-quarters created from here on, per spec 03 §3.1.
 */
export function setDefaultReserves(
  state: WorkspaceState,
  payload: SetDefaultReservesPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const capacity =
    payload.defaultTeamQuarterCapacity ??
    state.workspace.settings.capacity.defaultTeamQuarterCapacity;
  const badCapacity = requireCapacity(capacity);
  if (badCapacity) return badCapacity;

  const invalid = validate(payload.reserves, capacity);
  if (invalid) return invalid;

  const after = bumped(
    {
      ...state.workspace,
      settings: {
        ...state.workspace.settings,
        capacity: {
          ...state.workspace.settings.capacity,
          defaultTeamQuarterCapacity: capacity,
          defaultReserves: cleaned(payload.reserves),
        },
      },
    },
    ctx,
  );

  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [updated(ref, state.workspace, after)],
    events: [
      event(cmd, ctx, 0, 'DEFAULT_RESERVES_SET', [ref], {
        capacity,
        reserved: payload.reserves.reduce((sum, reserve) => sum + reserve.amount, 0),
      }),
    ],
    affectedProjections: [],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'SetDefaultReserves',
      payload: {
        reserves: state.workspace.settings.capacity.defaultReserves,
        defaultTeamQuarterCapacity: state.workspace.settings.capacity.defaultTeamQuarterCapacity,
      },
    },
  });
}

// ── SetTeamDefaults ────────────────────────────────────────────────────────

export type SetTeamDefaultsPayload = {
  readonly teamId: EntityId;
  readonly defaultQuarterCapacity?: CapacityUnits;
  /**
   * `null` clears the override and returns the team to the workspace defaults.
   * Absent leaves whatever the team already had.
   */
  readonly defaultReserves?: readonly ReserveInput[] | null;
};

/**
 * A team's own starting point. Covers spec 03 §3.2's `SetTeamDefaultCapacity`
 * and extends it to reserves, because the thing that actually differs between
 * teams is how much of the quarter is spoken for before planning starts — a
 * platform team carrying the pager is not a delivery team with the same
 * headline capacity.
 */
export function setTeamDefaults(
  state: WorkspaceState,
  payload: SetTeamDefaultsPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const team = state.teams.get(payload.teamId);
  if (!team)
    return domainFail('ENTITY_NOT_FOUND', { entityRef: { kind: 'TEAM', id: payload.teamId } });
  if (!isActive(team)) return domainFail('ENTITY_ARCHIVED', { params: { name: team.name } });

  const capacity = payload.defaultQuarterCapacity ?? team.defaultQuarterCapacity;
  const badCapacity = requireCapacity(capacity);
  if (badCapacity) return badCapacity;

  // Checked against the capacity the team will actually have, not the one it
  // has now: raising BAU and capacity together must not fail on the old figure.
  const reserves =
    payload.defaultReserves === undefined
      ? team.defaultReserves
      : payload.defaultReserves === null
        ? undefined
        : cleaned(payload.defaultReserves);

  if (reserves) {
    const invalid = validate(reserves, capacity);
    if (invalid) return invalid;
  }

  const after = bumped(
    {
      ...team,
      defaultQuarterCapacity: capacity,
      ...(reserves ? { defaultReserves: reserves } : {}),
    } as Team,
    ctx,
  );
  // A cleared override is an absent field, not an empty list: empty means "this
  // team reserves nothing", which is a different statement from "follow the
  // workspace".
  if (!reserves) delete (after as { defaultReserves?: unknown }).defaultReserves;

  const ref = { kind: 'TEAM', id: team.id } as const;
  return succeed({
    changes: [updated(ref, team, after)],
    events: [
      event(cmd, ctx, 0, 'TEAM_DEFAULTS_SET', [ref], {
        team: team.name,
        capacity,
        reserved: (reserves ?? []).reduce((sum, reserve) => sum + reserve.amount, 0),
      }),
    ],
    affectedProjections: [],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'SetTeamDefaults',
      payload: {
        teamId: team.id,
        defaultQuarterCapacity: team.defaultQuarterCapacity,
        defaultReserves: team.defaultReserves ?? null,
      },
    },
  });
}

// ── SetTeamQuarterReserves ─────────────────────────────────────────────────

export type SetTeamQuarterReservesPayload = {
  readonly teamQuarterId: EntityId;
  readonly reserves: readonly ReserveInput[];
};

/**
 * One quarter's own reserves — the exception, and the only level the figures on
 * the board are actually computed from.
 *
 * Reserves are matched to the ones already there by type, so a refinement
 * reserve keeps its id and therefore the Ideas linked to it. A type that
 * disappears takes its links with it, which is the honest reading of removing
 * the bucket they were filed under.
 */
export function setTeamQuarterReserves(
  state: WorkspaceState,
  payload: SetTeamQuarterReservesPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;

  const teamQuarter = state.teamQuarters.get(payload.teamQuarterId);
  if (!teamQuarter) {
    return domainFail('ENTITY_NOT_FOUND', {
      entityRef: { kind: 'TEAM_QUARTER', id: payload.teamQuarterId },
    });
  }
  if (teamQuarter.closedAt !== undefined) {
    return domainFail('QUARTER_CLOSED', { params: { quarter: teamQuarter.quarterId } });
  }

  // Held work's reserve is not the user's to edit, and it still occupies the
  // quarter, so it counts towards the guardrail.
  const systemManaged = teamQuarter.reserves.filter((reserve) => reserve.systemManaged);
  const held = systemManaged.reduce((sum, reserve) => sum + reserve.amount, 0);

  const invalid = validate(payload.reserves, effectiveCapacity(teamQuarter) - held);
  if (invalid) return invalid;

  const taken = new Set<EntityId>();
  const reserves: CapacityReserve[] = payload.reserves.map((reserve) => {
    const existing = teamQuarter.reserves.find(
      (candidate) =>
        !candidate.systemManaged && candidate.type === reserve.type && !taken.has(candidate.id),
    );
    if (existing) taken.add(existing.id);
    return {
      id: existing?.id ?? ctx.ids.next(),
      type: reserve.type,
      label: reserve.label.trim(),
      amount: reserve.amount,
      ...(existing?.linkedIdeaIds ? { linkedIdeaIds: existing.linkedIdeaIds } : {}),
    };
  });

  const after = bumped(
    { ...teamQuarter, reserves: [...reserves, ...systemManaged] } as TeamQuarter,
    ctx,
  );

  const ref = { kind: 'TEAM_QUARTER', id: teamQuarter.id } as const;
  return succeed({
    changes: [updated(ref, teamQuarter, after)],
    events: [
      event(cmd, ctx, 0, 'RESERVES_SET', [ref], {
        quarter: teamQuarter.quarterId,
        reserved: reserves.reduce((sum, reserve) => sum + reserve.amount, 0),
      }),
    ],
    affectedProjections: [`capacity:${teamQuarter.teamId}:${teamQuarter.quarterId}`],
    inverse: {
      ...cmd,
      id: ctx.ids.next(),
      name: 'SetTeamQuarterReserves',
      payload: {
        teamQuarterId: teamQuarter.id,
        reserves: teamQuarter.reserves
          .filter((reserve) => !reserve.systemManaged)
          .map((reserve) => ({ type: reserve.type, label: reserve.label, amount: reserve.amount })),
      },
    },
  });
}

/**
 * The reserves a team-quarter should be seeded with: the team's own, or the
 * workspace's when the team has not said otherwise.
 */
export function seedReservesFor(state: WorkspaceState, team: Team): readonly DefaultReserve[] {
  return team.defaultReserves ?? state.workspace.settings.capacity.defaultReserves;
}
