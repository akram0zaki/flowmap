import { describe, expect, it } from 'vitest';

import type { WorkspaceState } from '@flowmap/domain';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
} from '@flowmap/domain';

import { buildDependencyGraph, buildTimeline, searchWorkspace } from './lenses.js';

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
