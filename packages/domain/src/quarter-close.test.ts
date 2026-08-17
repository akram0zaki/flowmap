import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Command, CommandContext, WorkspaceState } from './command.js';
import { closeQuarter, proposeCarryOver, reopenQuarter } from './quarter-close.js';
import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type Commitment,
  type Team,
  type TeamQuarter,
  type Workspace,
} from './entities.js';

const now = '2026-09-30T09:00:00Z';
let number = 0;
const context = (role: CommandContext['role'] = 'PLANNER'): CommandContext => ({
  clock: { now: () => now, today: () => '2026-09-30' },
  ids: { next: () => `id-${++number}` },
  actorId: 'planner',
  role,
  nextSequence: 1,
});
const command = (name: string): Command => ({
  id: `command-${name}`,
  name,
  workspaceId: 'workspace',
  payload: {},
  actorId: 'planner',
  issuedAt: now,
});
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
  const workspace: Workspace = {
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
  };
  const team: Team = {
    ...env('team'),
    name: 'Payments',
    defaultQuarterCapacity: 100,
    displayOrder: 0,
    active: true,
  };
  const teamQuarter: TeamQuarter = {
    ...env('team-quarter'),
    teamId: team.id,
    quarterId: '2026-Q3',
    capacityBaseline: 100,
    capacityAdjustment: 0,
    reserves: [],
  };
  const commitment: Commitment = {
    ...env('commitment'),
    name: 'Payments renewal',
    lifecycle: 'COMMITTED',
    class: 'STRATEGIC',
    importance: 'HIGH',
    valueDrivers: [],
  };
  return {
    workspace,
    teams: new Map([[team.id, team]]),
    teamQuarters: new Map([[teamQuarter.id, teamQuarter]]),
    commitments: new Map([[commitment.id, commitment]]),
    footprints: new Map([
      [
        'footprint',
        {
          ...env('footprint'),
          commitmentId: commitment.id,
          teamId: team.id,
          quarterId: '2026-Q3',
          units: 20,
          unitsSource: 'EXPLICIT',
          isPrimary: true,
        },
      ],
    ]),
  };
}

describe('quarter close', () => {
  it('proposes the closing units in the next ordinal quarter', () => {
    const proposal = proposeCarryOver(state(), '2026-Q3');
    expect(proposal).toHaveLength(1);
    expect(proposal[0]?.defaultDestination).toMatchObject({ quarterId: '2026-Q4', units: 20 });
  });

  it('refuses to close until every unfinished footprint has an explicit decision', () => {
    const result = closeQuarter(
      state(),
      { quarterId: '2026-Q3', outcomes: [], carryOver: [] },
      command('CloseQuarter'),
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CARRY_OVER_NOT_REVIEWED');
  });

  it('creates carry-over, preserves the origin, freezes containers and advances once', () => {
    const base = state();
    const proposal = proposeCarryOver(base, '2026-Q3')[0]!;
    const result = closeQuarter(
      base,
      {
        quarterId: '2026-Q3',
        outcomes: [{ teamId: 'team', operationalLoad: 'ABOUT', capacity: 'ABOUT' }],
        carryOver: [
          {
            originFootprintId: proposal.originFootprintId,
            action: 'CARRY',
            destinations: [proposal.defaultDestination],
          },
        ],
      },
      command('CloseQuarter'),
      context(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const origin = result.effects.changes.find(
      (change) => change.ref.kind === 'CAPACITY_FOOTPRINT' && change.ref.id === 'footprint',
    );
    const carried = result.effects.changes.find(
      (change) => change.ref.kind === 'CAPACITY_FOOTPRINT' && change.ref.id !== 'footprint',
    );
    const frozen = result.effects.changes.find(
      (change) => change.ref.kind === 'TEAM_QUARTER' && change.ref.id === 'team-quarter',
    );
    const workspace = result.effects.changes.find((change) => change.ref.kind === 'WORKSPACE');
    expect((origin?.after as { closedAsUnfinished?: boolean }).closedAsUnfinished).toBe(true);
    expect(carried?.after).toMatchObject({
      unitsSource: 'CARRY_OVER',
      carryOverFromQuarterId: '2026-Q3',
    });
    expect((frozen?.after as { closedAt?: string }).closedAt).toBe(now);
    expect(workspace?.after as { currentQuarterId: string; revision: number }).toMatchObject({
      currentQuarterId: '2026-Q4',
      revision: 2,
    });
    expect(result.effects.consequences?.some((item) => item.kind === 'IRREVERSIBLE')).toBe(true);
  });

  it('allows only an Admin to reopen and does not remove carry-over data', () => {
    const base = state();
    const result = reopenQuarter(
      {
        ...base,
        teamQuarters: new Map([
          ['team-quarter', { ...base.teamQuarters.get('team-quarter')!, closedAt: now }],
        ]),
      },
      { quarterId: '2026-Q3', confirmed: true },
      command('ReopenQuarter'),
      context('ADMIN'),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect((result.effects.changes[0]?.after as { closedAt?: string }).closedAt).toBeUndefined();
    const denied = reopenQuarter(
      base,
      { quarterId: '2026-Q3', confirmed: true },
      command('ReopenQuarter'),
      context('PLANNER'),
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('UNAUTHORISED');
  });

  it('preserves every source footprint while carrying exactly its reviewed units', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (units) => {
        const base = state();
        const source = { ...base.footprints.get('footprint')!, units };
        const input = { ...base, footprints: new Map([['footprint', source]]) };
        const proposal = proposeCarryOver(input, '2026-Q3')[0]!;
        const result = closeQuarter(
          input,
          {
            quarterId: '2026-Q3',
            outcomes: [{ teamId: 'team', operationalLoad: 'ABOUT', capacity: 'ABOUT' }],
            carryOver: [
              {
                originFootprintId: proposal.originFootprintId,
                action: 'CARRY',
                destinations: [proposal.defaultDestination],
              },
            ],
          },
          command(`Carry-${units}`),
          context(),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const sourceChange = result.effects.changes.find(
          (change) => change.ref.kind === 'CAPACITY_FOOTPRINT' && change.ref.id === 'footprint',
        );
        const carryChange = result.effects.changes.find(
          (change) => change.ref.kind === 'CAPACITY_FOOTPRINT' && change.ref.id !== 'footprint',
        );
        expect((sourceChange?.after as { units: number }).units).toBe(units);
        expect((carryChange?.after as { units: number }).units).toBe(units);
      }),
    );
  });
});
