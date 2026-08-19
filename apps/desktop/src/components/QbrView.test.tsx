// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type WorkspaceState,
} from '@flowmap/domain';
import { NO_FILTER } from '@flowmap/visual-model';

import { QbrView } from './QbrView.jsx';

afterEach(cleanup);

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

function fixture(): WorkspaceState {
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
        'payments',
        {
          ...env('payments'),
          name: 'Payments',
          defaultQuarterCapacity: 100,
          displayOrder: 0,
          active: true,
        },
      ],
    ]),
    teamQuarters: new Map([
      [
        'tq',
        {
          ...env('tq'),
          teamId: 'payments',
          quarterId: '2026-Q3',
          capacityBaseline: 80,
          capacityAdjustment: 0,
          reserves: [],
        },
      ],
    ]),
    commitments: new Map([
      [
        'idea',
        {
          ...env('idea'),
          name: 'New intake',
          lifecycle: 'IDEA',
          class: 'DISCRETIONARY',
          importance: 'MEDIUM',
          valueDrivers: [],
        },
      ],
    ]),
    footprints: new Map(),
  };
}

describe('QbrView', () => {
  it('shows Demand Flow and containers, not the Portfolio map', () => {
    render(
      <QbrView
        state={fixture()}
        filter={NO_FILTER}
        scenarioId={null}
        defaultUnits={20}
        onPlace={() => undefined}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'QBR' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Demand Flow' })).toBeTruthy();
    expect(screen.getByRole('grid', { name: 'Team-quarter containers' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'QBR team-quarter capacity' })).toBeTruthy();
    expect(screen.queryByRole('grid', { name: /portfolio map/i })).toBeNull();
    expect(screen.queryByLabelText('QBR view')).toBeNull();
  });

  it('selects a container as the pipe target', async () => {
    const user = userEvent.setup();
    render(
      <QbrView
        state={fixture()}
        filter={NO_FILTER}
        scenarioId="scenario"
        defaultUnits={20}
        onPlace={() => undefined}
        onOpen={() => undefined}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Payments, 2026-Q3/ }));
    expect(
      screen.getByRole('button', { name: /Payments, 2026-Q3/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
