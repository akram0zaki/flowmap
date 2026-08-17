/**
 * Advisory workspace roles. The shared folder's permissions are the real
 * boundary; these roles stop accidents inside Flowmap.
 *
 * See docs/spec/08-providers.md §4.1 and 03-commands-permissions.md §7.
 */

import type { WorkspaceRole, WorkspaceUser } from './entities.js';
import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
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
import type { EntityId } from './primitives.js';
import { ROLE_ORDER } from './command.js';

export function roleFor(
  state: WorkspaceState | null | undefined,
  identitySubject: string,
): WorkspaceRole {
  const users = state?.workspaceUsers;
  if (!users || users.size === 0) return 'PLANNER';
  for (const user of users.values()) {
    if (user.identitySubject === identitySubject && user.deletedAt === undefined) return user.role;
  }
  return 'VIEWER';
}

export function setWorkspaceRole(
  state: WorkspaceState,
  payload: {
    readonly identitySubject: string;
    readonly displayName: string;
    readonly role: WorkspaceRole;
    readonly personId?: EntityId;
    readonly userId?: EntityId;
  },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const denied = authorise(ctx, 'ADMIN');
  if (denied) return denied;
  if (!ROLE_ORDER.includes(payload.role)) {
    return domainFail('NAME_REQUIRED', { field: 'role' });
  }
  const existing = [...(state.workspaceUsers?.values() ?? [])].find(
    (user) => user.identitySubject === payload.identitySubject && user.deletedAt === undefined,
  );
  if (existing) {
    const after = bumped(
      {
        ...existing,
        role: payload.role,
        displayName: payload.displayName.trim() || existing.displayName,
        ...(payload.personId !== undefined ? { personId: payload.personId } : {}),
      },
      ctx,
    );
    const ref = { kind: 'WORKSPACE_USER', id: existing.id } as const;
    return succeed({
      changes: [updated(ref, existing, after)],
      events: [
        event(cmd, ctx, 0, 'WORKSPACE_ROLE_SET', [ref], {
          identitySubject: payload.identitySubject,
          role: payload.role,
        }),
      ],
      affectedProjections: [],
    });
  }
  const createdUser: WorkspaceUser = {
    ...newEnvelope(payload.userId ?? ctx.ids.next(), cmd, ctx),
    identitySubject: payload.identitySubject,
    displayName: payload.displayName.trim() || payload.identitySubject,
    role: payload.role,
    ...(payload.personId !== undefined ? { personId: payload.personId } : {}),
  };
  const ref = { kind: 'WORKSPACE_USER', id: createdUser.id } as const;
  return succeed({
    changes: [created(ref, createdUser)],
    events: [
      event(cmd, ctx, 0, 'WORKSPACE_ROLE_SET', [ref], {
        identitySubject: payload.identitySubject,
        role: payload.role,
      }),
    ],
    affectedProjections: [],
  });
}

export function resolveSyncConflict(
  state: WorkspaceState,
  payload: {
    readonly kind: string;
    readonly id: EntityId;
    readonly field: string;
    readonly value: unknown;
  },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const denied = authorise(ctx, 'CONTRIBUTOR');
  if (denied) return denied;
  const before = entityOf(state, payload.kind, payload.id);
  if (!before) {
    return domainFail('ENTITY_NOT_FOUND', {
      entityRef: { kind: payload.kind, id: payload.id } as never,
    });
  }
  const after = bumped(
    { ...before, [payload.field]: payload.value } as typeof before & { entityVersion: number },
    ctx,
  );
  const ref = { kind: payload.kind, id: payload.id } as never;
  return succeed({
    changes: [updated(ref, before, after)],
    events: [
      event(cmd, ctx, 0, 'SYNC_CONFLICT_RESOLVED', [ref], {
        field: payload.field,
      }),
    ],
    affectedProjections: [],
  });
}

function entityOf(
  state: WorkspaceState,
  kind: string,
  id: EntityId,
): Record<string, unknown> | undefined {
  if (kind === 'WORKSPACE' && state.workspace.id === id) {
    return state.workspace as unknown as Record<string, unknown>;
  }
  const maps: Record<string, ReadonlyMap<EntityId, unknown> | undefined> = {
    TEAM: state.teams,
    TEAM_QUARTER: state.teamQuarters,
    COMMITMENT: state.commitments,
    CAPACITY_FOOTPRINT: state.footprints,
    PRODUCT_SERVICE: state.products,
    PRODUCT_IMPACT: state.productImpacts,
    DEPENDENCY: state.dependencies,
    DECISION: state.decisions,
    MILESTONE: state.milestones,
    THEME: state.themes,
    COMMITMENT_THEME: state.commitmentThemes,
    EXTERNAL_LINK: state.externalLinks,
    PERSON: state.people,
    SIGNAL_DISPOSITION: state.signalDispositions,
    SCENARIO: state.scenarios,
    WORKSPACE_USER: state.workspaceUsers,
  };
  const found = maps[kind]?.get(id);
  return found as Record<string, unknown> | undefined;
}
