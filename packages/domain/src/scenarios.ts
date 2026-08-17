/**
 * Scenario overlay primitives.
 *
 * A scenario is deliberately projected in memory. Its commands never pass the
 * repository's baseline boundary; applying is a separate, explicit operation.
 * This small module owns the branded types so a caller cannot accidentally use
 * a draft projection where a baseline write is required.
 */

import type { Command, CommandContext, CommandEffects, CommandResult, WorkspaceState } from './command.js';
import type { Scenario, ScenarioBaseField, ScenarioCommandRecord } from './entities.js';
import type { EntityId } from './primitives.js';
import { summariseCapacity } from './capacity.js';
import { authorise, bumped, created, domainFail, event, newEnvelope, requireName, succeed, updated } from './handler-kit.js';
import { domainError, type DomainError } from './errors.js';

const baselineBrand = Symbol('flowmap.baseline');
const scenarioBrand = Symbol('flowmap.scenario');

export type BaselineProjection = WorkspaceState & { readonly [baselineBrand]: 'baseline' };
export type ScenarioProjection = WorkspaceState & {
  readonly [scenarioBrand]: 'scenario';
  readonly base: BaselineProjection;
  readonly scenario: Scenario;
};

export function baselineProjection(state: WorkspaceState): BaselineProjection {
  return { ...state, [baselineBrand]: 'baseline' };
}

export type ScenarioReplay = (
  state: WorkspaceState,
  command: Command,
) => CommandResult;

export type ScenarioCapacityDiff = {
  readonly teamId: EntityId;
  readonly quarterId: string;
  readonly loadBefore: number;
  readonly loadAfter: number;
  readonly scenarioLoad: number;
  readonly headroomBefore: number;
  readonly headroomAfter: number;
  readonly overflowBefore: number;
  readonly overflowAfter: number;
};

export type ScenarioDiff = {
  readonly capacity: readonly ScenarioCapacityDiff[];
  readonly commitments: ReadonlyArray<{
    commitmentId: EntityId;
    readonly changedFields: readonly string[];
    readonly movedFrom?: string;
    readonly movedTo?: string;
  }>;
  readonly newCommitments: readonly EntityId[];
  readonly gatePassages: readonly EntityId[];
  readonly productImpact: readonly [];
  readonly dependencies: readonly [];
  readonly milestones: readonly [];
  readonly attention: { readonly added: readonly []; readonly removed: readonly []; readonly worsened: readonly [] };
  readonly summary: {
    readonly teamsAffected: number;
    readonly quartersAffected: number;
    readonly netUnitsMoved: number;
    readonly newOverflows: number;
    readonly resolvedOverflows: number;
  };
};

export type RebaseOutcome =
  | { readonly commandId: EntityId; readonly status: 'CLEAN' }
  | { readonly commandId: EntityId; readonly status: 'REDUNDANT'; readonly reason: string }
  | { readonly commandId: EntityId; readonly status: 'OBSOLETE'; readonly reason: string }
  | {
      readonly commandId: EntityId;
      readonly status: 'CONFLICT';
      readonly field: string;
      readonly scenarioValue: unknown;
      readonly baselineValue: unknown;
      readonly baselineChangedBy: string;
      readonly baselineChangedAt: string;
    };

export type ApplyScenarioPayload = {
  readonly scenarioId: EntityId;
  readonly mode?: 'ALL' | 'SELECTED';
  readonly commandIds?: readonly EntityId[];
  readonly reason?: string;
};

export type RebaseResolution = {
  readonly commandId: EntityId;
  readonly action: 'KEEP_MINE' | 'TAKE_THEIRS' | 'EDIT';
  /** Required for EDIT and kept as scenario intent. */
  readonly command?: Command;
};

const SCENARIO_COMMANDS = new Set([
  'CreateIdea', 'AssignCapacityFootprint', 'MoveCapacityFootprint',
  'ResizeCapacityFootprint', 'RemoveCapacityFootprint', 'RestoreCapacityFootprint',
  'SetPrimaryTeam', 'UpdateCommitment', 'PassCommitGate', 'HoldCommitment',
  'ResumeCommitment', 'DropCommitment', 'SetProductImpact', 'RemoveProductImpact',
  'AddDependency', 'UpdateDependency', 'RemoveDependency', 'AddMilestone',
  'UpdateMilestone', 'RemoveMilestone',
]);

