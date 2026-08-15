import { describe, expect, it } from 'vitest';
import {
  aggregateCapacity,
  type CapacityFootprint,
  type Commitment,
  type Team,
  type TeamQuarter,
  type Workspace,
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
} from '@flowmap/domain';

import { allBlocks, buildBoard, findCell, type BoardInput } from './layout.js';
import {
  focusOn,
  isBlockFocused,
  isCellFocused,
  levelForScale,
  matchesFilter,
  NO_FILTER,
  filterChips,
  scaleForLevel,
  setLevel,
  setScale,
  toggleFilterValue,
  INITIAL_VIEW,
  clampScale,
  isFilterActive,
} from './zoom.js';

const NOW = '2026-08-15T09:00:00Z';
const WS = 'ws';

function env(id: string) {
  return {
    id,
    workspaceId: WS,
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'a',
    updatedAt: NOW,
    updatedBy: 'a',
  };
}

const workspace: Workspace = {
  ...env(WS),
  name: 'W',
  timezone: 'UTC',
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

function team(id: string, name: string, displayOrder: number): Team {
  return { ...env(id), name, defaultQuarterCapacity: 100, displayOrder, active: true };
}

function container(teamId: string, quarterId: string, reserveAmount = 20): TeamQuarter {
  return {
    ...env(`tq-${teamId}-${quarterId}`),
    teamId,
    quarterId: quarterId as TeamQuarter['quarterId'],
    capacityBaseline: 100,
    capacityAdjustment: 0,
    reserves: [
      { id: `r-${teamId}-${quarterId}`, type: 'BAU_SUPPORT', label: 'BAU', amount: reserveAmount },
    ],
  };
}

function commitment(id: string, over: Partial<Commitment> = {}): Commitment {
  return {
    ...env(id),
    name: id,
    lifecycle: 'COMMITTED',
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    valueDrivers: [],
    ...over,
  };
}

function footprint(
  id: string,
  commitmentId: string,
  teamId: string,
  quarterId: string,
  units: number,
  over: Partial<CapacityFootprint> = {},
): CapacityFootprint {
  return {
    ...env(id),
    commitmentId,
    teamId,
    quarterId: quarterId as CapacityFootprint['quarterId'],
    units,
    unitsSource: 'EXPLICIT',
    isPrimary: false,
    ...over,
  };
}

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    workspace,
    teams: new Map([
      ['t-b', team('t-b', 'Bravo', 1)],
      ['t-a', team('t-a', 'Alpha', 0)],
    ]),
    teamQuarters: new Map([
      ['tq1', container('t-a', '2026-Q3')],
      ['tq2', container('t-b', '2026-Q3')],
    ]),
    commitments: new Map([['c-1', commitment('c-1')]]),
    footprints: new Map([['f-1', footprint('f-1', 'c-1', 't-a', '2026-Q3', 30)]]),
    ...over,
  };
}

// ── Grammar ────────────────────────────────────────────────────────────────

