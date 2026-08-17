/** Persisted, data-free view presets. See docs/spec/09-import-export.md §7. */

import type { Command, CommandContext, CommandResult, WorkspaceState } from './command.js';
import type { SavedView } from './entities.js';
import {
  authorise,
  bumped,
  domainFail,
  event,
  requireName,
  succeed,
  updated,
} from './handler-kit.js';

export type SaveViewPayload = {
  readonly name: string;
  readonly lens: string;
  readonly filters: Readonly<Record<string, readonly string[]>>;
};

export function saveView(
  state: WorkspaceState,
  payload: SaveViewPayload,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  const nameError = requireName(payload.name, 80);
  if (nameError) return nameError;
  if (!payload.lens.trim()) return domainFail('NAME_REQUIRED', { field: 'lens' });

  const existing = state.workspace.settings.savedViews ?? [];
  if (
    existing.some(
      (view) => view.name.toLocaleLowerCase() === payload.name.trim().toLocaleLowerCase(),
    )
  ) {
    return domainFail('DUPLICATE_NAME', { params: { name: payload.name.trim() } });
  }
  const view: SavedView = {
    id: ctx.ids.next(),
    name: payload.name.trim(),
    lens: payload.lens,
    filters: structuredClone(payload.filters),
  };
  const after = bumped(
    {
      ...state.workspace,
      settings: { ...state.workspace.settings, savedViews: [...existing, view] },
    },
    ctx,
  );
  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [updated(ref, state.workspace, after)],
    events: [event(cmd, ctx, 0, 'VIEW_SAVED', [ref], { name: view.name, lens: view.lens })],
    affectedProjections: [],
  });
}

export function removeSavedView(
  state: WorkspaceState,
  payload: { readonly viewId: string },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  const existing = state.workspace.settings.savedViews ?? [];
  const view = existing.find((candidate) => candidate.id === payload.viewId);
  if (!view) return domainFail('ENTITY_NOT_FOUND', { params: { name: payload.viewId } });
  const after = bumped(
    {
      ...state.workspace,
      settings: {
        ...state.workspace.settings,
        savedViews: existing.filter((candidate) => candidate.id !== view.id),
      },
    },
    ctx,
  );
  const ref = { kind: 'WORKSPACE', id: state.workspace.id } as const;
  return succeed({
    changes: [updated(ref, state.workspace, after)],
    events: [event(cmd, ctx, 0, 'VIEW_REMOVED', [ref], { name: view.name })],
    affectedProjections: [],
  });
}
