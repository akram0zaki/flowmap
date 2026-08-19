import { describe, expect, it } from 'vitest';

import type { WorkspaceState } from '@flowmap/domain';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
} from '@flowmap/domain';

import { buildBoard } from './layout.js';
import { buildDependencyGraph, buildTeamsLens, buildTimeline, searchWorkspace } from './lenses.js';

const now = '2026-08-15T09:00:00Z';
const env = (id: string) => ({
  id,
  workspaceId: 'workspace',
  schemaVersion: 1,
  entityVersion: 1,
  createdAt: now,
  createdBy: 'planner',
  updatedAt: now,
  updatedBy: 'planner',
});

function state(): WorkspaceState {
  return {
    workspace: {
      ...env('workspace'),
      name: 'Portfolio',
      timezone: 'Europe/Amsterdam',
      currentQuarterId: '2026-Q3',
      isSample: false,
      revision: 1,
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
    },
    teams: new Map([
      [
        'team',
        {
          ...env('team'),
          name: 'Payments',
          defaultQuarterCapacity: 100,
          displayOrder: 0,
          active: true,
        },
      ],
    ]),
    teamQuarters: new Map(),
    commitments: new Map([
      [
        'a',
        {
          ...env('a'),
          name: 'Payment migration',
          lifecycle: 'COMMITTED',
          class: 'STRATEGIC',
          importance: 'HIGH',
          valueDrivers: [],
        },
      ],
      [
        'b',
        {
          ...env('b'),
          name: 'Security review',
          lifecycle: 'IN_DELIVERY',
          class: 'MANDATORY',
          importance: 'HIGH',
          valueDrivers: [],
        },
      ],
    ]),
    footprints: new Map([
      [
        'fp-a',
        {
          ...env('fp-a'),
          commitmentId: 'a',
          teamId: 'team',
          quarterId: '2026-Q3',
          units: 20,
          unitsSource: 'EXPLICIT',
          isPrimary: true,
        },
      ],
      [
        'fp-b',
        {
          ...env('fp-b'),
          commitmentId: 'b',
          teamId: 'team',
          quarterId: '2026-Q4',
          units: 10,
          unitsSource: 'CARRY_OVER',
          isPrimary: true,
          carryOverFromQuarterId: '2026-Q3',
          carryOverFromFootprintId: 'fp-a',
        },
      ],
    ]),
    dependencies: new Map([
      [
        'dep-a',
        {
          ...env('dep-a'),
          sourceCommitmentId: 'a',
          target: { kind: 'COMMITMENT', id: 'b' },
          type: 'REQUIRES',
          status: 'OPEN',
          isHard: false,
        },
      ],
      [
        'dep-b',
        {
          ...env('dep-b'),
          sourceCommitmentId: 'b',
          target: { kind: 'COMMITMENT', id: 'a' },
          type: 'REQUIRES',
          status: 'AT_RISK',
          isHard: false,
        },
      ],
    ]),
    milestones: new Map([
      [
        'milestone',
        {
          ...env('milestone'),
          commitmentId: 'a',
          name: 'Pilot',
          targetDate: '2026-08-30',
          status: 'PLANNED',
          displayOrder: 0,
        },
      ],
    ]),
    products: new Map(),
    productImpacts: new Map(),
    decisions: new Map(),
    themes: new Map(),
    commitmentThemes: new Map(),
    externalLinks: new Map(),
    people: new Map(),
  };
}

function teamsState(): WorkspaceState {
  const base = state();
  return {
    ...base,
    teams: new Map([
      [
        'payments',
        {
          ...env('payments'),
          name: 'Payments',
          defaultQuarterCapacity: 100,
          displayOrder: 0,
          active: true,
        },
      ],
      [
        'platform',
        {
          ...env('platform'),
          name: 'Platform',
          defaultQuarterCapacity: 100,
          displayOrder: 1,
          active: true,
        },
      ],
    ]),
    teamQuarters: new Map([
      [
        'tq-pay-q3',
        {
          ...env('tq-pay-q3'),
          teamId: 'payments',
          quarterId: '2026-Q3',
          capacityBaseline: 80,
          capacityAdjustment: 0,
          reserves: [],
        },
      ],
      [
        'tq-pay-q4',
        {
          ...env('tq-pay-q4'),
          teamId: 'payments',
          quarterId: '2026-Q4',
          capacityBaseline: 80,
          capacityAdjustment: 0,
          reserves: [],
        },
      ],
      [
        'tq-plat-q3',
        {
          ...env('tq-plat-q3'),
          teamId: 'platform',
          quarterId: '2026-Q3',
          capacityBaseline: 80,
          capacityAdjustment: 0,
          reserves: [],
        },
      ],
    ]),
    commitments: new Map([
      [
        'a',
        {
          ...env('a'),
          name: 'Payment migration',
          lifecycle: 'COMMITTED',
          class: 'STRATEGIC',
          importance: 'HIGH',
          valueDrivers: [],
        },
      ],
      [
        'b',
        {
          ...env('b'),
          name: 'Security review',
          lifecycle: 'IN_DELIVERY',
          class: 'MANDATORY',
          importance: 'HIGH',
          valueDrivers: [],
        },
      ],
      [
        'c',
        {
          ...env('c'),
          name: 'Platform upgrade',
          lifecycle: 'COMMITTED',
          class: 'OPERATIONAL',
          importance: 'MEDIUM',
          valueDrivers: [],
        },
      ],
    ]),
    footprints: new Map([
      [
        'fp-a',
        {
          ...env('fp-a'),
          commitmentId: 'a',
          teamId: 'payments',
          quarterId: '2026-Q3',
          units: 60,
          unitsSource: 'EXPLICIT',
          isPrimary: true,
        },
      ],
      [
        'fp-b',
        {
          ...env('fp-b'),
          commitmentId: 'b',
          teamId: 'payments',
          quarterId: '2026-Q4',
          units: 96,
          unitsSource: 'EXPLICIT',
          isPrimary: true,
        },
      ],
      [
        'fp-c',
        {
          ...env('fp-c'),
          commitmentId: 'c',
          teamId: 'platform',
          quarterId: '2026-Q3',
          units: 40,
          unitsSource: 'EXPLICIT',
          isPrimary: true,
        },
      ],
    ]),
  };
}

