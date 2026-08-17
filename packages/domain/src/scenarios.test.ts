import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Command, CommandContext, WorkspaceState } from './command.js';
import {
  baselineProjection,
  applyScenario,
  classifyScenarioRebase,
  cloneScenario,
  compareScenario,
  createScenario,
  projectScenario,
  recordScenarioCommand,
  rejectScenarioAtBaseline,
} from './scenarios.js';
import type { Scenario, Workspace } from './entities.js';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
} from './entities.js';

const NOW = '2026-08-15T09:00:00Z';
const command = (name: string): Command => ({
  id: `cmd-${name}`,
  name,
  workspaceId: 'ws',
  payload: {},
  actorId: 'person',
  issuedAt: NOW,
});
const context = (): CommandContext => ({
  clock: { now: () => NOW, today: () => '2026-08-15' },
  ids: {
    next: (() => {
      let index = 0;
      return () => `id-${++index}`;
    })(),
  },
  actorId: 'person',
  role: 'PLANNER',
  nextSequence: 1,
});

function state(): WorkspaceState {
  const workspace: Workspace = {
    id: 'ws',
    workspaceId: 'ws',
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'person',
    updatedAt: NOW,
    updatedBy: 'person',
    name: 'Portfolio',
    timezone: 'Europe/Amsterdam',
    currentQuarterId: '2026-Q3',
    isSample: false,
    revision: 4,
    settings: {
      capacity: {
        defaultTeamQuarterCapacity: 100,
        sizeMapping: DEFAULT_SIZE_MAPPING,
        defaultReserves: DEFAULT_RESERVES,
      },
      changeLoad: DEFAULT_CHANGE_LOAD_SETTINGS,
      valueDrivers: DEFAULT_VALUE_DRIVERS,
      noteMaxLength: 2000,
      milestonesPerCommitment: 6,
    },
  };
  return {
    workspace,
    teams: new Map(),
    teamQuarters: new Map(),
    commitments: new Map(),
    footprints: new Map(),
    scenarios: new Map(),
  };
}

