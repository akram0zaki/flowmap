import { describe, expect, it } from 'vitest';

import type { Command, CommandContext, WorkspaceState } from './command.js';
import {
  baselineProjection,
  createScenario,
  projectScenario,
  recordScenarioCommand,
  rejectScenarioAtBaseline,
} from './scenarios.js';
import type { Scenario, Workspace } from './entities.js';
import { DEFAULT_CHANGE_LOAD_SETTINGS, DEFAULT_RESERVES, DEFAULT_SIZE_MAPPING, DEFAULT_VALUE_DRIVERS } from './entities.js';

const NOW = '2026-08-15T09:00:00Z';
const command = (name: string): Command => ({ id: `cmd-${name}`, name, workspaceId: 'ws', payload: {}, actorId: 'person', issuedAt: NOW });
const context = (): CommandContext => ({
  clock: { now: () => NOW, today: () => '2026-08-15' },
  ids: { next: (() => { let index = 0; return () => `id-${++index}`; })() },
  actorId: 'person', role: 'PLANNER', nextSequence: 1,
});

function state(): WorkspaceState {
  const workspace: Workspace = {
    id: 'ws', workspaceId: 'ws', schemaVersion: 1, entityVersion: 1, createdAt: NOW, createdBy: 'person', updatedAt: NOW, updatedBy: 'person',
    name: 'Portfolio', timezone: 'Europe/Amsterdam', currentQuarterId: '2026-Q3', isSample: false, revision: 4,
    settings: { capacity: { defaultTeamQuarterCapacity: 100, sizeMapping: DEFAULT_SIZE_MAPPING, defaultReserves: DEFAULT_RESERVES }, changeLoad: DEFAULT_CHANGE_LOAD_SETTINGS, valueDrivers: DEFAULT_VALUE_DRIVERS, noteMaxLength: 2000, milestonesPerCommitment: 6 },
  };
  return { workspace, teams: new Map(), teamQuarters: new Map(), commitments: new Map(), footprints: new Map(), scenarios: new Map() };
}

describe('scenario overlays', () => {
  it('creates a private draft at the current baseline revision', () => {
    const result = createScenario(state(), { name: 'QBR options', ownerUserId: 'person' }, command('CreateScenario'), context());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const scenario = result.effects.changes[0]?.after as { visibility: string; baseRevision: number; status: string };
      expect(scenario).toMatchObject({ visibility: 'PRIVATE', baseRevision: 4, status: 'DRAFT' });
    }
  });

  it('rejects a scenario command at the baseline boundary', () => {
    const result = rejectScenarioAtBaseline({ ...command('MoveCapacityFootprint'), scenarioId: 'scenario-1' });
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.error.code).toBe('SCENARIO_CANNOT_MUTATE_BASELINE');
  });

  it('replays onto fresh maps without changing baseline bytes', () => {
    const base = baselineProjection(state());
    const scenarioResult = createScenario(state(), { name: 'Option', ownerUserId: 'person' }, command('CreateScenario'), context());
    if (!scenarioResult.ok) throw new Error('scenario should be created');
    const scenario = scenarioResult.effects.changes[0]!.after as Scenario;
    const before = JSON.stringify([...base.commitments]);
    const projection = projectScenario(base, scenario, () => ({ ok: true, effects: { changes: [], events: [], affectedProjections: [] } }));
    expect(projection.base).toBe(base);
    expect(JSON.stringify([...base.commitments])).toBe(before);
  });

  it('requires a scenario id that matches the recorded overlay', () => {
    const base = state();
    const made = createScenario(base, { name: 'Option', ownerUserId: 'person' }, command('CreateScenario'), context());
    if (!made.ok) throw new Error('scenario should be created');
    const scenario = made.effects.changes[0]!.after as Scenario;
    const withScenario = { ...base, scenarios: new Map([[scenario.id, scenario]]) };
    const result = recordScenarioCommand(withScenario, { scenarioId: scenario.id, command: command('CreateIdea'), label: 'scenario.command.createIdea' }, command('RecordScenarioCommand'), context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SCENARIO_COMMAND_NOT_ALLOWED');
  });
});