describe('board grammar', () => {
  it('runs quarters left to right across the horizon', () => {
    const board = buildBoard(input());
    expect(board.quarters).toEqual([
      '2026-Q2',
      '2026-Q3',
      '2026-Q4',
      '2027-Q1',
      '2027-Q2',
      '2027-Q3',
    ]);
  });

  it('reports where the current quarter sits, so it can be centred', () => {
    const board = buildBoard(input());
    expect(board.currentQuarterIndex).toBe(1);
    expect(board.quarters[board.currentQuarterIndex]).toBe('2026-Q3');
  });

  it('makes teams the rows, in explicit display order', () => {
    const board = buildBoard(input());
    expect(board.rows.map((r) => r.teamName)).toEqual(['Alpha', 'Bravo']);
  });

  // A map that rearranges itself cannot be learned.
  it('never reorders rows by pressure', () => {
    const overloaded = input({
      footprints: new Map([['f-1', footprint('f-1', 'c-1', 't-b', '2026-Q3', 500)]]),
    });
    const board = buildBoard(overloaded);
    expect(board.rows.map((r) => r.teamName)).toEqual(['Alpha', 'Bravo']);
  });

  it('falls back to alphabetical when display order ties', () => {
    const board = buildBoard(
      input({
        teams: new Map([
          ['t-z', team('t-z', 'Zulu', 0)],
          ['t-a', team('t-a', 'Alpha', 0)],
        ]),
      }),
    );
    expect(board.rows.map((r) => r.teamName)).toEqual(['Alpha', 'Zulu']);
  });

  it('gives every team a cell in every horizon quarter, even without a container', () => {
    const board = buildBoard(input());
    for (const row of board.rows) expect(row.cells).toHaveLength(6);

    const empty = findCell(board, 't-a', '2027-Q1');
    expect(empty?.teamQuarter).toBeNull();
    expect(empty?.summary).toBeNull();
    expect(empty?.blocks).toEqual([]);
  });

  it('excludes archived teams', () => {
    const board = buildBoard(
      input({
        teams: new Map([
          ['t-a', team('t-a', 'Alpha', 0)],
          ['t-b', { ...team('t-b', 'Bravo', 1), archivedAt: NOW }],
        ]),
      }),
    );
    expect(board.rows.map((r) => r.teamName)).toEqual(['Alpha']);
  });
});

// ── Block stacking ─────────────────────────────────────────────────────────

describe('block stacking', () => {
  it('stacks from the top of the reserve plinth upward', () => {
    const board = buildBoard(input());
    const block = findCell(board, 't-a', '2026-Q3')!.blocks[0]!;

    // Reserve is 20, so the first block starts there rather than at zero.
    expect(block.bottomUnits).toBe(20);
    expect(block.topUnits).toBe(50);
  });

  it('orders mandatory first, then largest, then by name', () => {
    const board = buildBoard(
      input({
        commitments: new Map([
          ['big', commitment('big')],
          ['small', commitment('small')],
          ['must', commitment('must', { class: 'MANDATORY' })],
        ]),
        footprints: new Map([
          ['f1', footprint('f1', 'big', 't-a', '2026-Q3', 30)],
          ['f2', footprint('f2', 'small', 't-a', '2026-Q3', 10)],
          ['f3', footprint('f3', 'must', 't-a', '2026-Q3', 5)],
        ]),
      }),
    );
    expect(findCell(board, 't-a', '2026-Q3')!.blocks.map((b) => b.name)).toEqual([
      'must',
      'big',
      'small',
    ]);
  });

  it('marks blocks that rise above the deliverable-capacity rule', () => {
    const board = buildBoard(
      input({ footprints: new Map([['f-1', footprint('f-1', 'c-1', 't-a', '2026-Q3', 95)]]) }),
    );
    const block = findCell(board, 't-a', '2026-Q3')!.blocks[0]!;
    // Deliverable is 80; the block runs 20 -> 115, past the 100 ceiling.
    expect(block.overflowing).toBe(true);
  });

  // Uncounted work is shown, never hidden — but it must not displace the stack.
  it('draws uncounted blocks without advancing the stack', () => {
    const board = buildBoard(
      input({
        commitments: new Map([
          ['idea', commitment('idea', { lifecycle: 'IDEA' })],
          ['live', commitment('live')],
        ]),
        footprints: new Map([
          ['f1', footprint('f1', 'idea', 't-a', '2026-Q3', 30)],
          ['f2', footprint('f2', 'live', 't-a', '2026-Q3', 30)],
        ]),
      }),
    );

    const blocks = findCell(board, 't-a', '2026-Q3')!.blocks;
    const idea = blocks.find((b) => b.name === 'idea')!;
    const live = blocks.find((b) => b.name === 'live')!;

    expect(idea.counted).toBe(false);
    expect(live.counted).toBe(true);
    expect(live.bottomUnits, 'the uncounted block did not push the live one up').toBe(20);
  });

  it('carries the carry-over origin quarter onto the block', () => {
    const board = buildBoard(
      input({
        footprints: new Map([
          [
            'f-1',
            footprint('f-1', 'c-1', 't-a', '2026-Q3', 10, { carryOverFromQuarterId: '2026-Q2' }),
          ],
        ]),
      }),
    );
    expect(findCell(board, 't-a', '2026-Q3')!.blocks[0]!.carriedFromQuarterId).toBe('2026-Q2');
  });

  it('ignores footprints whose commitment is archived', () => {
    const board = buildBoard(
      input({ commitments: new Map([['c-1', commitment('c-1', { archivedAt: NOW })]]) }),
    );
    expect(findCell(board, 't-a', '2026-Q3')!.blocks).toEqual([]);
  });
});

