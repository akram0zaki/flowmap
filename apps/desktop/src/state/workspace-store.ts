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
  applyScenario as applyScenarioBatch,
  assignCapacityFootprint,
  baselineProjection,
  createIdea,
  createScenario,
  cloneScenario,
  createTeam,
  createWorkspace,
  ensureTeamQuarter,
  linkIdeaToRefinementReserve,
  mergeCapacityFootprints,
  moveCapacityFootprint,
  removeCapacityFootprint,
  reorderTeams,
  resizeCapacityFootprint,
  projectScenario,
  recordScenarioCommand,
  rebaseScenario as rebaseScenarioDraft,
  classifyScenarioRebase,
  restoreCapacityFootprint,
  setPrimaryTeam,
  splitCapacityFootprint,
  unlinkIdeaFromRefinementReserve,
  updateCommitment,
  updateScenario,
  type Command,
  type CommandContext,
  type CommandResult,
  type DomainEvent,
  type EntityId,
  type QuarterId,
  type WorkspaceState,
  type ScenarioProjection,
  type RebaseOutcome,
  type RebaseResolution,
} from '@flowmap/domain';
import {
  clearSignalDisposition,
  reviewSignal,
  snoozeSignal,
  type SignalState,
  type Severity,
} from '@flowmap/domain';
import {
  addDependency,
  addExternalLink,
  addMilestone,
  removeDependency,
  removeExternalLink,
  removeMilestone,
  removeProductImpact,
  setCommitmentThemes,
  setProductImpact,
  updateDependency,
  updateMilestone,
  type RelationState,
} from '@flowmap/domain';
import type { WorkspaceRepository } from '@flowmap/storage';

import { t } from '../i18n/t.js';
import { seedSampleWorkspace } from './sample-workspace.js';

const WORKSPACE_ID = 'flowmap-local-workspace';

/**
 * One user action, however many commands it takes.
 *
 * Depth, not a boolean, because a step can call another action that is itself
 * a step — unplacing calls `removeFootprint`, which is a perfectly good action
 * on its own. `stepStarted` marks the first command, which opens the step; the
 * rest join it.
 */
let stepDepth = 0;
let stepStarted = false;

