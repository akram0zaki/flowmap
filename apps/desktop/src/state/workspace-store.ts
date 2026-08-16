/**
 * The application store.
 *
 * Holds transient view state (selection, undo stack, status) and the loaded
 * baseline projection. Every mutation goes through `dispatch`, which runs the
 * domain handler, persists the effects, and reloads the projection — there is no
 * path from a component to the repository.
 *
 * See docs/spec/03-commands-permissions.md §1 and §5.
 */

import { create } from 'zustand';
import {
  applyTransition,
  assignCapacityFootprint,
  createIdea,
  createTeam,
  createWorkspace,
  ensureTeamQuarter,
  moveCapacityFootprint,
  removeCapacityFootprint,
  resizeCapacityFootprint,
  restoreCapacityFootprint,
  type Command,
  type CommandContext,
  type CommandResult,
  type EntityId,
  type WorkspaceState,
} from '@flowmap/domain';
import type { WorkspaceRepository } from '@flowmap/storage';

import { t } from '../i18n/t.js';
import { seedSampleWorkspace } from './sample-workspace.js';

const WORKSPACE_ID = 'flowmap-local-workspace';
const PROFILE_ID = 'local-profile';

export type Runtime = {
  readonly repository: WorkspaceRepository & {
    ensureLocalProfile?: (
      id: string,
      name: string,
      createdAt: string,
    ) => Promise<{ id: string; displayName: string }> | { id: string; displayName: string };
  };
  readonly now: () => string;
  readonly newId: () => string;
  /** Where this instance keeps its data. Surfaced in Settings; absent in browser mode. */
  readonly dataDir?: string;
  readonly portable?: boolean;
};

type Status = { readonly tone: 'info' | 'warning' | 'critical'; readonly message: string } | null;

/**
 * Where the resulting inverse goes.
 *
 * `record` is a normal edit. `undoing` pushes the new inverse onto the redo
 * stack; `redoing` pushes it back onto the undo stack. Getting this wrong makes
 * redo re-run the undo, which is exactly the bug the e2e test caught.
 */
type HistoryMode = 'record' | 'undoing' | 'redoing';

type StoreState = {
  runtime: Runtime | null;
  state: WorkspaceState | null;
  profileName: string;
  selectedFootprintId: string | null;
  status: Status;
  undoStack: Command[];
  redoStack: Command[];
  pendingCount: number;

  init(runtime: Runtime, profileName: string): Promise<void>;
  dispatch(
    name: string,
    run: (state: WorkspaceState, cmd: Command, ctx: CommandContext) => CommandResult,
    history?: HistoryMode,
  ): Promise<Command | null | false>;
  captureIdea(name: string): Promise<boolean>;
  addTeam(name: string): Promise<boolean>;
  placeFootprint(input: {
    commitmentId: EntityId;
    teamId: EntityId;
    quarterId: string;
    units?: number;
    size?: 'XS' | 'S' | 'M' | 'L' | 'XL';
    isPrimary?: boolean;
  }): Promise<boolean>;
  /**
   * Cross-team as well as cross-quarter: a drag can land anywhere on the board,
   * and the domain payload always supported both even though the first caller
   * only ever changed the quarter.
   */
  moveFootprint(
    footprintId: EntityId,
    target: { teamId?: EntityId; quarterId?: string },
  ): Promise<boolean>;
  /**
   * The drop that turns an Idea into committed work.
   *
   * Placing it and passing the gate are one gesture because they are one
   * decision — and because an Idea may not hold a capacity block on the near
   * side of the gate, so the intermediate state must not outlive the call.
   */
  commitIdeaInto(input: {
    commitmentId: EntityId;
    teamId: EntityId;
    quarterId: string;
    units: number;
  }): Promise<boolean>;
  resizeFootprint(footprintId: EntityId, units: number): Promise<boolean>;
  removeFootprint(footprintId: EntityId): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  select(footprintId: string | null): void;
  clearStatus(): void;
  clearLocalData(): Promise<void>;
  loadSample(): Promise<void>;
};