describe('scenario overlays', () => {
  it('creates a private draft at the current baseline revision', () => {
    const result = createScenario(
      state(),
      { name: 'QBR options', ownerUserId: 'person' },
      command('CreateScenario'),
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const scenario = result.effects.changes[0]?.after as {
        visibility: string;
        baseRevision: number;
        status: string;
      };
      expect(scenario).toMatchObject({ visibility: 'PRIVATE', baseRevision: 4, status: 'DRAFT' });
    }
  });

  it('clones an active scenario as an independent private draft at the live revision', () => {
    const base = state();
    const ctx = context();
    const made = createScenario(
      base,
      { name: 'Option', ownerUserId: 'person' },
      command('CreateScenario'),
      ctx,
    );
    if (!made.ok) throw new Error('scenario should be created');
    const source = made.effects.changes[0]!.after as Scenario;
    const result = cloneScenario(
      {
        ...base,
        workspace: { ...base.workspace, revision: 8 },
        scenarios: new Map([[source.id, source]]),
      },
      source.id,
      command('CloneScenario'),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const clone = result.effects.changes[0]!.after as Scenario;
      expect(clone).toMatchObject({ visibility: 'PRIVATE', status: 'DRAFT', baseRevision: 8 });
      expect(clone.id).not.toBe(source.id);
    }
  });

  it('rejects a scenario command at the baseline boundary', () => {
    const result = rejectScenarioAtBaseline({
      ...command('MoveCapacityFootprint'),
      scenarioId: 'scenario-1',
    });
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.error.code).toBe('SCENARIO_CANNOT_MUTATE_BASELINE');
  });

  it('replays onto fresh maps without changing baseline bytes', () => {
    const base = baselineProjection(state());
    const scenarioResult = createScenario(
      state(),
      { name: 'Option', ownerUserId: 'person' },
      command('CreateScenario'),
      context(),
    );
    if (!scenarioResult.ok) throw new Error('scenario should be created');
    const scenario = scenarioResult.effects.changes[0]!.after as Scenario;
    const before = JSON.stringify([...base.commitments]);
    const projection = projectScenario(base, scenario, () => ({
      ok: true,
      effects: { changes: [], events: [], affectedProjections: [] },
    }));
    expect(projection.base).toBe(base);
    expect(JSON.stringify([...base.commitments])).toBe(before);
  });

  it('preserves baseline bytes for every sequence of overlay commands', () => {
    fc.assert(
      fc.property(fc.array(fc.uuid(), { maxLength: 20 }), (ids) => {
        const base = baselineProjection(state());
        const before = JSON.stringify({
          commitments: [...base.commitments],
          footprints: [...base.footprints],
          workspace: base.workspace,
        });
        const scenario: Scenario = {
          id: 'scenario-1',
          workspaceId: 'ws',
          schemaVersion: 1,
          entityVersion: 1,
          createdAt: NOW,
          createdBy: 'person',
          updatedAt: NOW,
          updatedBy: 'person',
          name: 'Option',
          ownerUserId: 'person',
          visibility: 'PRIVATE',
          baseRevision: base.workspace.revision,
          status: 'DRAFT',
          commands: ids.map((id, index) => ({
            id,
            sequence: index + 1,
            recordedAt: NOW,
            label: 'scenario.command.UpdateCommitment',
            command: { ...command('UpdateCommitment'), id, scenarioId: 'scenario-1' },
          })),
        };
        projectScenario(base, scenario, (overlay, recorded) => {
          // The replay is intentionally adversarial: even a bad collaborator
          // can only mutate the fresh projection maps, never the baseline.
          (overlay.footprints as Map<string, unknown>).set(recorded.id, { id: recorded.id });
          return { ok: true, effects: { changes: [], events: [], affectedProjections: [] } };
        });
        expect(
          JSON.stringify({
            commitments: [...base.commitments],
            footprints: [...base.footprints],
            workspace: base.workspace,
          }),
        ).toBe(before);
      }),
    );
  });

  it('requires a scenario id that matches the recorded overlay', () => {
    const base = state();
    const made = createScenario(
      base,
      { name: 'Option', ownerUserId: 'person' },
      command('CreateScenario'),
      context(),
    );
    if (!made.ok) throw new Error('scenario should be created');
    const scenario = made.effects.changes[0]!.after as Scenario;
    const withScenario = { ...base, scenarios: new Map([[scenario.id, scenario]]) };
    const result = recordScenarioCommand(
      withScenario,
      {
        scenarioId: scenario.id,
        command: command('CreateIdea'),
        label: 'scenario.command.createIdea',
      },
      command('RecordScenarioCommand'),
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SCENARIO_COMMAND_NOT_ALLOWED');
  });

  it('never applies a stale scenario, even when its replay would succeed', () => {
    const base = state();
    const made = createScenario(
      base,
      { name: 'Option', ownerUserId: 'person' },
      command('CreateScenario'),
      context(),
    );
    if (!made.ok) throw new Error('scenario should be created');
    const scenario = made.effects.changes[0]!.after as Scenario;
    const stale = baselineProjection({ ...base, workspace: { ...base.workspace, revision: 5 } });
    const result = applyScenario(
      stale,
      scenario,
      () => ({ ok: true, effects: { changes: [], events: [], affectedProjections: [] } }),
      { ...command('ApplyScenario'), payload: { scenarioId: scenario.id } },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SCENARIO_STALE');
  });

  it('rejects every stale revision rather than allowing an overwrite', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (advance) => {
        const base = state();
        const made = createScenario(
          base,
          { name: 'Option', ownerUserId: 'person' },
          command('CreateScenario'),
          context(),
        );
        if (!made.ok) throw new Error('scenario should be created');
        const scenario = made.effects.changes[0]!.after as Scenario;
        const result = applyScenario(
          baselineProjection({
            ...base,
            workspace: { ...base.workspace, revision: base.workspace.revision + advance },
          }),
          scenario,
          () => ({ ok: true, effects: { changes: [], events: [], affectedProjections: [] } }),
          { ...command('ApplyScenario'), payload: { scenarioId: scenario.id } },
          context(),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('SCENARIO_STALE');
      }),
    );
  });

  it('groups dependency and milestone changes for the comparison instead of storage rows', () => {
    const base = baselineProjection({
      ...state(),
      commitments: new Map([
        ['a', { id: 'a', targetDate: '2026-09-01' } as never],
        ['b', { id: 'b', targetDate: '2026-10-01' } as never],
      ]),
      dependencies: new Map([
        [
          'dependency',
          {
            id: 'dependency',
            sourceCommitmentId: 'a',
            target: { kind: 'COMMITMENT', id: 'b' },
            status: 'OPEN',
          } as never,
        ],
      ]),
      milestones: new Map([
        [
          'milestone',
          {
            id: 'milestone',
            commitmentId: 'a',
            targetDate: '2026-08-01',
            status: 'PLANNED',
          } as never,
        ],
      ]),
    });
    const projected = {
      ...base,
      dependencies: new Map([
        [
          'dependency',
          {
            ...base.dependencies!.get('dependency')!,
            status: 'AT_RISK',
          },
        ],
      ]),
      milestones: new Map([
        ['milestone', { ...base.milestones!.get('milestone')!, targetDate: '2026-09-15' }],
      ]),
      base,
      scenario: {} as Scenario,
    } as unknown as ReturnType<typeof projectScenario>;
    const diff = compareScenario(base, projected);
    expect(diff.dependencies).toEqual([{ dependencyId: 'dependency', effect: 'AT_RISK' }]);
    expect(diff.milestones).toEqual([{ milestoneId: 'milestone', conflict: 'AFTER_TARGET' }]);
  });

  it('applies an up-to-date scenario as one revision bump and undo barrier', () => {
    const base = state();
    const made = createScenario(
      base,
      { name: 'Option', ownerUserId: 'person' },
      command('CreateScenario'),
      context(),
    );
    if (!made.ok) throw new Error('scenario should be created');
    const scenario = made.effects.changes[0]!.after as Scenario;
    const result = applyScenario(
      baselineProjection(base),
      scenario,
      () => ({ ok: true, effects: { changes: [], events: [], affectedProjections: [] } }),
      { ...command('ApplyScenario'), payload: { scenarioId: scenario.id } },
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const workspace = result.effects.changes.find((change) => change.ref.kind === 'WORKSPACE')!
        .after as Workspace;
      const applied = result.effects.changes.find((change) => change.ref.kind === 'SCENARIO')!
        .after as Scenario;
      expect(workspace.revision).toBe(5);
      expect(applied.status).toBe('APPLIED');
      expect(result.effects.consequences).toEqual([
        { kind: 'IRREVERSIBLE', noteKey: 'scenario.applyUndoBarrier' },
      ]);
    }
  });

  it('reports an overlapping field edit with the baseline actor and time', () => {
    const base = state();
    const scenario: Scenario = {
      id: 'scenario-1',
      workspaceId: 'ws',
      schemaVersion: 1,
      entityVersion: 1,
      createdAt: NOW,
      createdBy: 'person',
      updatedAt: NOW,
      updatedBy: 'person',
      name: 'Option',
      ownerUserId: 'person',
      visibility: 'PRIVATE',
      baseRevision: 4,
      status: 'DRAFT',
      commands: [
        {
          id: 'record-1',
          sequence: 1,
          recordedAt: NOW,
          label: 'scenario.command.UpdateCommitment',
          command: {
            ...command('UpdateCommitment'),
            scenarioId: 'scenario-1',
            payload: { commitmentId: 'c-1', patch: { name: 'Mine' } },
          },
          baseFields: [
            {
              kind: 'COMMITMENT',
              id: 'c-1',
              field: 'name',
              value: 'Original',
              changedBy: 'other',
              changedAt: '2026-08-14T09:00:00Z',
            },
          ],
        },
      ],
    };
    const commitment = {
      id: 'c-1',
      workspaceId: 'ws',
      schemaVersion: 1,
      entityVersion: 2,
      createdAt: NOW,
      createdBy: 'person',
      updatedAt: '2026-08-16T09:00:00Z',
      updatedBy: 'other',
      name: 'Theirs',
      lifecycle: 'IDEA',
      class: 'DISCRETIONARY',
    } as never;
    const outcomes = classifyScenarioRebase(
      baselineProjection({ ...base, commitments: new Map([['c-1', commitment]]) }),
      scenario,
      () => ({ ok: true, effects: { changes: [], events: [], affectedProjections: [] } }),
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        status: 'CONFLICT',
        field: 'name',
        scenarioValue: 'Mine',
        baselineValue: 'Theirs',
        baselineChangedBy: 'other',
      }),
    ]);
  });

  it('rejects a selective gate apply without its recorded placement prerequisites', () => {
    const base = state();
    const scenario: Scenario = {
      id: 'scenario-1',
      workspaceId: 'ws',
      schemaVersion: 1,
      entityVersion: 1,
      createdAt: NOW,
      createdBy: 'person',
      updatedAt: NOW,
      updatedBy: 'person',
      name: 'Option',
      ownerUserId: 'person',
      visibility: 'PRIVATE',
      baseRevision: 4,
      status: 'DRAFT',
      commands: [
        {
          id: 'team',
          sequence: 1,
          recordedAt: NOW,
          label: 'scenario.command.SetPrimaryTeam',
          command: {
            ...command('SetPrimaryTeam'),
            scenarioId: 'scenario-1',
            payload: { commitmentId: 'idea', teamId: 'team-a' },
          },
        },
        {
          id: 'footprint',
          sequence: 2,
          recordedAt: NOW,
          label: 'scenario.command.AssignCapacityFootprint',
          command: {
            ...command('AssignCapacityFootprint'),
            scenarioId: 'scenario-1',
            payload: { commitmentId: 'idea', teamId: 'team-a', quarterId: '2026-Q3', units: 10 },
          },
        },
        {
          id: 'gate',
          sequence: 3,
          recordedAt: NOW,
          label: 'scenario.command.PassCommitGate',
          command: {
            ...command('PassCommitGate'),
            scenarioId: 'scenario-1',
            payload: { commitmentId: 'idea' },
          },
        },
      ],
    };
    const result = applyScenario(
      baselineProjection(base),
      scenario,
      () => ({ ok: true, effects: { changes: [], events: [], affectedProjections: [] } }),
      {
        ...command('ApplyScenario'),
        payload: { scenarioId: scenario.id, mode: 'SELECTED', commandIds: ['gate'] },
      },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SCENARIO_SELECTION_INCOMPLETE');
  });
});