/**
 * Replays draft effects onto fresh maps. The baseline maps are never written;
 * callers can retain and byte-compare their serialised baseline with confidence.
 */
export function projectScenario(
  base: BaselineProjection,
  scenario: Scenario,
  replay: ScenarioReplay,
): ScenarioProjection {
  let current: WorkspaceState = cloneState(base);
  for (const record of scenario.commands) {
    const command = record.command as unknown as Command;
    // A gate passage is an intent in a scenario. Keeping the Idea an Idea is
    // what lets its placement remain visibly tentative until apply.
    if (command.name === 'PassCommitGate') continue;
    const result = replay(current, command);
    if (result.ok) current = applyEffects(current, result.effects);
  }
  return { ...current, [scenarioBrand]: 'scenario', base, scenario };
}

/**
 * A deterministic, management-facing comparison. It deliberately groups by
 * team-quarter and commitment rather than exposing storage-table mutations.
 */
export function compareScenario(base: BaselineProjection, projected: ScenarioProjection): ScenarioDiff {
  const capacity: ScenarioCapacityDiff[] = [];
  const cellKeys = new Set([
    ...[...base.teamQuarters.values()].map((item) => `${item.teamId}:${item.quarterId}`),
    ...[...projected.teamQuarters.values()].map((item) => `${item.teamId}:${item.quarterId}`),
  ]);
  for (const key of cellKeys) {
    const [teamId, quarterId] = key.split(':') as [EntityId, string];
    const beforeContainer = [...base.teamQuarters.values()].find((item) => item.teamId === teamId && item.quarterId === quarterId);
    const afterContainer = [...projected.teamQuarters.values()].find((item) => item.teamId === teamId && item.quarterId === quarterId);
    if (!beforeContainer || !afterContainer) continue;
    const before = summariseCapacity({ teamQuarter: beforeContainer, footprints: [...base.footprints.values()], commitmentsById: base.commitments, currentQuarterId: base.workspace.currentQuarterId });
    const after = summariseCapacity({ teamQuarter: afterContainer, footprints: [...projected.footprints.values()], commitmentsById: projected.commitments, currentQuarterId: projected.workspace.currentQuarterId });
    const scenarioLoad = [...projected.footprints.values()].reduce((sum, footprint) => {
      const commitment = projected.commitments.get(footprint.commitmentId);
      return footprint.teamId === teamId && footprint.quarterId === quarterId && commitment?.lifecycle === 'IDEA'
        ? sum + footprint.units
        : sum;
    }, 0);
    if (before.committedLoad !== after.committedLoad || scenarioLoad > 0 || before.overflow !== after.overflow) {
      capacity.push({ teamId, quarterId, loadBefore: before.committedLoad, loadAfter: after.committedLoad, scenarioLoad, headroomBefore: before.headroom, headroomAfter: after.headroom, overflowBefore: before.overflow, overflowAfter: after.overflow });
    }
  }
  const commitments: Array<{ commitmentId: EntityId; changedFields: readonly string[] }> = [];
  const newCommitments: EntityId[] = [];
  for (const [id, after] of projected.commitments) {
    const before = base.commitments.get(id);
    if (!before) { newCommitments.push(id); continue; }
    const fields = ['name', 'lifecycle', 'primaryTeamId', 'targetQuarterId', 'targetDate'].filter(
      (field) => before[field as keyof typeof before] !== after[field as keyof typeof after],
    );
    if (fields.length > 0) commitments.push({ commitmentId: id, changedFields: fields });
  }
  const newOverflows = capacity.filter((item) => item.overflowBefore === 0 && item.overflowAfter > 0).length;
  const resolvedOverflows = capacity.filter((item) => item.overflowBefore > 0 && item.overflowAfter === 0).length;
  return {
    capacity: capacity.sort((a, b) => a.teamId.localeCompare(b.teamId) || a.quarterId.localeCompare(b.quarterId)),
    commitments,
    newCommitments,
    gatePassages: commitments.filter((item) => item.changedFields.includes('lifecycle')).map((item) => item.commitmentId),
    productImpact: [], dependencies: [], milestones: [], attention: { added: [], removed: [], worsened: [] },
    summary: {
      teamsAffected: new Set(capacity.map((item) => item.teamId)).size,
      quartersAffected: new Set(capacity.map((item) => item.quarterId)).size,
      netUnitsMoved: capacity.reduce((sum, item) => sum + Math.abs(item.loadAfter - item.loadBefore) + item.scenarioLoad, 0),
      newOverflows,
      resolvedOverflows,
    },
  };
}