async function runAsStep<T>(run: () => Promise<T>): Promise<T> {
  const outermost = stepDepth === 0;
  stepDepth += 1;
  if (outermost) stepStarted = false;
  try {
    return await run();
  } finally {
    stepDepth -= 1;
    if (stepDepth === 0) stepStarted = false;
  }
}
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
  /**
   * Hands an https link to the operating system.
   *
   * Enterprise systems are referenced, never embedded (spec 10 §4): the record
   * stays in the system it came from, and Flowmap does not become a browser. On
   * desktop this is the Tauri opener plugin; in the browser it is a new tab.
   */
  readonly openExternal?: (url: string) => Promise<void>;
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
  /**
   * Steps, not commands. One user action can be several commands — taking work
   * off the board is a revert plus a removal — and undoing half of it leaves a
   * state the model forbids: an Idea sitting in a capacity block, visible on
   * the board and in the demand lane at the same time. A step undoes whole.
   */
  undoStack: Command[][];
  redoStack: Command[][];
  pendingCount: number;
  /** Presentation is a hard edit boundary, not merely hidden chrome. */
  presentationMode: boolean;
  setPresentationMode(enabled: boolean): void;

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
  /**
   * Divide a placement across quarters, keeping the total the same.
   *
   * Distinct from resize, which changes how much work there is, and from move,
   * which changes where all of it sits. Splitting says the work happens in both
   * quarters — which is the honest answer more often than either alternative.
   */
  splitFootprint(footprintId: EntityId, toQuarterId: string, units: number): Promise<boolean>;
  removeFootprint(footprintId: EntityId): Promise<boolean>;
  /** The Planner's explicit row order. Pressure never reshuffles rows. */
  moveTeamRow(teamId: EntityId, direction: -1 | 1): Promise<boolean>;
  /** Which Ideas a refinement reserve is shaping. Qualitative: no units move. */
  linkIdeaToRefinement(reserveId: EntityId, ideaId: EntityId): Promise<boolean>;
  unlinkIdeaFromRefinement(reserveId: EntityId, ideaId: EntityId): Promise<boolean>;
  /** Full-set replace, because that is how the property sheet is used. */
  setThemes(commitmentId: EntityId, themeIds: readonly EntityId[]): Promise<boolean>;
  /** Hands an https link to the OS. Never embedded, never navigated to in-app. */
  openLink(url: string): Promise<void>;
  /**
   * Signal dispositions.
   *
   * `Reviewed — no change` records the fingerprint and severity it was taken
   * at, which is what lets it expire when the situation changes rather than on
   * a timer. There is deliberately no dismiss.
   */
  reviewSignal(input: {
    signalKey: string;
    atFingerprint: string;
    atSeverity: Severity;
    note?: string;
  }): Promise<boolean>;
  snoozeSignal(input: {
    signalKey: string;
    atFingerprint: string;
    atSeverity: Severity;
    snoozeUntil: string;
  }): Promise<boolean>;
  clearSignal(signalKey: string): Promise<boolean>;
  /** Events, for the rules a snapshot cannot answer. Loaded alongside state. */
  events: DomainEvent[];
  /**
   * Take work off the board.
   *
   * Not a delete: the commitment survives, and when this was its last placement
   * it goes back through the gate into the demand lane, where it can be placed
   * again. Dropping work for good is `DropCommitment`, a different decision.
   */
  unplaceFootprint(input: {
    footprintId: EntityId;
    commitmentId: EntityId;
    returnToRail: boolean;
  }): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Edit a commitment's own fields. The property sheet's only write path. */
  editCommitment(commitmentId: EntityId, patch: Record<string, unknown>): Promise<boolean>;
  /**
   * Relations: impacts, dependencies, milestones and links.
   *
   * One entry point rather than ten store methods, because they all share the
   * same shape — take the relation view of state, run a handler, persist.
   */
  relate(
    name: string,
    run: (state: RelationState, cmd: Command, ctx: CommandContext) => CommandResult,
  ): Promise<boolean>;
  /** Take an Idea through the Commit Gate from the panel. */
  passGate(commitmentId: EntityId): Promise<boolean>;
  /**
   * Work that arrived mid-quarter and is already real.
   *
   * Captured, placed and committed as one step — three commands, one undo. It
   * stops at COMMITTED deliberately: creating straight into IN_DELIVERY would
   * mean work that was never committed to anything, and the capacity it is
   * consuming would have no record of having been agreed.
   */
  captureUnplanned(input: {
    name: string;
    teamId: EntityId;
    quarterId: string;
    units: number;
  }): Promise<boolean>;
  select(footprintId: string | null): void;
  clearStatus(): void;
  clearLocalData(): Promise<void>;
  loadSample(scale?: 25 | 100 | 500): Promise<void>;
  createScenario(): Promise<boolean>;
  discardScenario(scenarioId: EntityId): Promise<boolean>;
  shareScenario(scenarioId: EntityId): Promise<boolean>;
  cloneScenario(scenarioId: EntityId): Promise<boolean>;
  scenarioProjection(scenarioId: EntityId): ScenarioProjection | null;
  placeScenarioIdea(input: { scenarioId: EntityId; commitmentId: EntityId; teamId: EntityId; quarterId: string; units: number }): Promise<boolean>;
  /** Applies a current scenario atomically. An irreversible apply clears local undo history. */
  applyScenario(scenarioId: EntityId): Promise<boolean>;
  getScenarioRebase(scenarioId: EntityId): readonly RebaseOutcome[];
  rebaseScenario(scenarioId: EntityId, resolutions: readonly RebaseResolution[]): Promise<boolean>;
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
  presentationMode: false,
  events: [],

  setPresentationMode(enabled) {
    set({ presentationMode: enabled });
  },

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
    set({ state, events: await runtime.repository.listEvents(WORKSPACE_ID, 500) });
    await refreshPending(get, set);
  },

  async dispatch(name, run, history = 'record') {
    const { runtime, state } = get();
    if (!runtime || !state) return false;
    if (get().presentationMode) {
      set({ status: { tone: 'info', message: t('scenario.presentationBlocked') } });
      return false;
    }

    // Whether this command joins the step already being built.
    const grouping = stepDepth > 0 && stepStarted;

    const cmd = makeCommand(runtime, name);
    const ctx = makeContext(runtime, await runtime.repository.nextSequence(WORKSPACE_ID));
    let result = run(state, cmd, ctx);

    if (!result.ok) {
      set({
        status: {
          tone: 'critical',
          message: t(`errors.${result.error.code}`, result.error.params ?? {}),
        },
      });
      return false;
    }

    result = withBaselineRevision(state, name, result, ctx);

    const irreversible = result.effects.consequences?.some((consequence) => consequence.kind === 'IRREVERSIBLE') ?? false;
    await runtime.repository.apply({
      workspaceId: WORKSPACE_ID,
      changes: result.effects.changes,
      events: result.effects.events,
      command: cmd,
      ...(irreversible ? {
        preSnapshot: {
          id: runtime.newId(), workspaceId: WORKSPACE_ID,
          workspaceRevision: state.workspace.revision, createdAt: runtime.now(), commandName: name, state,
        },
      } : {}),
    });

    const overflow = result.effects.consequences?.find((c) => c.kind === 'CAPACITY');
    const inverse = result.effects.inverse ?? null;

    // A command that contributes no inverse neither opens a step nor joins one.
    // Setting this unconditionally meant a step whose *first* command had no
    // inverse — `EnsureTeamQuarter` opens almost every placement — marked the
    // step started anyway, so the next inverse was appended to the *previous*
    // step. One undo then reversed two unrelated actions.
    if (stepDepth > 0 && inverse) stepStarted = true;

    set((prev) => {
      // Undo and redo are stacks of inverse commands, each re-validated when it
      // executes — so an undo that has since become illegal is refused rather
      // than corrupting state.
      // Inside a step, inverses accumulate onto the step being built rather
      // than each becoming an undo of its own.
      const append = (stack: Command[][]): Command[][] => {
        if (!inverse) return stack;
        if (!grouping) return [...stack, [inverse]];
        const head = stack.at(-1) ?? [];
        return [...stack.slice(0, -1), [...head, inverse]];
      };

      const stacks = irreversible
        ? { undoStack: [], redoStack: [] }
        :
        history === 'record'
          ? { undoStack: append(prev.undoStack).slice(-100), redoStack: [] }
          : history === 'undoing'
            ? { redoStack: append(prev.redoStack) }
            : { undoStack: append(prev.undoStack) };

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

    set({
      state: await runtime.repository.load(WORKSPACE_ID),
      events: await runtime.repository.listEvents(WORKSPACE_ID, 500),
    });
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
    return runAsStep(async () => {
      // Dropping work on a row says that team does it. The Commit Gate requires
      // the primary footprint to sit on the primary team, so without this an Idea
      // could only be dropped on the one row it already named — and the gate
      // refused everywhere else in complete silence.
      const commitment = get().state?.commitments.get(input.commitmentId);
      if (commitment && commitment.primaryTeamId !== input.teamId) {
        const owned = await get().dispatch('SetPrimaryTeam', (state, cmd, ctx) =>
          setPrimaryTeam(
            state,
            { commitmentId: input.commitmentId, teamId: input.teamId },
            cmd,
            ctx,
          ),
        );
        if (owned === false) return false;
      }

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
        // Keep the gate's explanation. The rollback below is a *successful*
        // command, and a successful dispatch clears the status — so undoing the
        // footprint also erased the only account of why the drop failed, and the
        // whole gesture appeared to do nothing at all.
        const reason = get().status;
        const footprint = [...(get().state?.footprints.values() ?? [])].find(
          (f) =>
            f.commitmentId === input.commitmentId &&
            f.teamId === input.teamId &&
            f.quarterId === input.quarterId &&
            f.archivedAt === undefined,
        );
        if (footprint) await get().removeFootprint(footprint.id);
        if (reason) set({ status: reason });
        return false;
      }
      return true;
    });
  },

  async resizeFootprint(footprintId, units) {
    return (
      (await get().dispatch('ResizeCapacityFootprint', (state, cmd, ctx) =>
        resizeCapacityFootprint(state, { footprintId, units }, cmd, ctx),
      )) !== false
    );
  },

  async splitFootprint(footprintId, toQuarterId, units) {
    const footprint = get().state?.footprints.get(footprintId);
    if (!footprint) return false;

    return runAsStep(async () => {
      // The destination container may never have been created. Split does not
      // materialise it, for the same reason move does not.
      const ensured = await get().dispatch('EnsureTeamQuarter', (state, cmd, ctx) =>
        ensureTeamQuarter(
          state,
          { teamId: footprint.teamId, quarterId: toQuarterId as never },
          cmd,
          ctx,
        ),
      );
      if (ensured === false) return false;

      return (
        (await get().dispatch('SplitCapacityFootprint', (state, cmd, ctx) =>
          splitCapacityFootprint(
            state,
            {
              footprintId,
              into: [
                { quarterId: footprint.quarterId, units: footprint.units - units },
                { quarterId: toQuarterId as QuarterId, units },
              ],
            },
            cmd,
            ctx,
          ),
        )) !== false
      );
    });
  },

  async removeFootprint(footprintId) {
    return (
      (await get().dispatch('RemoveCapacityFootprint', (state, cmd, ctx) =>
        removeCapacityFootprint(state, { footprintId }, cmd, ctx),
      )) !== false
    );
  },

  async moveTeamRow(teamId, direction) {
    const current = activeTeamOrder(get().state);
    const from = current.indexOf(teamId);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= current.length) return false;

    const next = [...current];
    next.splice(to, 0, ...next.splice(from, 1));

    return (
      (await get().dispatch('ReorderTeams', (state, cmd, ctx) =>
        reorderTeams(state, { orderedTeamIds: next }, cmd, ctx),
      )) !== false
    );
  },

  async linkIdeaToRefinement(reserveId, ideaId) {
    return (
      (await get().dispatch('LinkIdeaToRefinementReserve', (state, cmd, ctx) =>
        linkIdeaToRefinementReserve(state, { reserveId, ideaId }, cmd, ctx),
      )) !== false
    );
  },

  async unlinkIdeaFromRefinement(reserveId, ideaId) {
    return (
      (await get().dispatch('UnlinkIdeaFromRefinementReserve', (state, cmd, ctx) =>
        unlinkIdeaFromRefinementReserve(state, { reserveId, ideaId }, cmd, ctx),
      )) !== false
    );
  },

  async setThemes(commitmentId, themeIds) {
    return get().relate('SetCommitmentThemes', (state, cmd, ctx) =>
      setCommitmentThemes(state, { commitmentId, themeIds }, cmd, ctx),
    );
  },

  async reviewSignal(input) {
    return (
      (await get().dispatch('ReviewSignal', (state, cmd, ctx) =>
        reviewSignal(state as SignalState, input, cmd, ctx),
      )) !== false
    );
  },

  async snoozeSignal(input) {
    return (
      (await get().dispatch('SnoozeSignal', (state, cmd, ctx) =>
        snoozeSignal(state as SignalState, input, cmd, ctx),
      )) !== false
    );
  },

  async clearSignal(signalKey) {
    return (
      (await get().dispatch('ClearSignalDisposition', (state, cmd, ctx) =>
        clearSignalDisposition(state as SignalState, { signalKey }, cmd, ctx),
      )) !== false
    );
  },

  async openLink(url) {
    const { runtime } = get();
    // Refused here as well as in the domain, so a link that somehow got stored
    // over plain http still never reaches the operating system.
    if (!url.startsWith('https://')) {
      set({ status: { tone: 'critical', message: t('panel.linkMustBeHttps') } });
      return;
    }

    try {
      if (runtime?.openExternal) await runtime.openExternal(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // A blocked opener must not look like a link that does nothing.
      set({ status: { tone: 'warning', message: t('panel.linkOpenFailed', { url }) } });
    }
  },

  async unplaceFootprint({ footprintId, commitmentId, returnToRail }) {
    return runAsStep(async () => {
      // Revert first, while the footprint still exists. Reverting afterwards
      // would leave a window where a COMMITTED commitment holds no placement.
      if (returnToRail) {
        const reverted = await get().dispatch('RevertCommitGate', (state, cmd, ctx) =>
          applyTransition('RevertCommitGate', state, { commitmentId }, cmd, ctx),
        );
        if (reverted === false) return false;
      }
      return get().removeFootprint(footprintId);
    });
  },

  async undo() {
    const { undoStack } = get();
    const step = undoStack.at(-1);
    if (!step || step.length === 0) {
      set({ status: { tone: 'info', message: t('undo.nothing') } });
      return;
    }

    set({ undoStack: undoStack.slice(0, -1) });
    // Last command first: the inverses of a step have to run in reverse, or a
    // revert lands before the removal it was meant to precede.
    await runAsStep(async () => {
      for (const inverse of [...step].reverse()) {
        await get().dispatch(
          inverse.name,
          (state, cmd, ctx) =>
            runNamed(inverse.name, state, { ...cmd, payload: inverse.payload }, ctx),
          'undoing',
        );
      }
    });
  },

  async redo() {
    const { redoStack } = get();
    const step = redoStack.at(-1);
    if (!step || step.length === 0) return;

    set({ redoStack: redoStack.slice(0, -1) });
    await runAsStep(async () => {
      for (const inverse of [...step].reverse()) {
        await get().dispatch(
          inverse.name,
          (state, cmd, ctx) =>
            runNamed(inverse.name, state, { ...cmd, payload: inverse.payload }, ctx),
          'redoing',
        );
      }
    });
  },

  async editCommitment(commitmentId, patch) {
    return (
      (await get().dispatch('UpdateCommitment', (state, cmd, ctx) =>
        updateCommitment(state, { commitmentId, ...patch } as never, cmd, ctx),
      )) !== false
    );
  },

  async relate(name, run) {
    return (
      (await get().dispatch(name, (state, cmd, ctx) => run(relationView(state), cmd, ctx))) !==
      false
    );
  },

  async captureUnplanned(input) {
    return runAsStep(async () => {
      const before = new Set(get().state?.commitments.keys() ?? []);
      if (!(await get().captureIdea(input.name))) return false;

      const created = [...(get().state?.commitments.values() ?? [])].find(
        (commitment) => !before.has(commitment.id) && commitment.name === input.name,
      );
      if (!created) return false;

      return get().commitIdeaInto({
        commitmentId: created.id,
        teamId: input.teamId,
        quarterId: input.quarterId,
        units: input.units,
      });
    });
  },

  async passGate(commitmentId) {
    return (
      (await get().dispatch('PassCommitGate', (state, cmd, ctx) =>
        applyTransition('PassCommitGate', state, { commitmentId }, cmd, ctx),
      )) !== false
    );
  },

  select(footprintId) {
    set({ selectedFootprintId: footprintId });
  },

  clearStatus() {
    set({ status: null });
  },

  async loadSample(scale) {
    const { runtime, profileName } = get();
    if (!runtime) return;

    const report = await seedSampleWorkspace({
      ...(scale !== undefined ? { scale } : {}),
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

  async createScenario() {
    const { runtime, profileName } = get();
    if (!runtime) return false;
    const date = runtime.now().slice(0, 10);
    return (
      (await get().dispatch('CreateScenario', (state, cmd, ctx) =>
        createScenario(state, { name: `Scenario — ${date} — ${profileName}`, ownerUserId: ctx.actorId }, cmd, ctx),
      )) !== false
    );
  },

  async discardScenario(scenarioId) {
    return (
      (await get().dispatch('DiscardScenario', (state, cmd, ctx) =>
        updateScenario(state, { scenarioId, status: 'DISCARDED' }, cmd, ctx),
      )) !== false
    );
  },

  async shareScenario(scenarioId) {
    return (
      (await get().dispatch('ShareScenario', (state, cmd, ctx) =>
        updateScenario(state, { scenarioId, visibility: 'SHARED', status: 'SHARED' }, cmd, ctx),
      )) !== false
    );
  },

  async cloneScenario(scenarioId) {
    return (
      (await get().dispatch('CloneScenario', (state, cmd, ctx) =>
        cloneScenario(state, scenarioId, cmd, ctx),
      )) !== false
    );
  },

  scenarioProjection(scenarioId) {
    const { runtime, state } = get();
    const scenario = state?.scenarios?.get(scenarioId);
    if (!runtime || !state || !scenario) return null;
    return projectScenario(baselineProjection(state), scenario, (projection, recorded) => {
      const { scenarioId: _scenarioId, ...baselineCommand } = recorded;
      return runNamed(recorded.name, projection, baselineCommand, makeContext(runtime, 1));
    });
  },

  async placeScenarioIdea(input) {
    const { runtime, state } = get();
    if (!runtime || !state) return false;
    const scenario = state.scenarios?.get(input.scenarioId);
    if (!scenario) return false;
    const projected = get().scenarioProjection(input.scenarioId);
    if (!projected) return false;
    const idea = projected.commitments.get(input.commitmentId);
    if (!idea || idea.lifecycle !== 'IDEA') return false;
    const drafts: Command[] = [];
    if (idea.primaryTeamId !== input.teamId) {
      drafts.push({
        ...makeCommand(runtime, 'SetPrimaryTeam'), scenarioId: input.scenarioId,
        payload: { commitmentId: input.commitmentId, teamId: input.teamId },
      });
    }
    drafts.push({
      ...makeCommand(runtime, 'AssignCapacityFootprint'),
      scenarioId: input.scenarioId,
      payload: {
        commitmentId: input.commitmentId,
        teamId: input.teamId,
        quarterId: input.quarterId as QuarterId,
        units: input.units,
        isPrimary: true,
      },
    });
    // The gate remains an intent while projected, so the block is still a
    // ghost. It is realised only in the atomic apply batch.
    drafts.push({
      ...makeCommand(runtime, 'PassCommitGate'), scenarioId: input.scenarioId,
      payload: { commitmentId: input.commitmentId },
    });
    for (const draft of drafts) {
      const preview = draft.name === 'PassCommitGate'
        ? { ok: true as const, effects: { changes: [], events: [], affectedProjections: [] } }
        : runNamed(draft.name, projected, draft, makeContext(runtime, 1));
      if (!preview.ok) {
        set({ status: { tone: 'critical', message: t(`errors.${preview.error.code}`, preview.error.params ?? {}) } });
        return false;
      }
      const saved = await get().dispatch('RecordScenarioCommand', (baseline, cmd, ctx) =>
        recordScenarioCommand(
          baseline,
          { scenarioId: input.scenarioId, command: draft, label: `scenario.command.${draft.name}` },
          cmd,
          ctx,
        ),
      );
      if (saved === false) return false;
    }
    return true;
  },

  async applyScenario(scenarioId) {
    return (
      (await get().dispatch('ApplyScenario', (state, cmd, ctx) => {
        const scenario = state.scenarios?.get(scenarioId);
        if (!scenario) return { ok: false, error: { code: 'ENTITY_NOT_FOUND', messageKey: 'error.ENTITY_NOT_FOUND' } };
        return applyScenarioBatch(
          baselineProjection(state), scenario,
          (projection, recorded) => {
            const { scenarioId: _scenarioId, ...baselineCommand } = recorded;
            return runNamed(recorded.name, projection, baselineCommand, ctx);
          },
          { ...cmd, payload: { scenarioId } },
          ctx,
        );
      })) !== false
    );
  },

  getScenarioRebase(scenarioId) {
    const { runtime, state } = get();
    const scenario = state?.scenarios?.get(scenarioId);
    if (!runtime || !state || !scenario) return [];
    return classifyScenarioRebase(baselineProjection(state), scenario, (projection, recorded) => {
      const { scenarioId: _scenarioId, ...baselineCommand } = recorded;
      return runNamed(recorded.name, projection, baselineCommand, makeContext(runtime, 1));
    });
  },

  async rebaseScenario(scenarioId, resolutions) {
    return (
      (await get().dispatch('RebaseScenario', (state, cmd, ctx) => {
        const scenario = state.scenarios?.get(scenarioId);
        if (!scenario) return { ok: false, error: { code: 'ENTITY_NOT_FOUND', messageKey: 'error.ENTITY_NOT_FOUND' } };
        return rebaseScenarioDraft(
          state, scenario,
          (projection, recorded) => {
            const { scenarioId: _scenarioId, ...baselineCommand } = recorded;
            return runNamed(recorded.name, projection, baselineCommand, ctx);
          },
          resolutions,
          cmd,
          ctx,
        );
      })) !== false
    );
  },
}));

const SCENARIO_METADATA_COMMANDS = new Set(['CreateScenario', 'RecordScenarioCommand', 'DiscardScenario', 'ShareScenario', 'RebaseScenario']);

/** Every baseline mutation advances the optimistic-concurrency revision once. */
function withBaselineRevision(
  state: WorkspaceState,
  name: string,
  result: Extract<CommandResult, { ok: true }>,
  ctx: CommandContext,
): Extract<CommandResult, { ok: true }> {
  if (SCENARIO_METADATA_COMMANDS.has(name) || result.effects.changes.some((change) => change.ref.kind === 'WORKSPACE')) return result;
  const before = state.workspace;
  const after = { ...before, revision: before.revision + 1, entityVersion: before.entityVersion + 1, updatedAt: ctx.clock.now(), updatedBy: ctx.actorId };
  return {
    ok: true,
    effects: { ...result.effects, changes: [...result.effects.changes, {
      ref: { kind: 'WORKSPACE', id: before.id }, op: 'UPDATE', fromVersion: before.entityVersion,
      toVersion: after.entityVersion, before, after,
      changedFields: ['entityVersion', 'revision', 'updatedAt', 'updatedBy'],
    }] },
  };
}

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
    case 'SetPrimaryTeam':
      return setPrimaryTeam(state, payload as never, cmd, ctx);
    case 'UpdateCommitment':
      return updateCommitment(state, payload as never, cmd, ctx);
    case 'ReorderTeams':
      return reorderTeams(state, payload as never, cmd, ctx);
    // Split and merge are each other's inverse, so both have to be replayable
    // or undo stops halfway and leaves the units in two places.
    case 'SplitCapacityFootprint':
      return splitCapacityFootprint(state, payload as never, cmd, ctx);
    case 'MergeCapacityFootprints':
      return mergeCapacityFootprints(state, payload as never, cmd, ctx);
    case 'LinkIdeaToRefinementReserve':
      return linkIdeaToRefinementReserve(state, payload as never, cmd, ctx);
    case 'UnlinkIdeaFromRefinementReserve':
      return unlinkIdeaFromRefinementReserve(state, payload as never, cmd, ctx);
    case 'SetCommitmentThemes':
      return setCommitmentThemes(relationView(state), payload as never, cmd, ctx);
    case 'ReviewSignal':
      return reviewSignal(state as SignalState, payload as never, cmd, ctx);
    case 'SnoozeSignal':
      return snoozeSignal(state as SignalState, payload as never, cmd, ctx);
    case 'ClearSignalDisposition':
      return clearSignalDisposition(state as SignalState, payload as never, cmd, ctx);
    // Relations replay through the same view the forward command used.
    case 'SetProductImpact':
      return setProductImpact(relationView(state), payload as never, cmd, ctx);
    case 'RemoveProductImpact':
      return removeProductImpact(relationView(state), payload as never, cmd, ctx);
    case 'AddDependency':
      return addDependency(relationView(state), payload as never, cmd, ctx);
    case 'UpdateDependency':
      return updateDependency(relationView(state), payload as never, cmd, ctx);
    case 'RemoveDependency':
      return removeDependency(relationView(state), payload as never, cmd, ctx);
    case 'AddMilestone':
      return addMilestone(relationView(state), payload as never, cmd, ctx);
    case 'UpdateMilestone':
      return updateMilestone(relationView(state), payload as never, cmd, ctx);
    case 'RemoveMilestone':
      return removeMilestone(relationView(state), payload as never, cmd, ctx);
    case 'AddExternalLink':
      return addExternalLink(relationView(state), payload as never, cmd, ctx);
    case 'RemoveExternalLink':
      return removeExternalLink(relationView(state), payload as never, cmd, ctx);
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

/**
 * `RelationState` names its maps differently from `WorkspaceState` — `impacts`
 * rather than `productImpacts`, `links` rather than `externalLinks` — and the
 * relation maps are optional on the workspace because older code paths build
 * state without them. This is the one place that reconciles the two.
 */
function relationView(state: WorkspaceState): RelationState {
  return {
    ...state,
    products: state.products ?? new Map(),
    impacts: state.productImpacts ?? new Map(),
    dependencies: state.dependencies ?? new Map(),
    decisions: state.decisions ?? new Map(),
    milestones: state.milestones ?? new Map(),
    themes: state.themes ?? new Map(),
    commitmentThemes: state.commitmentThemes ?? new Map(),
    links: state.externalLinks ?? new Map(),
  };
}

/**
 * Teams in the order the board draws them.
 *
 * Duplicated from the board builder deliberately: reordering has to work from
 * the same sequence the user is looking at, and reaching into a rendered
 * `BoardModel` from the store would make the store depend on the view.
 */
function activeTeamOrder(state: WorkspaceState | null): EntityId[] {
  return [...(state?.teams.values() ?? [])]
    .filter((team) => team.active && team.archivedAt === undefined && team.deletedAt === undefined)
    .sort((a, b) =>
      a.displayOrder === b.displayOrder
        ? a.name.localeCompare(b.name)
        : a.displayOrder - b.displayOrder,
    )
    .map((team) => team.id);
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
