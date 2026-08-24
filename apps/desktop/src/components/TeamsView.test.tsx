// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type WorkspaceState,
} from '@flowmap/domain';
import { NO_FILTER } from '@flowmap/visual-model';

import { TeamsView } from './TeamsView.jsx';

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
    ]),
  };
}

describe('TeamsView', () => {
  it('offers archive and blocks it while the team still holds work', () => {
    render(
      <TeamsView
        state={fixture()}
        filter={NO_FILTER}
        onOpenCell={() => undefined}
        onArchiveTeam={() => undefined}
      />,
    );

    const blocked = screen.getAllByRole('button', {
      name: 'Payments still has work on the board. Move or remove its footprints first.',
    });
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  /*
   * Reaching a team's BAU figure should not mean opening a dialog about where
   * the database lives and scrolling past the workspace defaults to a picker
   * for the team whose row you just clicked.
   */
  it('opens a team’s default allocations from its own row', async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(
      <TeamsView
        state={fixture()}
        filter={NO_FILTER}
        onOpenCell={() => undefined}
        onArchiveTeam={() => undefined}
        onOpenTeamSettings={(teamId) => opened.push(teamId)}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Default allocations for Payments' }));
    expect(opened).toHaveLength(1);
  });

  // Two buttons stacked cost a row of height on every team and push the grid
  // off the screen, so they share one row and wrap only when they must.
  it('puts Settings and Archive in one row together', () => {
    render(
      <TeamsView
        state={fixture()}
        filter={NO_FILTER}
        onOpenCell={() => undefined}
        onArchiveTeam={() => undefined}
        onOpenTeamSettings={() => undefined}
      />,
    );

    const actions = document.querySelectorAll('.fm-teams__actions');
    expect(actions.length).toBeGreaterThan(0);
    expect([...actions[0]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Settings',
      'Archive',
    ]);
  });

  // The board is read far more often than it is configured; a lens with no way
  // to edit teams must not grow buttons that do nothing.
  it('offers no team buttons when neither action is wired', () => {
    render(<TeamsView state={fixture()} filter={NO_FILTER} onOpenCell={() => undefined} />);
    expect(document.querySelector('.fm-teams__actions')).toBeNull();
  });

  it('shows horizon capacity instead of commitment blocks', () => {
    render(<TeamsView state={fixture()} filter={NO_FILTER} onOpenCell={() => undefined} />);

    expect(screen.getByRole('heading', { name: 'Teams' })).toBeTruthy();
    expect(screen.getByText(/can we take this/i)).toBeTruthy();
    expect(screen.getByRole('grid', { name: 'Team capacity across the horizon' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Team-quarter capacity' })).toBeTruthy();
    expect(screen.queryByText('Payment migration')).toBeNull();
    expect(screen.getByRole('button', { name: /Payments, 2026-Q3/ })).toBeTruthy();
  });

  it('opens the matching team-quarter on the Portfolio map from the grid and the table', async () => {
    const user = userEvent.setup();
    const opened: Array<readonly [string, string]> = [];
    render(
      <TeamsView
        state={fixture()}
        filter={NO_FILTER}
        onOpenCell={(teamId, quarterId) => {
          opened.push([teamId, quarterId]);
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Payments, 2026-Q3/ }));
    expect(opened).toEqual([['payments', '2026-Q3']]);

    const table = screen.getByRole('table', { name: 'Team-quarter capacity' });
    const tableRow = within(table)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('2026-Q3'));
    expect(tableRow).toBeTruthy();
    await user.click(within(tableRow!).getByRole('button', { name: 'Open on the Portfolio map' }));
    expect(opened).toEqual([
      ['payments', '2026-Q3'],
      ['payments', '2026-Q3'],
    ]);
  });

  it('moves between cells with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<TeamsView state={fixture()} filter={NO_FILTER} onOpenCell={() => undefined} />);

    const first = screen.getByRole('button', { name: /Payments, 2026-Q3/ });
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement?.getAttribute('data-quarter')).toBe('2026-Q4');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('data-quarter')).toBe('2026-Q3');
  });

  it('explains team load without treating it as utilisation of people', async () => {
    const user = userEvent.setup();
    render(<TeamsView state={fixture()} filter={NO_FILTER} onOpenCell={() => undefined} />);

    await user.click(screen.getByRole('button', { name: 'What does Team load mean?' }));
    expect(screen.getByText(/Counted committed units for this team/i)).toBeTruthy();
    expect(screen.getByText(/how busy people are/i)).toBeTruthy();
  });

  it('shows an empty state when the workspace has no teams', () => {
    const empty = fixture();
    render(
      <TeamsView
        state={{ ...empty, teams: new Map() }}
        filter={NO_FILTER}
        onOpenCell={() => undefined}
      />,
    );
    expect(screen.getByText('No teams have been added yet.')).toBeTruthy();
  });
});