export const useWorkspace = create<StoreState>((set, get) => ({
  runtime: null,
  state: null,
  profileName: '',
  selectedFootprintId: null,
  status: null,
  undoStack: [],
  redoStack: [],
  pendingCount: 0,

  async init(runtime, profileName) {
    await runtime.repository.ensureLocalProfile?.(PROFILE_ID, profileName, runtime.now());
    set({ runtime, profileName });

    let state = await runtime.repository.load(WORKSPACE_ID);
    if (!state) {
      const cmd = makeCommand(runtime, 'CreateWorkspace');
      const result = createWorkspace(
        {
          name: 'My portfolio',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          currentQuarterId: currentQuarter(runtime.now()),
        },
        cmd,
        makeContext(runtime, 1),
      );
      if (result.ok) {
        await runtime.repository.apply({
          workspaceId: WORKSPACE_ID,
          changes: result.effects.changes,
          events: result.effects.events,
          command: cmd,
        });
      }
      state = await runtime.repository.load(WORKSPACE_ID);
    }
    set({ state });
    await refreshPending(get, set);
  },

  async dispatch(name, run, history = 'record') {
    const { runtime, state } = get();
    if (!runtime || !state) return false;

    const cmd = makeCommand(runtime, name);
    const ctx = makeContext(runtime, await runtime.repository.nextSequence(WORKSPACE_ID));
    const result = run(state, cmd, ctx);

    if (!result.ok) {
      set({
        status: {
          tone: 'critical',
          message: t(`errors.${result.error.code}`, result.error.params ?? {}),
        },
      });
      return false;
    }

    await runtime.repository.apply({
      workspaceId: WORKSPACE_ID,
      changes: result.effects.changes,
      events: result.effects.events,
      command: cmd,
    });

    const overflow = result.effects.consequences?.find((c) => c.kind === 'CAPACITY');
    const inverse = result.effects.inverse ?? null;

    set((prev) => {
      // Undo and redo are stacks of inverse commands, each re-validated when it
      // executes — so an undo that has since become illegal is refused rather
      // than corrupting state.
      const stacks =
        history === 'record'
          ? {
              undoStack: inverse ? [...prev.undoStack, inverse].slice(-100) : prev.undoStack,
              redoStack: [],
            }
          : history === 'undoing'
            ? { redoStack: inverse ? [...prev.redoStack, inverse] : prev.redoStack }
            : { undoStack: inverse ? [...prev.undoStack, inverse] : prev.undoStack };

      return {
        ...stacks,
        status:
          overflow && overflow.kind === 'CAPACITY'
            ? {
                tone: 'warning',
                message: t('capacity.overCapacity', {
                  units: overflow.newOverflow ?? 0,
                  percent: 0,
                }),
              }
            : null,
      };
    });

    set({ state: await runtime.repository.load(WORKSPACE_ID) });
    await refreshPending(get, set);
    return inverse;
  },

  async captureIdea(name) {
    return (
      (await get().dispatch('CreateIdea', (_state, cmd, ctx) => createIdea({ name }, cmd, ctx))) !==
      false
    );
  },

  async addTeam(name) {
    return (
      (await get().dispatch('CreateTeam', (state, cmd, ctx) =>
        createTeam(state, { name }, cmd, ctx),
      )) !== false
    );
  },

  async placeFootprint(input) {
    const ensured = await get().dispatch('EnsureTeamQuarter', (state, cmd, ctx) =>
      ensureTeamQuarter(
        state,
        { teamId: input.teamId, quarterId: input.quarterId as never },
        cmd,
        ctx,
      ),
    );
    if (ensured === false) return false;

    return (
      (await get().dispatch('AssignCapacityFootprint', (state, cmd, ctx) =>
        assignCapacityFootprint(
          state,
          {
            commitmentId: input.commitmentId,
            teamId: input.teamId,
            quarterId: input.quarterId as never,
            ...(input.units !== undefined ? { units: input.units } : {}),
            ...(input.size !== undefined ? { size: input.size } : {}),
            ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
          },
          cmd,
          ctx,
        ),
      )) !== false
    );
  },

  async moveFootprint(footprintId, target) {
    // MoveCapacityFootprint does not materialise its destination, unlike
    // assign. Dragging into a quarter a team has never been given lands on a
    // container that does not exist yet, so create it first.
    if (target.teamId !== undefined && target.quarterId !== undefined) {
      const ensured = await get().dispatch('EnsureTeamQuarter', (state, cmd, ctx) =>
        ensureTeamQuarter(
          state,
          { teamId: target.teamId as EntityId, quarterId: target.quarterId as never },
          cmd,
          ctx,
        ),
      );
      if (ensured === false) return false;
    }

    return (
      (await get().dispatch('MoveCapacityFootprint', (state, cmd, ctx) =>
        moveCapacityFootprint(
          state,
          {
            footprintId,
            ...(target.teamId !== undefined ? { teamId: target.teamId } : {}),
            ...(target.quarterId !== undefined ? { quarterId: target.quarterId as never } : {}),
          },
          cmd,
          ctx,
        ),
      )) !== false
    );
  },

  async commitIdeaInto(input) {
    const placed = await get().placeFootprint({
      commitmentId: input.commitmentId,
      teamId: input.teamId,
      quarterId: input.quarterId,
      units: input.units,
      isPrimary: true,
    });
    if (!placed) return false;

    const passed = await get().dispatch('PassCommitGate', (state, cmd, ctx) =>
      applyTransition('PassCommitGate', state, { commitmentId: input.commitmentId }, cmd, ctx),
    );

    // The gate refused after the footprint landed. Leaving it there would put an
    // Idea in a capacity block, which the model does not allow, so take it back
    // out — the status message from the failed gate is what the user sees.
    if (passed === false) {
      const footprint = [...(get().state?.footprints.values() ?? [])].find(
        (f) =>
          f.commitmentId === input.commitmentId &&
          f.teamId === input.teamId &&
          f.quarterId === input.quarterId &&
          f.archivedAt === undefined,
      );
      if (footprint) await get().removeFootprint(footprint.id);
      return false;
    }
    return true;
  },

  async resizeFootprint(footprintId, units) {
    return (
      (await get().dispatch('ResizeCapacityFootprint', (state, cmd, ctx) =>
        resizeCapacityFootprint(state, { footprintId, units }, cmd, ctx),
      )) !== false
    );
  },

  async removeFootprint(footprintId) {
    return (
      (await get().dispatch('RemoveCapacityFootprint', (state, cmd, ctx) =>
        removeCapacityFootprint(state, { footprintId }, cmd, ctx),
      )) !== false
    );
  },

  async undo() {
    const { undoStack } = get();
    const inverse = undoStack.at(-1);
    if (!inverse) {
      set({ status: { tone: 'info', message: t('undo.nothing') } });
      return;
    }

    set({ undoStack: undoStack.slice(0, -1) });
    await get().dispatch(
      inverse.name,
      (state, cmd, ctx) => runNamed(inverse.name, state, { ...cmd, payload: inverse.payload }, ctx),
      'undoing',
    );
  },

  async redo() {
    const { redoStack } = get();
    const inverse = redoStack.at(-1);
    if (!inverse) return;

    set({ redoStack: redoStack.slice(0, -1) });
    await get().dispatch(
      inverse.name,
      (state, cmd, ctx) => runNamed(inverse.name, state, { ...cmd, payload: inverse.payload }, ctx),
      'redoing',
    );
  },

  select(footprintId) {
    set({ selectedFootprintId: footprintId });
  },

  clearStatus() {
    set({ status: null });
  },

  async loadSample() {
    const { runtime, profileName } = get();
    if (!runtime) return;

    const report = await seedSampleWorkspace({
      repository: runtime.repository,
      workspaceId: WORKSPACE_ID,
      actorId: `local:${PROFILE_ID}`,
      now: runtime.now(),
      newId: runtime.newId,
    });

    // A sample replaces everything, so the history that produced the old state
    // no longer applies.
    set({ undoStack: [], redoStack: [], selectedFootprintId: null });
    set({ state: await runtime.repository.load(WORKSPACE_ID) });
    await refreshPending(get, set);

    set({
      status: {
        tone: 'info',
        message: t('sample.loaded', {
          teams: report.teams,
          commitments: report.commitments,
          ideas: report.ideas,
        }),
      },
      profileName,
    });
  },

  async clearLocalData() {
    const { runtime } = get();
    if (!runtime) return;
    await runtime.repository.clearLocalData(WORKSPACE_ID);
    set({ state: null, undoStack: [], redoStack: [], selectedFootprintId: null, pendingCount: 0 });
    await get().init(runtime, get().profileName);
  },
}));