// ── Aggregates ─────────────────────────────────────────────────────────────

describe('aggregates', () => {
  it('agrees with the domain projection cell by cell', () => {
    const board = buildBoard(input());
    const summaries = board.rows
      .flatMap((r) => r.cells)
      .map((c) => c.summary)
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const aggregate = aggregateCapacity(summaries);
    expect(board.totals.load).toBe(aggregate.load);
    expect(board.totals.capacity).toBe(aggregate.capacity);
    expect(board.totals.overflowingCells).toBe(aggregate.overflowingCells);
  });

  it('sums row totals from its own cells', () => {
    const board = buildBoard(input());
    for (const row of board.rows) {
      expect(row.load).toBe(row.cells.reduce((s, c) => s + (c.summary?.committedLoad ?? 0), 0));
    }
  });
});

// ── Ideas lane ─────────────────────────────────────────────────────────────

describe('ideas lane', () => {
  it('keeps Ideas out of the capacity grid entirely', () => {
    const board = buildBoard(
      input({
        commitments: new Map([['i-1', commitment('i-1', { lifecycle: 'IDEA' })]]),
        footprints: new Map(),
      }),
    );

    expect(board.ideas.map((i) => i.name)).toEqual(['i-1']);
    expect(allBlocks(board)).toEqual([]);
  });

  it('exposes refinement-reserve links — the only way an Idea touches the grid', () => {
    const withLink = container('t-a', '2026-Q3');
    const board = buildBoard(
      input({
        commitments: new Map([['i-1', commitment('i-1', { lifecycle: 'IDEA' })]]),
        footprints: new Map(),
        teamQuarters: new Map([
          [
            'tq1',
            {
              ...withLink,
              reserves: [
                {
                  id: 'r1',
                  type: 'REFINEMENT',
                  label: 'Refinement',
                  amount: 5,
                  linkedIdeaIds: ['i-1'],
                },
              ],
            },
          ],
        ]),
      }),
    );

    expect(board.ideas[0]!.refinementLinks).toEqual([{ teamId: 't-a', quarterId: '2026-Q3' }]);
  });

  it('orders Ideas by target quarter, then name, with untargeted last', () => {
    const board = buildBoard(
      input({
        commitments: new Map([
          ['z', commitment('z', { lifecycle: 'IDEA' })],
          ['b', commitment('b', { lifecycle: 'IDEA', targetQuarterId: '2027-Q1' })],
          ['a', commitment('a', { lifecycle: 'IDEA', targetQuarterId: '2026-Q3' })],
        ]),
        footprints: new Map(),
      }),
    );
    expect(board.ideas.map((i) => i.name)).toEqual(['a', 'b', 'z']);
  });
});

// ── Zoom ───────────────────────────────────────────────────────────────────