/**
 * Rebase is a replay, not a merge. A command that now produces no effects is
 * redundant; a command that cannot be replayed is obsolete. Field conflicts
 * require a historical base snapshot and are therefore conservatively surfaced
 * as unresolved by callers that have one.
 */
export function classifyScenarioRebase(
  baseline: BaselineProjection,
  scenario: Scenario,
  replay: ScenarioReplay,
): readonly RebaseOutcome[] {
  let current: WorkspaceState = baseline;
  return scenario.commands.map((record) => {
    const { scenarioId: _scenarioId, ...command } = record.command as unknown as Command;
    const conflict = record.baseFields?.find((field) => {
      const live = scenarioField(baseline, field.kind, field.id, field.field);
      return live !== MISSING && !sameValue(live, field.value);
    });
    if (conflict) {
      const entity = scenarioEntity(baseline, conflict.kind, conflict.id) as { updatedBy?: string; updatedAt?: string } | undefined;
      return {
        commandId: record.id,
        status: 'CONFLICT',
        field: conflict.field,
        scenarioValue: scenarioValue(command, conflict.field),
        baselineValue: scenarioField(baseline, conflict.kind, conflict.id, conflict.field),
        baselineChangedBy: entity?.updatedBy ?? conflict.changedBy,
        baselineChangedAt: entity?.updatedAt ?? conflict.changedAt,
      };
    }
    // Gate intents can only be validated when their preceding ghost placement
    // is materialised during apply; they are clean while rebasing a draft.
    if (command.name === 'PassCommitGate') return { commandId: record.id, status: 'CLEAN' };
    const result = replay(current, command);
    if (!result.ok) return { commandId: record.id, status: 'OBSOLETE', reason: result.error.code };
    if (result.effects.changes.length === 0) return { commandId: record.id, status: 'REDUNDANT', reason: 'No baseline change remains' };
    current = applyEffects(current, result.effects);
    return { commandId: record.id, status: 'CLEAN' };
  });
}

/**
 * Produces one atomic baseline batch for an up-to-date scenario. Repository
 * `apply` is the transaction boundary; callers submit this single effect set.
 */
export function applyScenario(
  baseline: BaselineProjection,
  scenario: Scenario,
  replay: ScenarioReplay,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'PLANNER');
  if (unauthorised) return unauthorised;
  const payload = cmd.payload as ApplyScenarioPayload;
  if (payload.scenarioId !== scenario.id) return domainFail('ENTITY_NOT_FOUND', { entityRef: { kind: 'SCENARIO', id: payload.scenarioId } });
  if (scenario.baseRevision < baseline.workspace.revision) return domainFail('SCENARIO_STALE');
  const rebase = classifyScenarioRebase(baseline, scenario, replay);
  if (rebase.some((outcome) => outcome.status === 'CONFLICT')) {
    return domainFail('SCENARIO_CONFLICT_UNRESOLVED', { params: { count: rebase.filter((item) => item.status === 'CONFLICT').length } });
  }
  let current: WorkspaceState = baseline;
  const selected = selectedScenarioCommands(scenario, payload);
  if (!selected.ok) return selected;
  const changes: Array<CommandEffects['changes'][number]> = [];
  const events: Array<CommandEffects['events'][number]> = [];
  for (const record of selected.records) {
    const { scenarioId: _scenarioId, ...recorded } = record.command as unknown as Command;
    const result = replay(current, recorded);
    if (!result.ok) return result;
    current = applyEffects(current, result.effects);
    changes.push(...result.effects.changes);
    events.push(...result.effects.events.map((item) => ({ ...item, sequence: ctx.nextSequence + events.length, scenarioId: scenario.id })));
  }
  const workspaceAfter = bumped({ ...baseline.workspace, revision: baseline.workspace.revision + 1 }, ctx);
  const scenarioAfter = bumped({ ...scenario, status: 'APPLIED' as const, appliedAt: ctx.clock.now(), appliedBy: ctx.actorId, appliedCommandIds: selected.records.map((record) => record.id) }, ctx);
  const workspaceRef = { kind: 'WORKSPACE', id: baseline.workspace.id } as const;
  const scenarioRef = { kind: 'SCENARIO', id: scenario.id } as const;
  return succeed({
    changes: [...changes, updated(workspaceRef, baseline.workspace, workspaceAfter), updated(scenarioRef, scenario, scenarioAfter)],
    events: [...events, event(cmd, ctx, events.length, 'SCENARIO_APPLIED', [scenarioRef], { scenarioId: scenario.id, commandIds: selected.records.map((record) => record.id), mode: payload.mode ?? 'ALL' })],
    affectedProjections: ['radar'],
    consequences: [{ kind: 'IRREVERSIBLE', noteKey: 'scenario.applyUndoBarrier' }],
  });
}

