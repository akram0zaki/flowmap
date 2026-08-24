import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type {
  CapacityFootprint,
  Commitment,
  Team,
  TeamQuarter,
  WorkspaceState,
} from '@flowmap/domain';

import { toWorkbook, workspaceDataSheets } from './index.js';
import {
  PORTFOLIO_WALL_SHEET,
  TIMELINE_SHEET,
  portfolioWallModel,
  timelineExportModel,
} from './graphical-sheets.js';

const NOW = '2026-08-17T10:00:00.000Z';

function env(id: string) {
  return {
    id,
    workspaceId: 'workspace',
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'planner',
    updatedAt: NOW,
    updatedBy: 'planner',
  };
}

function base(): WorkspaceState {
  const payments: Team = {
    ...env('payments'),
    name: 'Payments',
    defaultQuarterCapacity: 100,
    displayOrder: 0,
    active: true,
  };
  const platform: Team = {
    ...env('platform'),
    name: 'Platform',
    defaultQuarterCapacity: 100,
    displayOrder: 1,
    active: true,
  };
  const tq: TeamQuarter = {
    ...env('tq-p-q3'),
    teamId: 'payments',
    quarterId: '2026-Q3',
    capacityBaseline: 100,
    capacityAdjustment: 0,
    reserves: [{ id: 'r1', type: 'BAU_SUPPORT', label: 'BAU', amount: 20 }],
  };
  const tqOver: TeamQuarter = {
    ...env('tq-p-q4'),
    teamId: 'payments',
    quarterId: '2026-Q4',
    capacityBaseline: 100,
    capacityAdjustment: 0,
    reserves: [{ id: 'r2', type: 'BAU_SUPPORT', label: 'BAU', amount: 20 }],
  };
  const sepa: Commitment = {
    ...env('sepa'),
    name: 'SEPA instant payments',
    lifecycle: 'COMMITTED',
    class: 'STRATEGIC',
    importance: 'HIGH',
    valueDrivers: [],
    primaryTeamId: 'payments',
  };
  const dropped: Commitment = {
    ...env('gone'),
    name: 'Dropped idea',
    lifecycle: 'DROPPED',
    class: 'DISCRETIONARY',
    importance: 'LOW',
    valueDrivers: [],
  };
  const sepaQ3: CapacityFootprint = {
    ...env('fp-sepa-q3'),
    commitmentId: 'sepa',
    teamId: 'payments',
    quarterId: '2026-Q3',
    units: 20,
    unitsSource: 'EXPLICIT',
    isPrimary: true,
  };
  const sepaQ4: CapacityFootprint = {
    ...env('fp-sepa-q4'),
    commitmentId: 'sepa',
    teamId: 'payments',
    quarterId: '2026-Q4',
    units: 70,
    unitsSource: 'EXPLICIT',
    isPrimary: true,
  };

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
          sizeMapping: { XS: 5, S: 10, M: 20, L: 35 },
          defaultReserves: [],
        },
        changeLoad: {
          impactBase: { PRIMARY: 3, MAJOR: 2, MINOR: 0.5, DEPENDENCY: 0.25 },
          referenceUnits: 20,
          mandatoryFactor: 1.5,
          thresholdMedium: 6,
          thresholdHigh: 12,
        },
        valueDrivers: [],
        noteMaxLength: 2000,
        milestonesPerCommitment: 6,
      },
    },
    teams: new Map([
      ['payments', payments],
      ['platform', platform],
    ]),
    teamQuarters: new Map([
      [tq.id, tq],
      [tqOver.id, tqOver],
    ]),
    commitments: new Map([
      [sepa.id, sepa],
      [dropped.id, dropped],
    ]),
    footprints: new Map([
      [sepaQ3.id, sepaQ3],
      [sepaQ4.id, sepaQ4],
    ]),
  };
}