describe('M5 lens projections', () => {
  it('renders one timeline fragment per footprint, preserving carry-over and milestone meaning', () => {
    const model = buildTimeline(state(), 'QBR', 'TEAM');
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.fragments).toHaveLength(2);
    expect(model.rows[0]?.fragments.find((item) => item.footprintId === 'fp-b')?.carriedFrom).toBe(
      '2026-Q3',
    );
    expect(model.rows[0]?.milestones[0]).toMatchObject({ name: 'Pilot', quarterId: '2026-Q3' });
  });

  it('identifies a dependency cycle without making graph ordering unstable', () => {
    const graph = buildDependencyGraph(state());
    expect(graph.cycles).toHaveLength(1);
    expect(
      graph.nodes
        .filter((node) => node.cycleId !== undefined)
        .map((node) => node.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(graph.edges.map((edge) => edge.id)).toEqual(['dep-a', 'dep-b']);
  });

  it('searches only local, explicit indexed fields', () => {
    expect(searchWorkspace(state(), 'payment').map((item) => item.id)).toEqual(['a', 'team']);
    expect(searchWorkspace(state(), 'not a request')).toEqual([]);
  });
});

describe('Teams lens', () => {
  it('uses the spec 02 §3 aggregates from the same cell summaries as the board', () => {
    const fixture = teamsState();
    const model = buildTeamsLens(fixture, 'QBR');
    const board = buildBoard({
      workspace: fixture.workspace,
      teams: fixture.teams,
      teamQuarters: fixture.teamQuarters,
      commitments: fixture.commitments,
      footprints: fixture.footprints,
      horizon: 'QBR',
    });

    expect(model.quarters).toEqual(['2026-Q3', '2026-Q4', '2027-Q1']);
    expect(model.rows.map((row) => row.teamName)).toEqual(['Payments', 'Platform']);

    const payments = model.rows[0]!;
    expect(payments.load).toBe(156);
    expect(payments.capacity).toBe(160);
    expect(payments.overflowingCells).toBe(1);
    expect(payments.utilisationPercent).toBe(98);

    const q3 = model.quartersSummary[0]!;
    expect(q3.overflowCount).toBe(0);
    expect(q3.pressurePercent).toBe(63);
    const q4 = model.quartersSummary[1]!;
    expect(q4.overflowCount).toBe(1);
    expect(q4.pressurePercent).toBe(120);

    expect(model.totals.load).toBe(board.totals.load);
    expect(model.totals.capacity).toBe(board.totals.capacity);
    expect(model.totals.overflowingCells).toBe(board.totals.overflowingCells);
    expect(payments.load).toBe(board.rows[0]!.load);
    expect(payments.capacity).toBe(board.rows[0]!.capacity);
  });

  it('treats a missing team-quarter as unplanned, not as zero-capacity overflow', () => {
    const model = buildTeamsLens(teamsState(), 'QBR');
    const empty = model.rows[1]!.cells.find((cell) => cell.quarterId === '2026-Q4');
    expect(empty).toMatchObject({
      planned: false,
      load: 0,
      capacity: 0,
      overflow: 0,
      utilisationPercent: null,
      headroom: null,
    });
  });

  it('keeps team-horizon load equal to the sum of its cells', () => {
    for (const preset of ['NOW', 'QBR', 'HORIZON'] as const) {
      const model = buildTeamsLens(teamsState(), preset);
      for (const row of model.rows) {
        expect(row.load).toBe(row.cells.reduce((sum, cell) => sum + cell.load, 0));
        expect(row.capacity).toBe(row.cells.reduce((sum, cell) => sum + cell.capacity, 0));
        expect(row.overflowingCells).toBe(row.cells.filter((cell) => cell.overflow > 0).length);
      }
      expect(model.totals.load).toBe(model.rows.reduce((sum, row) => sum + row.load, 0));
    }
  });
});