describe('semantic zoom', () => {
  it.each([
    [0.35, 1],
    [0.59, 1],
    [0.6, 2],
    [1, 2],
    [1.39, 2],
    [1.4, 3],
    [2.5, 3],
  ] as const)('scale %s is level %i', (scale, level) => {
    expect(levelForScale(scale)).toBe(level);
  });

  it('round-trips the explicit Level control', () => {
    for (const level of [1, 2, 3] as const) {
      expect(levelForScale(scaleForLevel(level))).toBe(level);
    }
  });

  it('clamps scale to the usable range', () => {
    expect(clampScale(0.01)).toBe(0.35);
    expect(clampScale(99)).toBe(2.5);
  });

  it('keeps level and scale consistent through the view state', () => {
    expect(setScale(INITIAL_VIEW, 0.4).level).toBe(1);
    expect(setLevel(INITIAL_VIEW, 3).scale).toBe(scaleForLevel(3));
    expect(setLevel(INITIAL_VIEW, 3).level).toBe(3);
  });
});

// ── Focus ──────────────────────────────────────────────────────────────────

describe('focus mode', () => {
  const multiTeam = input({
    commitments: new Map([
      ['c-1', commitment('c-1')],
      ['c-2', commitment('c-2')],
    ]),
    footprints: new Map([
      ['f1', footprint('f1', 'c-1', 't-a', '2026-Q3', 10)],
      ['f2', footprint('f2', 'c-1', 't-b', '2026-Q3', 10)],
      ['f3', footprint('f3', 'c-2', 't-a', '2026-Q3', 10)],
    ]),
  });

  // The point of focus: all footprints, not just the one that was clicked.
  it('relates every footprint of the commitment across teams and quarters', () => {
    const board = buildBoard(multiTeam);
    const focus = focusOn(board, 'c-1');

    expect(focus.relatedFootprintIds.size).toBe(2);
    expect([...focus.relatedTeamIds].sort()).toEqual(['t-a', 't-b']);
    expect([...focus.relatedQuarterIds]).toEqual(['2026-Q3']);
  });

  it('recedes unrelated blocks and cells', () => {
    const board = buildBoard(multiTeam);
    const focus = focusOn(board, 'c-1');
    const blocks = allBlocks(board);

    expect(
      isBlockFocused(
        focus,
        blocks.find((b) => b.commitmentId === 'c-1')!,
      ),
    ).toBe(true);
    expect(
      isBlockFocused(
        focus,
        blocks.find((b) => b.commitmentId === 'c-2')!,
      ),
    ).toBe(false);
    expect(isCellFocused(focus, findCell(board, 't-a', '2027-Q1')!)).toBe(false);
  });

  it('emphasises everything when nothing is focused', () => {
    const board = buildBoard(multiTeam);
    for (const block of allBlocks(board)) {
      expect(isBlockFocused(focusOn(board, null), block)).toBe(true);
    }
  });
});

// ── Filters ────────────────────────────────────────────────────────────────