/** Resolves rebase outcomes explicitly and moves the draft onto the live revision. */
export function rebaseScenario(
  state: WorkspaceState,
  scenario: Scenario,
  replay: ScenarioReplay,
  resolutions: readonly RebaseResolution[],
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;
  const base = baselineProjection(state);
  const outcomes = classifyScenarioRebase(base, scenario, replay);
  const choices = new Map(resolutions.map((resolution) => [resolution.commandId, resolution]));
  const unresolved = outcomes.filter((outcome) => outcome.status === 'CONFLICT' && !choices.has(outcome.commandId));
  if (unresolved.length > 0) return domainFail('SCENARIO_CONFLICT_UNRESOLVED', { params: { count: unresolved.length } });
  const outcomeById = new Map(outcomes.map((outcome) => [outcome.commandId, outcome]));
  const commands: ScenarioCommandRecord[] = [];
  for (const record of scenario.commands) {
    const outcome = outcomeById.get(record.id);
    if (!outcome || outcome.status === 'REDUNDANT' || outcome.status === 'OBSOLETE') continue;
    const resolution = choices.get(record.id);
    if (resolution?.action === 'TAKE_THEIRS') continue;
    if (resolution?.action === 'EDIT' && resolution.command === undefined) {
      return domainFail('SCENARIO_CONFLICT_UNRESOLVED', { params: { count: 1 } });
    }
    const command = resolution?.action === 'EDIT' ? resolution.command! : record.command as unknown as Command;
    if (command.scenarioId !== scenario.id) return domainFail('SCENARIO_COMMAND_NOT_ALLOWED', { params: { command: command.name } });
    commands.push({
      ...record,
      sequence: commands.length + 1,
      command: command as unknown as Readonly<Record<string, unknown>>,
      baseFields: captureScenarioFields(state, command),
    });
  }
  const after = bumped({ ...scenario, baseRevision: state.workspace.revision, commands }, ctx);
  const ref = { kind: 'SCENARIO', id: scenario.id } as const;
  return succeed({
    changes: [updated(ref, scenario, after)],
    events: [event(cmd, ctx, 0, 'SCENARIO_REBASED', [ref], { scenarioId: scenario.id, baseRevision: after.baseRevision, droppedCommands: scenario.commands.length - commands.length })],
    affectedProjections: ['radar'],
  });
}

type SelectedScenarioCommands =
  | { readonly ok: true; readonly records: readonly ScenarioCommandRecord[] }
  | { readonly ok: false; readonly error: DomainError };

function selectedScenarioCommands(
  scenario: Scenario,
  payload: ApplyScenarioPayload,
): SelectedScenarioCommands {
  if ((payload.mode ?? 'ALL') === 'ALL') return { ok: true, records: scenario.commands };
  const requested = new Set(payload.commandIds ?? []);
  const selected = scenario.commands.filter((record) => requested.has(record.id));
  const missing = new Set<EntityId>();
  for (const record of selected) {
    const command = record.command as unknown as Command;
    const commitmentId = (command.payload as Record<string, unknown>).commitmentId as EntityId | undefined;
    if (!commitmentId || command.name === 'SetPrimaryTeam') continue;
    // The placement sequence is intentionally explicit: accountable team,
    // footprint, then gate. A later intent cannot be applied without its
    // earlier structural prerequisite.
    const prerequisites = scenario.commands.filter((candidate) => {
      if (candidate.sequence >= record.sequence) return false;
      const previous = candidate.command as unknown as Command;
      const previousCommitment = (previous.payload as Record<string, unknown>).commitmentId;
      return previousCommitment === commitmentId && (
        (command.name === 'AssignCapacityFootprint' && previous.name === 'SetPrimaryTeam') ||
        (command.name === 'PassCommitGate' && ['SetPrimaryTeam', 'AssignCapacityFootprint'].includes(previous.name))
      );
    });
    for (const prerequisite of prerequisites) if (!requested.has(prerequisite.id)) missing.add(prerequisite.id);
  }
  return missing.size > 0
    ? { ok: false, error: domainError('SCENARIO_SELECTION_INCOMPLETE', { params: { count: missing.size } }) }
    : { ok: true, records: selected };
}

