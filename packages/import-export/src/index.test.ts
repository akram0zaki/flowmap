import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { WorkspaceState } from '@flowmap/domain';
import { ALL_RULES, evaluateAll, NO_RULE_SETTINGS } from '@flowmap/rules';

import {
  createPortableWorkspace,
  decodePortableWorkspace,
  encodePortableWorkspace,
  errorCsv,
  mapRows,
  parseCsv,
  parseQuarter,
  parseXlsx,
  previewImport,
  rehydratePortableWorkspace,
  suggestMappings,
  toWorkbook,
  toXlsx,
  workspaceDataSheets,
} from './index.js';

const NOW = '2026-08-17T10:00:00.000Z';

function state(): WorkspaceState {
  return {
    workspace: {
      id: 'workspace',
      workspaceId: 'workspace',
      schemaVersion: 1,
      entityVersion: 1,
      createdAt: NOW,
      createdBy: 'planner',
      updatedAt: NOW,
      updatedBy: 'planner',
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
      [
        'team',
        {
          id: 'team',
          workspaceId: 'workspace',
          schemaVersion: 1,
          entityVersion: 1,
          createdAt: NOW,
          createdBy: 'planner',
          updatedAt: NOW,
          updatedBy: 'planner',
          name: 'Payments',
          defaultQuarterCapacity: 100,
          displayOrder: 0,
          active: true,
        },
      ],
    ]),
    teamQuarters: new Map(),
    commitments: new Map(),
    footprints: new Map(),
  };
}

describe('import mapping', () => {
  it('parses quoted CSV rows and proposes deterministic header mappings', () => {
    const csv = parseCsv('External ID,Name,Quarter\nABC-1,"Payments, phase 2",Q3 2026');

    expect(csv.rows[0]).toEqual({
      'External ID': 'ABC-1',
      Name: 'Payments, phase 2',
      Quarter: 'Q3 2026',
    });
    expect(suggestMappings(csv.columns)).toEqual([
      { field: 'externalKey', column: 'External ID', confidence: 'HIGH' },
      { field: 'name', column: 'Name', confidence: 'HIGH' },
      { field: 'quarter', column: 'Quarter', confidence: 'HIGH' },
    ]);
  });

  it('keeps unmapped enum values as row-level errors and never guesses duplicates', () => {
    const mapped = mapRows(
      [{ Key: 'K-1', Name: 'Payments', State: 'unknown' }],
      [
        { field: 'externalKey', column: 'Key', confidence: 'HIGH' },
        { field: 'name', column: 'Name', confidence: 'HIGH' },
        { field: 'lifecycle', column: 'State', confidence: 'HIGH' },
      ],
      { lifecycle: { idea: 'IDEA' } },
    );
    const preview = previewImport(mapped.rows, mapped.errors, [
      { id: 'existing', name: 'Payments', externalKey: 'K-2' },
    ]);

    expect(preview.creates).toHaveLength(1);
    expect(preview.updates).toHaveLength(0);
    expect(preview.possibleDuplicates).toEqual([
      { row: 2, existingId: 'existing', name: 'Payments' },
    ]);
    expect(errorCsv(preview.errors)).toContain('INVALID_ENUM');
  });

  it('normalises every supported quarter representation', () => {
    expect(['2026-Q4', '2026Q4', 'Q4 2026', '2026-11-17'].map(parseQuarter)).toEqual([
      '2026-Q4',
      '2026-Q4',
      '2026-Q4',
      '2026-Q4',
    ]);
  });

  it('reads an XLSX sheet into the same tabular shape', () => {
    const parsed = parseXlsx(toXlsx([{ Name: 'Payments', Units: 20 }], 'Teams'));

    expect(parsed.sheets).toEqual([
      { name: 'Teams', columns: ['Name', 'Units'], rows: [{ Name: 'Payments', Units: '20' }] },
    ]);
  });

  it('builds entity-aware plans and preserves the workspace export sheets', () => {
    const mapped = mapRows(
      [{ Team: '', Quarter: '2026-Q3', Units: '20' }],
      [
        { field: 'team', column: 'Team', confidence: 'HIGH' },
        { field: 'quarter', column: 'Quarter', confidence: 'HIGH' },
        { field: 'units', column: 'Units', confidence: 'HIGH' },
      ],
      {},
      'CAPACITY_FOOTPRINT',
    );
    expect(mapped.errors).toContainEqual(expect.objectContaining({ code: 'REQUIRED' }));
    expect(workspaceDataSheets(state()).find((sheet) => sheet.name === 'teams')?.rows).toHaveLength(
      1,
    );
    expect(
      parseXlsx(
        toWorkbook([{ name: 'Rows', rows: [{ name: 'A' }] }], {
          workspace: 'Portfolio',
          exportedAt: NOW,
          schemaVersion: 1,
        }),
      ).sheets.map((sheet) => sheet.name),
    ).toEqual(['_README', 'Rows']);
  });
});

describe('portable workspace', () => {
  it('round-trips canonical workspace content and verifies its hash', async () => {
    const pkg = await createPortableWorkspace({
      state: state(),
      exportedAt: NOW,
      exportedBy: 'planner',
      appVersion: '0.0.0-test',
    });
    const decoded = await decodePortableWorkspace(encodePortableWorkspace(pkg));

    expect(decoded.manifest.contentHash).toBe(pkg.manifest.contentHash);
    expect(decoded.workspace).toEqual(pkg.workspace);
    expect(decoded.entities['teams']).toEqual(pkg.entities['teams']);
  });

  it('preserves the projection for arbitrary workspace names and team collections', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[A-Za-z]{1,24}$/),
        fc.array(fc.stringMatching(/^[A-Za-z]{1,16}$/), { maxLength: 8 }),
        async (workspaceName, names) => {
          const original = state();
          const teams = new Map(
            names.map((name, index) => [
              `team-${index}`,
              {
                ...original.teams.values().next().value!,
                id: `team-${index}`,
                name,
                displayOrder: index,
              },
            ]),
          );
          const source = {
            ...original,
            workspace: { ...original.workspace, name: workspaceName },
            teams,
          };
          const pkg = await createPortableWorkspace({
            state: source,
            exportedAt: NOW,
            exportedBy: 'planner',
            appVersion: '0.0.0-test',
          });
          const decoded = await decodePortableWorkspace(encodePortableWorkspace(pkg));

          expect(decoded.workspace).toEqual(source.workspace);
          expect(decoded.entities['teams']).toEqual([...source.teams.values()]);
          const restored = rehydratePortableWorkspace(decoded);
          expect(restored).toEqual(source);
          const context = {
            actorId: 'planner',
            timezone: source.workspace.timezone,
            settings: NO_RULE_SETTINGS,
            ownedRefs: new Set<string>(),
            clock: { now: () => NOW, today: () => '2026-08-17' },
          };
          expect(evaluateAll(ALL_RULES, restored, context)).toEqual(
            evaluateAll(ALL_RULES, source, context),
          );
        },
      ),
    );
  });
});
