/** M6 workspace preferences that must travel through the command boundary. */

import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
import type { NotificationSettings, SavedImportMapping } from './entities.js';
import {
  authorise,
  bumped,
  domainFail,
  event,
  requireName,
  succeed,
  updated,
} from './handler-kit.js';

export type SaveImportMappingPayload = Omit<SavedImportMapping, 'id'>;

export function saveImportMapping(
  state: WorkspaceState,
  payload: SaveImportMappingPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  const nameError = requireName(payload.name, 80);
  if (nameError) return nameError;
  if (!payload.entity || payload.mappings.length === 0) {
    return domainFail('NAME_REQUIRED', { field: 'mappings' });
  }
  const current = state.workspace.settings.importMappings ?? [];
  if (
    current.some(
      (mapping) => mapping.name.toLocaleLowerCase() === payload.name.trim().toLocaleLowerCase(),
    )
  ) {
    return domainFail('DUPLICATE_NAME', { params: { name: payload.name.trim() } });
  }
  const mapping: SavedImportMapping = {
    id: ctx.ids.next(),
    name: payload.name.trim(),
    entity: payload.entity,
    mappings: structuredClone(payload.mappings),
    enumValues: structuredClone(payload.enumValues),
  };
  const after = bumped(
    {
      ...state.workspace,
      settings: { ...state.workspace.settings, importMappings: [...current, mapping] },
    },
    ctx,
  );
  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [updated(ref, state.workspace, after)],
    events: [event(cmd, ctx, 0, 'IMPORT_MAPPING_SAVED', [ref], { name: mapping.name })],
    affectedProjections: [],
  });
}

export function removeImportMapping(
  state: WorkspaceState,
  payload: { readonly mappingId: string },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  const current = state.workspace.settings.importMappings ?? [];
  const mapping = current.find((item) => item.id === payload.mappingId);
  if (!mapping) return domainFail('ENTITY_NOT_FOUND', { params: { name: payload.mappingId } });
  const after = bumped(
    {
      ...state.workspace,
      settings: {
        ...state.workspace.settings,
        importMappings: current.filter((item) => item.id !== mapping.id),
      },
    },
    ctx,
  );
  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [updated(ref, state.workspace, after)],
    events: [event(cmd, ctx, 0, 'IMPORT_MAPPING_REMOVED', [ref], { name: mapping.name })],
    affectedProjections: [],
  });
}

export function setNotificationSettings(
  state: WorkspaceState,
  payload: NotificationSettings,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  if (
    payload.quietHours &&
    (!Number.isInteger(payload.quietHours.startHour) ||
      !Number.isInteger(payload.quietHours.endHour) ||
      payload.quietHours.startHour < 0 ||
      payload.quietHours.startHour > 23 ||
      payload.quietHours.endHour < 0 ||
      payload.quietHours.endHour > 23)
  ) {
    return domainFail('NAME_REQUIRED', { field: 'quietHours' });
  }
  const after = bumped(
    { ...state.workspace, settings: { ...state.workspace.settings, notifications: payload } },
    ctx,
  );
  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [updated(ref, state.workspace, after)],
    events: [event(cmd, ctx, 0, 'NOTIFICATION_SETTINGS_CHANGED', [ref], { mode: payload.mode })],
    affectedProjections: [],
  });
}