/** Only this module accepts a scenario command; baseline handlers must reject it. */
export function recordScenarioCommand(
  state: WorkspaceState,
  payload: { scenarioId: EntityId; command: Command; label: string },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;
  const scenario = state.scenarios?.get(payload.scenarioId);
  if (!scenario) return domainFail('ENTITY_NOT_FOUND', { entityRef: { kind: 'SCENARIO', id: payload.scenarioId } });
  if (scenario.status !== 'DRAFT' && scenario.status !== 'SHARED') {
    return domainFail('SCENARIO_COMMAND_NOT_ALLOWED', { params: { command: payload.command.name } });
  }
  if (payload.command.scenarioId !== scenario.id) {
    return domainFail('SCENARIO_COMMAND_NOT_ALLOWED', { params: { command: payload.command.name } });
  }
  if (!SCENARIO_COMMANDS.has(payload.command.name)) {
    return domainFail('SCENARIO_COMMAND_NOT_ALLOWED', { params: { command: payload.command.name } });
  }
  const record: ScenarioCommandRecord = {
    id: payload.command.id,
    sequence: scenario.commands.length + 1,
    command: payload.command as unknown as Readonly<Record<string, unknown>>,
    recordedAt: ctx.clock.now(),
    label: payload.label,
    baseFields: captureScenarioFields(state, payload.command),
  };
  const after = bumped({ ...scenario, commands: [...scenario.commands, record] }, ctx);
  const ref = { kind: 'SCENARIO', id: scenario.id } as const;
  return succeed({
    changes: [updated(ref, scenario, after)],
    events: [event(cmd, ctx, 0, 'SCENARIO_COMMAND_RECORDED', [ref], { scenarioId: scenario.id, command: payload.command.name })],
    affectedProjections: ['radar'],
  });
}

const MISSING = Symbol('missing');

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function scenarioEntity(state: WorkspaceState, kind: string, id: EntityId): Record<string, unknown> | undefined {
  const buckets: Record<string, ReadonlyMap<EntityId, unknown> | undefined> = {
    COMMITMENT: state.commitments, FOOTPRINT: state.footprints, PRODUCT_IMPACT: state.productImpacts,
    DEPENDENCY: state.dependencies, MILESTONE: state.milestones,
  };
  return buckets[kind]?.get(id) as Record<string, unknown> | undefined;
}

function scenarioField(state: WorkspaceState, kind: string, id: EntityId, field: string): unknown | typeof MISSING {
  const entity = scenarioEntity(state, kind, id);
  return entity === undefined ? MISSING : entity[field];
}

function scenarioValue(command: Command, field: string): unknown {
  const payload = command.payload as Record<string, unknown>;
  const patch = payload.patch as Record<string, unknown> | undefined;
  return patch?.[field] ?? payload[field];
}