describe('portfolio wall model', () => {
  it('lays teams as rows and the horizon as columns, and says what each cell holds', () => {
    const wall = portfolioWallModel(base());
    expect(wall.quarters[0]).toBe('2026-Q2');
    expect(wall.currentQuarterId).toBe('2026-Q3');
    expect(wall.rows.map((row) => row.team)).toEqual(['Payments', 'Platform']);

    const q3 = wall.rows[0]!.cells.find((cell) => cell.quarterId === '2026-Q3');
    expect(q3?.current).toBe(true);
    expect(q3?.bar).toMatch(/█/);
    expect(q3?.text).toContain('SEPA instant payments · 20');
    expect(q3?.text).toMatch(/25%/);

    const empty = wall.rows[0]!.cells.find((cell) => cell.quarterId === '2026-Q2');
    expect(empty?.text).toBe('—');
    expect(empty?.tone).toBe('none');
  });

  it('states overflow in units and percent, never colour alone', () => {
    const origin = base();
    const extra: Commitment = {
      ...env('extra'),
      name: 'Card proposition',
      lifecycle: 'COMMITTED',
      class: 'STRATEGIC',
      importance: 'HIGH',
      valueDrivers: [],
      primaryTeamId: 'payments',
    };
    const extraFootprint: CapacityFootprint = {
      ...env('fp-extra'),
      commitmentId: 'extra',
      teamId: 'payments',
      quarterId: '2026-Q4',
      units: 20,
      unitsSource: 'EXPLICIT',
      isPrimary: true,
    };
    const state: WorkspaceState = {
      ...origin,
      commitments: new Map([...origin.commitments, [extra.id, extra]]),
      footprints: new Map([...origin.footprints, [extraFootprint.id, extraFootprint]]),
    };
    const q4 = portfolioWallModel(state).rows[0]!.cells.find(
      (cell) => cell.quarterId === '2026-Q4',
    );
    expect(q4?.tone).toBe('over');
    expect(q4?.text).toContain('▲ Over by');
  });

  it('does not put dropped work on the wall', () => {
    const origin = base();
    const gone: CapacityFootprint = {
      ...env('fp-gone'),
      commitmentId: 'gone',
      teamId: 'payments',
      quarterId: '2026-Q3',
      units: 10,
      unitsSource: 'EXPLICIT',
      isPrimary: false,
    };
    const state: WorkspaceState = {
      ...origin,
      footprints: new Map([...origin.footprints, [gone.id, gone]]),
    };
    const q3 = portfolioWallModel(state).rows[0]!.cells.find(
      (cell) => cell.quarterId === '2026-Q3',
    );
    expect(q3?.text).not.toContain('Dropped idea');
  });
});

describe('timeline export model', () => {
  it('places one segment per quarter so Excel can filter and draw data bars', () => {
    const timeline = timelineExportModel(base());
    expect(timeline.caption).toContain('Not a schedule');
    expect(timeline.rows).toHaveLength(1);
    expect(timeline.rows[0]!.commitment).toBe('SEPA instant payments');
    expect(timeline.rows[0]!.lifecycle).toBe('COMMITTED');
    expect(timeline.rows[0]!.segments).toEqual([
      { quarterId: '2026-Q3', units: 20, counted: true },
      { quarterId: '2026-Q4', units: 70, counted: true },
    ]);
  });

  it('omits dropped commitments', () => {
    const origin = base();
    const gone: CapacityFootprint = {
      ...env('fp-gone'),
      commitmentId: 'gone',
      teamId: 'payments',
      quarterId: '2026-Q3',
      units: 10,
      unitsSource: 'EXPLICIT',
      isPrimary: false,
    };
    const state: WorkspaceState = {
      ...origin,
      footprints: new Map([...origin.footprints, [gone.id, gone]]),
    };
    expect(timelineExportModel(state).rows.map((row) => row.commitment)).toEqual([
      'SEPA instant payments',
    ]);
  });
});

describe('workspace workbook includes the graphical sheets', () => {
  it('adds Portfolio wall and Timeline after the data tabs', async () => {
    const bytes = await toWorkbook(
      workspaceDataSheets(base()),
      {
        workspace: 'Portfolio',
        exportedAt: NOW,
        schemaVersion: 1,
      },
      { state: base() },
    );

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    const names = book.worksheets.map((sheet) => sheet.name);
    expect(names).toContain(PORTFOLIO_WALL_SHEET);
    expect(names).toContain(TIMELINE_SHEET);
    expect(names.indexOf('_README')).toBe(0);
    expect(names.indexOf(PORTFOLIO_WALL_SHEET)).toBe(1);
    expect(names.indexOf(TIMELINE_SHEET)).toBe(2);

    const wall = book.getWorksheet(PORTFOLIO_WALL_SHEET);
    expect(wall?.getCell(3, 3).value).toBe('2026-Q3 · now');
    expect(String(wall?.getCell(4, 1).value)).toBe('Payments');
    expect(wall?.getCell(4, 3).text).toContain('SEPA instant payments');
    expect(wall?.getCell(4, 3).text).toMatch(/█|░/);
    expect(wall?.autoFilter).toBeTruthy();

    const timeline = book.getWorksheet(TIMELINE_SHEET);
    expect(String(timeline?.getCell(2, 1).value)).toContain('Not a schedule');
    expect(String(timeline?.getCell(4, 2).value)).toBe('SEPA instant payments');
    expect(String(timeline?.getCell(4, 3).value)).toBe('COMMITTED');
    expect(timeline?.getCell(4, 5).value).toBe(20);
    expect(timeline?.getCell(4, 6).value).toBe(70);
    expect(timeline?.autoFilter).toBeTruthy();
  });

  it('does not add graphical sheets to a current-view workbook', async () => {
    const bytes = await toWorkbook([{ name: 'Rows', rows: [{ name: 'A' }] }], {
      workspace: 'Portfolio',
      exportedAt: NOW,
      schemaVersion: 1,
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['_README', 'Rows']);
  });
});