describe('filters', () => {
  const board = buildBoard(
    input({
      commitments: new Map([
        ['c-1', commitment('c-1', { class: 'MANDATORY' })],
        ['c-2', commitment('c-2', { lifecycle: 'IDEA' })],
      ]),
      footprints: new Map([
        ['f1', footprint('f1', 'c-1', 't-a', '2026-Q3', 10)],
        ['f2', footprint('f2', 'c-2', 't-b', '2026-Q3', 10)],
      ]),
    }),
  );
  const blocks = allBlocks(board);

  it('matches everything when inactive', () => {
    expect(isFilterActive(NO_FILTER)).toBe(false);
    for (const block of blocks) expect(matchesFilter(NO_FILTER, block, block.cell)).toBe(true);
  });

  it('filters by team, quarter, class, lifecycle and text', () => {
    const byTeam = { ...NO_FILTER, teams: ['t-a'] };
    expect(blocks.filter((b) => matchesFilter(byTeam, b, b.cell))).toHaveLength(1);

    const byClass = { ...NO_FILTER, classes: ['MANDATORY' as const] };
    expect(blocks.filter((b) => matchesFilter(byClass, b, b.cell))[0]!.commitmentId).toBe('c-1');

    const byLifecycle = { ...NO_FILTER, lifecycles: ['IDEA' as const] };
    expect(blocks.filter((b) => matchesFilter(byLifecycle, b, b.cell))[0]!.commitmentId).toBe(
      'c-2',
    );

    const byQuarter = { ...NO_FILTER, quarters: ['2027-Q1' as const] };
    expect(blocks.filter((b) => matchesFilter(byQuarter, b, b.cell))).toHaveLength(0);

    const byText = { ...NO_FILTER, text: 'C-1' };
    expect(blocks.filter((b) => matchesFilter(byText, b, b.cell))[0]!.commitmentId).toBe('c-1');
  });

  it('combines filters with AND', () => {
    const both = { ...NO_FILTER, teams: ['t-a'], classes: ['DISCRETIONARY' as const] };
    expect(blocks.filter((b) => matchesFilter(both, b, b.cell))).toHaveLength(0);
  });

  // Fade is the default; hiding is opt-in, so spatial context survives.
  it('defaults to fading rather than hiding', () => {
    expect(NO_FILTER.hideFiltered).toBe(false);
  });

  it('toggles values on and off', () => {
    const once = toggleFilterValue(NO_FILTER, 'teams', 't-a');
    expect(once.teams).toEqual(['t-a']);
    expect(toggleFilterValue(once, 'teams', 't-a').teams).toEqual([]);
  });

  it('exposes a chip per active filter, so what is filtered is visible', () => {
    const filter = { ...NO_FILTER, teams: ['t-a'], quarters: ['2026-Q3' as const], text: 'sepa' };
    expect(filterChips(filter).map((c) => c.key)).toEqual(['quarter:2026-Q3', 'team:t-a', 'text']);
  });
});

// ── Concentration signals ──────────────────────────────────────────────────

describe('cell signals', () => {
  const board = buildBoard(
    input({
      // A cell only has blocks if its container exists, so Q4 needs one too.
      teamQuarters: new Map([
        ['tq1', container('t-a', '2026-Q3')],
        ['tq2', container('t-b', '2026-Q3')],
        ['tq3', container('t-a', '2026-Q4')],
      ]),
      commitments: new Map([
        ['must', commitment('must', { class: 'MANDATORY' })],
        ['movable', commitment('movable')],
        ['held', commitment('held', { lifecycle: 'ON_HOLD' })],
      ]),
      footprints: new Map([
        ['f1', footprint('f1', 'must', 't-a', '2026-Q3', 30)],
        ['f2', footprint('f2', 'movable', 't-a', '2026-Q3', 10)],
        ['f3', footprint('f3', 'held', 't-a', '2026-Q3', 25, {})],
        [
          'f4',
          footprint('f4', 'movable', 't-a', '2026-Q4', 20, { carryOverFromQuarterId: '2026-Q3' }),
        ],
      ]),
    }),
  );

  it('separates work that cannot move from work that can', () => {
    const signals = findCell(board, 't-a', '2026-Q3')!.signals;
    expect(signals.mandatoryUnits).toBe(30);
    expect(signals.mandatoryShare).toBeCloseTo(30 / 40);
  });

  it('counts held work as present but not consuming', () => {
    const signals = findCell(board, 't-a', '2026-Q3')!.signals;
    expect(signals.uncountedUnits).toBe(25);
    expect(signals.commitmentCount).toBe(3);
  });

  it('reports carried units on the receiving quarter', () => {
    expect(findCell(board, 't-a', '2026-Q4')!.signals.carriedUnits).toBe(20);
    expect(findCell(board, 't-a', '2026-Q3')!.signals.carriedUnits).toBe(0);
  });

  it('reports no mandatory share when nothing is counted', () => {
    const empty = buildBoard(input({ footprints: new Map() }));
    expect(findCell(empty, 't-a', '2026-Q3')!.signals.mandatoryShare).toBe(0);
  });

  it('rolls signals up to the row', () => {
    const row = board.rows.find((r) => r.teamId === 't-a')!;
    expect(row.mandatoryUnits).toBe(30);
    expect(row.carriedUnits).toBe(20);
  });
});
