/**
 * Scenario overlay primitives.
 *
 * A scenario is deliberately projected in memory. Its commands never pass the
 * repository's baseline boundary; applying is a separate, explicit operation.
 * This small module owns the branded types so a caller cannot accidentally use
 * a draft projection where a baseline write is required.
 */

import type { Command, CommandContext, CommandEffects, CommandResult, WorkspaceState } from './command.js';
import type { Scenario, ScenarioCommandRecord } from './entities.js';
import type { EntityId } from './primitives.js';
import { summariseCapacity } from './capacity.js';
import { authorise, bumped, created, domainFail, event, newEnvelope, requireName, succeed, updated } from './handler-kit.js';

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
  const record: ScenarioCommandRecord = {
    id: payload.command.id,
    sequence: scenario.commands.length + 1,
    command: payload.command as unknown as Readonly<Record<string, unknown>>,
    recordedAt: ctx.clock.now(),
    label: payload.label,
  };
  const after = bumped({ ...scenario, commands: [...scenario.commands, record] }, ctx);
  const ref = { kind: 'SCENARIO', id: scenario.id } as const;
  return succeed({
    changes: [updated(ref, scenario, after)],
    events: [event(cmd, ctx, 0, 'SCENARIO_COMMAND_RECORDED', [ref], { scenarioId: scenario.id, command: payload.command.name })],
    affectedProjections: ['radar'],
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