async function refreshPending(get: () => StoreState, set: (partial: Partial<StoreState>) => void) {
  const { runtime } = get();
  if (!runtime) return;
  set({ pendingCount: (await runtime.repository.listOutbox(WORKSPACE_ID, 'PENDING')).length });
}

/**
 * Undo executes the recorded inverse as a normal command, so an undo that would
 * now be illegal is refused with an explanation rather than corrupting state.
 */
function runNamed(
  name: string,
  state: WorkspaceState,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const payload = cmd.payload as Record<string, never>;
  switch (name) {
    case 'CreateIdea':
      return createIdea(payload as never, cmd, ctx);
    case 'CreateTeam':
      return createTeam(state, payload as never, cmd, ctx);
    case 'AssignCapacityFootprint':
      return assignCapacityFootprint(state, payload as never, cmd, ctx);
    case 'MoveCapacityFootprint':
      return moveCapacityFootprint(state, payload as never, cmd, ctx);
    case 'ResizeCapacityFootprint':
      return resizeCapacityFootprint(state, payload as never, cmd, ctx);
    case 'RemoveCapacityFootprint':
    case 'ArchiveCommitment':
    case 'ArchiveTeam':
      return removeCapacityFootprint(state, payload as never, cmd, ctx);
    case 'RestoreCapacityFootprint':
      return restoreCapacityFootprint(state, payload as never, cmd, ctx);
    // Every lifecycle transition is its own inverse's handler. Without these,
    // committing an Idea produced a RevertCommitGate inverse that undo could
    // not run, so the action looked undoable and silently was not.
    case 'PassCommitGate':
    case 'RevertCommitGate':
    case 'StartDelivery':
    case 'CorrectToCommitted':
    case 'HoldCommitment':
    case 'ResumeCommitment':
    case 'CompleteCommitment':
    case 'DropCommitment':
      return applyTransition(name, state, payload as never, cmd, ctx);
    default:
      return {
        ok: false,
        error: { code: 'ENTITY_NOT_FOUND', messageKey: 'error.ENTITY_NOT_FOUND' },
      };
  }
}

function makeCommand(runtime: Runtime, name: string): Command {
  return {
    id: runtime.newId(),
    name,
    workspaceId: WORKSPACE_ID,
    payload: {},
    actorId: `local:${PROFILE_ID}`,
    issuedAt: runtime.now(),
  };
}

function makeContext(runtime: Runtime, nextSequence: number): CommandContext {
  return {
    clock: { now: runtime.now, today: () => runtime.now().slice(0, 10) },
    ids: { next: runtime.newId },
    actorId: `local:${PROFILE_ID}`,
    role: 'PLANNER',
    nextSequence,
  };
}

function currentQuarter(nowIso: string): `${number}-Q${1 | 2 | 3 | 4}` {
  const date = new Date(nowIso);
  const year = date.getUTCFullYear();
  const quarter = (Math.floor(date.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return `${year}-Q${quarter}`;
}

export { WORKSPACE_ID };