function captureScenarioFields(state: WorkspaceState, command: Command): readonly ScenarioBaseField[] {
  const payload = command.payload as Record<string, unknown>;
  const entries: Array<{ kind: string; id: EntityId | undefined; fields: readonly string[] }> = [];
  const commitmentId = payload.commitmentId as EntityId | undefined;
  const footprintId = payload.footprintId as EntityId | undefined;
  const relationId = (payload.impactId ?? payload.dependencyId ?? payload.milestoneId) as EntityId | undefined;
  if (['UpdateCommitment'].includes(command.name)) entries.push({ kind: 'COMMITMENT', id: commitmentId, fields: Object.keys((payload.patch ?? {}) as object) });
  if (['SetPrimaryTeam'].includes(command.name)) entries.push({ kind: 'COMMITMENT', id: commitmentId, fields: ['primaryTeamId'] });
  if (['PassCommitGate', 'HoldCommitment', 'ResumeCommitment', 'DropCommitment'].includes(command.name)) entries.push({ kind: 'COMMITMENT', id: commitmentId, fields: ['lifecycle'] });
  if (['MoveCapacityFootprint'].includes(command.name)) entries.push({ kind: 'FOOTPRINT', id: footprintId, fields: ['teamId', 'quarterId'] });
  if (['ResizeCapacityFootprint'].includes(command.name)) entries.push({ kind: 'FOOTPRINT', id: footprintId, fields: ['units'] });
  if (['RemoveCapacityFootprint', 'RestoreCapacityFootprint'].includes(command.name)) entries.push({ kind: 'FOOTPRINT', id: footprintId, fields: ['archivedAt'] });
  if (['SetProductImpact', 'RemoveProductImpact'].includes(command.name)) entries.push({ kind: 'PRODUCT_IMPACT', id: relationId, fields: ['type', 'archivedAt'] });
  if (['UpdateDependency', 'RemoveDependency'].includes(command.name)) entries.push({ kind: 'DEPENDENCY', id: relationId, fields: ['target', 'status', 'archivedAt'] });
  if (['UpdateMilestone', 'RemoveMilestone'].includes(command.name)) entries.push({ kind: 'MILESTONE', id: relationId, fields: ['targetDate', 'status', 'archivedAt'] });
  return entries.flatMap(({ kind, id, fields }) => {
    if (!id) return [];
    const entity = scenarioEntity(state, kind, id);
    if (!entity) return [];
    return fields.map((field) => ({
      kind, id, field, value: entity[field],
      changedBy: entity.updatedBy as string,
      changedAt: entity.updatedAt as string,
    }));
  });
}

export function createScenario(
  state: WorkspaceState,
  payload: { name: string; ownerUserId: EntityId },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;
  const invalid = requireName(payload.name, 140);
  if (invalid) return invalid;
  const scenario: Scenario = {
    ...newEnvelope(ctx.ids.next(), cmd, ctx),
    name: payload.name.trim(),
    ownerUserId: payload.ownerUserId,
    visibility: 'PRIVATE',
    baseRevision: state.workspace.revision,
    commands: [],
    status: 'DRAFT',
  };
  const ref = { kind: 'SCENARIO', id: scenario.id } as const;
  return succeed({
    changes: [created(ref, scenario)],
    events: [event(cmd, ctx, 0, 'SCENARIO_CREATED', [ref], { name: scenario.name, baseRevision: scenario.baseRevision })],
    affectedProjections: ['radar'],
  });
}

/** An independent private copy always starts from the current baseline. */
export function cloneScenario(
  state: WorkspaceState,
  sourceScenarioId: EntityId,
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const unauthorised = authorise(ctx, 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;
  const source = state.scenarios?.get(sourceScenarioId);
  if (!source) return domainFail('ENTITY_NOT_FOUND', { entityRef: { kind: 'SCENARIO', id: sourceScenarioId } });
  if (source.status !== 'DRAFT' && source.status !== 'SHARED') {
    return domainFail('SCENARIO_COMMAND_NOT_ALLOWED', { params: { command: 'CloneScenario' } });
  }
  const id = ctx.ids.next();
  const commands = source.commands.map((record, index) => {
    const command = record.command as unknown as Command;
    return {
      ...record,
      id: ctx.ids.next(),
      sequence: index + 1,
      command: { ...command, id: ctx.ids.next(), scenarioId: id } as unknown as Readonly<Record<string, unknown>>,
    };
  });
  const clone: Scenario = {
    ...newEnvelope(id, cmd, ctx), name: source.name, ownerUserId: ctx.actorId,
    visibility: 'PRIVATE', baseRevision: state.workspace.revision, commands, status: 'DRAFT',
  };
  const ref = { kind: 'SCENARIO', id } as const;
  return succeed({
    changes: [created(ref, clone)],
    events: [event(cmd, ctx, 0, 'SCENARIO_CLONED', [ref], { scenarioId: source.id, cloneId: id })],
    affectedProjections: ['radar'],
  });
}

export function updateScenario(
  state: WorkspaceState,
  payload: { scenarioId: EntityId; name?: string; visibility?: Scenario['visibility']; status?: Scenario['status'] },
  cmd: Command,
  ctx: CommandContext,
): CommandResult {
  const scenario = state.scenarios?.get(payload.scenarioId);
  if (!scenario) return domainFail('ENTITY_NOT_FOUND', { entityRef: { kind: 'SCENARIO', id: payload.scenarioId } });
  const unauthorised = authorise(ctx, payload.status === 'APPLIED' ? 'PLANNER' : 'CONTRIBUTOR');
  if (unauthorised) return unauthorised;
  if (payload.name !== undefined) {
    const invalid = requireName(payload.name, 140);
    if (invalid) return invalid;
  }
  const after = bumped({
    ...scenario,
    ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
    ...(payload.visibility === undefined ? {} : { visibility: payload.visibility }),
    ...(payload.status === undefined ? {} : { status: payload.status }),
  }, ctx);
  const ref = { kind: 'SCENARIO', id: scenario.id } as const;
  return succeed({
    changes: [updated(ref, scenario, after)],
    events: [event(cmd, ctx, 0, 'SCENARIO_UPDATED', [ref], { scenarioId: scenario.id })],
    affectedProjections: ['radar'],
  });
}

/** Runtime guard used by storage and all baseline mutation boundaries. */
export function rejectScenarioAtBaseline(command: Command): CommandResult | null {
  return command.scenarioId === undefined
    ? null
    : domainFail('SCENARIO_CANNOT_MUTATE_BASELINE', { params: { scenarioId: command.scenarioId } });
}

function cloneState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    teams: new Map(state.teams),
    teamQuarters: new Map(state.teamQuarters),
    commitments: new Map(state.commitments),
    footprints: new Map(state.footprints),
    ...(state.products ? { products: new Map(state.products) } : {}),
    ...(state.productImpacts ? { productImpacts: new Map(state.productImpacts) } : {}),
    ...(state.dependencies ? { dependencies: new Map(state.dependencies) } : {}),
    ...(state.decisions ? { decisions: new Map(state.decisions) } : {}),
    ...(state.milestones ? { milestones: new Map(state.milestones) } : {}),
    ...(state.themes ? { themes: new Map(state.themes) } : {}),
    ...(state.commitmentThemes ? { commitmentThemes: new Map(state.commitmentThemes) } : {}),
    ...(state.externalLinks ? { externalLinks: new Map(state.externalLinks) } : {}),
    ...(state.people ? { people: new Map(state.people) } : {}),
    ...(state.signalDispositions ? { signalDispositions: new Map(state.signalDispositions) } : {}),
    ...(state.scenarios ? { scenarios: new Map(state.scenarios) } : {}),
  };
}

function applyEffects(state: WorkspaceState, effects: CommandEffects): WorkspaceState {
  const next = cloneState(state) as Record<string, unknown>;
  const maps: Record<string, Map<string, unknown> | undefined> = {
    TEAM: next['teams'] as Map<string, unknown>, TEAM_QUARTER: next['teamQuarters'] as Map<string, unknown>,
    COMMITMENT: next['commitments'] as Map<string, unknown>, CAPACITY_FOOTPRINT: next['footprints'] as Map<string, unknown>,
    PRODUCT_SERVICE: next['products'] as Map<string, unknown> | undefined, PRODUCT_IMPACT: next['productImpacts'] as Map<string, unknown> | undefined,
    DEPENDENCY: next['dependencies'] as Map<string, unknown> | undefined, DECISION: next['decisions'] as Map<string, unknown> | undefined,
    MILESTONE: next['milestones'] as Map<string, unknown> | undefined, THEME: next['themes'] as Map<string, unknown> | undefined,
    COMMITMENT_THEME: next['commitmentThemes'] as Map<string, unknown> | undefined, EXTERNAL_LINK: next['externalLinks'] as Map<string, unknown> | undefined,
    PERSON: next['people'] as Map<string, unknown> | undefined, SIGNAL_DISPOSITION: next['signalDispositions'] as Map<string, unknown> | undefined,
  };
  for (const change of effects.changes) {
    if (change.ref.kind === 'WORKSPACE' || change.ref.kind === 'PRODUCT_QUARTER') continue;
    const target = maps[change.ref.kind];
    if (!target) continue;
    if (change.op === 'DELETE') target.delete(change.ref.id);
    else target.set(change.ref.id, change.after);
  }
  return next as unknown as WorkspaceState;
}
