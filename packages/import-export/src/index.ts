/**
 * Import, export, and portable-workspace primitives.
 *
 * This package deliberately works with records and bytes only. It never writes
 * a repository: callers validate the generated plan through domain commands and
 * commit it in one repository transaction. See docs/spec/09-import-export.md.
 */

import { strFromU8, unzipSync, zipSync } from 'fflate';
import ExcelJS from 'exceljs';

import type { DomainEvent, WorkspaceState } from '@flowmap/domain';

import { paintGraphicalSheets } from './graphical-sheets.js';
export * from './roadmap.js';
export * from './pptx.js';

export {
  PORTFOLIO_WALL_SHEET,
  TIMELINE_SHEET,
  portfolioWallModel,
  timelineExportModel,
} from './graphical-sheets.js';

export const PACKAGE_NAME = '@flowmap/import-export';
export const PORTABLE_FORMAT_VERSION = 1;
/** Limits apply before a package is trusted, so a file cannot consume unbounded memory. */
export const MAX_PORTABLE_PACKAGE_BYTES = 50 * 1024 * 1024;
export const MAX_PORTABLE_UNPACKED_BYTES = 200 * 1024 * 1024;
export const SENSITIVITY_WARNING =
  "This file contains your portfolio's management data in plain text. Store and share it according to your organisation's data classification.";

export type ImportFormat = 'CSV' | 'JSON' | 'XLSX';

export type TabularSheet = {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
};

export type ParsedImport = {
  readonly format: ImportFormat;
  readonly sheets: readonly TabularSheet[];
};

export type MappingField =
  | 'externalKey'
  | 'name'
  | 'description'
  | 'lifecycle'
  | 'class'
  | 'importance'
  | 'team'
  | 'quarter'
  | 'units'
  | 'size'
  | 'targetDate'
  | 'targetQuarter'
  | 'product'
  | 'dependencyTarget'
  | 'dependencyType'
  | 'owner'
  | 'email';

export type ColumnMapping = {
  readonly field: MappingField;
  readonly column: string;
  /** Header-based confidence; user changes always win over this suggestion. */
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

export type SavedMapping = {
  readonly id: string;
  readonly name: string;
  readonly entity: ImportEntity;
  readonly mappings: readonly ColumnMapping[];
  readonly enumValues: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

export type ImportEntity =
  | 'TEAM'
  | 'PRODUCT_SERVICE'
  | 'PERSON'
  | 'COMMITMENT'
  | 'CAPACITY_FOOTPRINT'
  | 'DEPENDENCY'
  | 'MILESTONE'
  | 'THEME'
  | 'EXTERNAL_LINK'
  | 'TEAM_QUARTER';

export type ImportIssue = {
  readonly row: number;
  readonly column?: string;
  readonly code:
    | 'REQUIRED'
    | 'INVALID_ENUM'
    | 'INVALID_QUARTER'
    | 'INVALID_UNITS'
    | 'UNMAPPED_COLUMN'
    | 'INVALID_JSON'
    | 'UNSUPPORTED_FORMAT';
  readonly message: string;
};

export type MappedRow = {
  readonly row: number;
  readonly values: Readonly<Record<string, string>>;
  readonly externalKey?: string;
};

export type DuplicateCandidate = {
  readonly row: number;
  readonly existingId: string;
  readonly name: string;
};

export type ImportPreview = {
  readonly creates: readonly MappedRow[];
  readonly updates: readonly (MappedRow & { readonly existingId: string })[];
  readonly possibleDuplicates: readonly DuplicateCandidate[];
  readonly errors: readonly ImportIssue[];
};

/**
 * A mapped import is intentionally still data, rather than a repository write.
 * The application turns this plan into domain commands and submits the complete
 * batch in one transaction. Keeping this boundary here makes it impossible for
 * a parser to smuggle a partial write past command validation.
 */
export type ImportPlan = {
  readonly entity: ImportEntity;
  readonly creates: readonly MappedRow[];
  readonly updates: readonly (MappedRow & { readonly existingId: string })[];
  readonly possibleDuplicates: readonly DuplicateCandidate[];
  readonly errors: readonly ImportIssue[];
};

const ENTITY_SHEET_NAMES: Readonly<Record<string, ImportEntity>> = {
  teams: 'TEAM',
  team: 'TEAM',
  products: 'PRODUCT_SERVICE',
  productservices: 'PRODUCT_SERVICE',
  people: 'PERSON',
  commitments: 'COMMITMENT',
  capacityfootprints: 'CAPACITY_FOOTPRINT',
  footprints: 'CAPACITY_FOOTPRINT',
  dependencies: 'DEPENDENCY',
  milestones: 'MILESTONE',
  themes: 'THEME',
  externallinks: 'EXTERNAL_LINK',
  teamquarters: 'TEAM_QUARTER',
};

/** Proposes an entity from an export sheet name; users can always override it. */
export function suggestEntity(sheetName: string): ImportEntity | undefined {
  return ENTITY_SHEET_NAMES[normaliseHeader(sheetName)];
}

const HEADER_FIELDS: Readonly<Record<string, MappingField>> = {
  externalid: 'externalKey',
  externalkey: 'externalKey',
  id: 'externalKey',
  name: 'name',
  title: 'name',
  description: 'description',
  lifecycle: 'lifecycle',
  status: 'lifecycle',
  class: 'class',
  importance: 'importance',
  team: 'team',
  primaryteam: 'team',
  quarter: 'quarter',
  targetquarter: 'targetQuarter',
  targetdate: 'targetDate',
  date: 'targetDate',
  units: 'units',
  size: 'size',
  product: 'product',
  dependencytarget: 'dependencyTarget',
  dependencytype: 'dependencyType',
  owner: 'owner',
  email: 'email',
};

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Proposes mappings from known headers. It never invents a value conversion. */
export function suggestMappings(columns: readonly string[]): readonly ColumnMapping[] {
  return columns.flatMap((column) => {
    const field = HEADER_FIELDS[normaliseHeader(column)];
    return field ? [{ field, column, confidence: 'HIGH' as const }] : [];
  });
}

/** RFC-4180-compatible enough for embedded commas, quotes, and new lines. */
export function parseCsv(text: string, sheetName = 'CSV'): TabularSheet {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) records.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) records.push(row);
  const columns = records.shift()?.map((value) => value.trim()) ?? [];
  return {
    name: sheetName,
    columns,
    rows: records.map((values) =>
      Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ''])),
    ),
  };
}

export function parseJson(text: string): ParsedImport {
  const value: unknown = JSON.parse(text);
  const sheets = Array.isArray(value)
    ? [sheetFromRecords('JSON', value)]
    : value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).flatMap(([name, rows]) =>
          Array.isArray(rows) ? [sheetFromRecords(name, rows)] : [],
        )
      : [];
  return { format: 'JSON', sheets };
}

export async function parseXlsx(bytes: ArrayBuffer | Uint8Array): Promise<ParsedImport> {
  const book = new ExcelJS.Workbook();
  const data =
    bytes instanceof Uint8Array
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : bytes;
  // ExcelJS's published declarations describe Node's Buffer, while its
  // browser bundle accepts the ArrayBuffer documented by the project.
  await book.xlsx.load(data as never);
  return {
    format: 'XLSX',
    sheets: book.worksheets.map(sheetFromWorkbook),
  };
}

export async function parseImport(
  format: ImportFormat,
  input: string | ArrayBuffer | Uint8Array,
): Promise<ParsedImport> {
  if (format === 'CSV') return { format, sheets: [parseCsv(String(input))] };
  if (format === 'JSON') return parseJson(String(input));
  return parseXlsx(input as ArrayBuffer | Uint8Array);
}

function sheetFromWorkbook(sheet: ExcelJS.Worksheet): TabularSheet {
  const columns = (sheet.getRow(1).values as unknown[])
    .slice(1)
    .map((value) => String(value ?? '').trim());
  const rows: Array<Readonly<Record<string, string>>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values as unknown[];
    const record = Object.fromEntries(
      columns.map((column, index) => [column, cellText(values[index + 1])]),
    );
    if (Object.values(record).some((value) => value.length > 0)) rows.push(record);
  });
  return { name: sheet.name, columns, rows };
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '');
  return String(value);
}

function sheetFromRecords(name: string, records: readonly unknown[]): TabularSheet {
  const rows = records.flatMap((record) =>
    record && typeof record === 'object'
      ? [
          Object.fromEntries(
            Object.entries(record as Record<string, unknown>).map(([key, value]) => [
              key,
              value === null || value === undefined ? '' : String(value),
            ]),
          ),
        ]
      : [],
  );
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { name, columns, rows };
}

export function mapRows(
  rows: readonly Readonly<Record<string, string>>[],
  mappings: readonly ColumnMapping[],
  enumValues: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
  entity?: ImportEntity,
): { readonly rows: readonly MappedRow[]; readonly errors: readonly ImportIssue[] } {
  const mapped: MappedRow[] = [];
  const errors: ImportIssue[] = [];
  for (const [index, source] of rows.entries()) {
    const values: Record<string, string> = {};
    for (const mapping of mappings) {
      const raw = source[mapping.column]?.trim() ?? '';
      const table = enumValues[mapping.field];
      const converted = table?.[raw] ?? raw;
      if (table && raw !== '' && table[raw] === undefined) {
        errors.push({
          row: index + 2,
          column: mapping.column,
          code: 'INVALID_ENUM',
          message: `The value “${raw}” is not mapped for ${mapping.field}.`,
        });
      }
      values[mapping.field] = converted;
    }
    validateMappedRow(index + 2, values, errors, entity);
    const externalKey = values['externalKey'];
    mapped.push({ row: index + 2, values, ...(externalKey ? { externalKey } : {}) });
  }
  return { rows: mapped, errors };
}

function validateMappedRow(
  row: number,
  values: Readonly<Record<string, string>>,
  errors: ImportIssue[],
  entity?: ImportEntity,
) {
  const requiresName = entity !== 'CAPACITY_FOOTPRINT' && entity !== 'TEAM_QUARTER';
  if (requiresName && !values['name'] && !values['externalKey']) {
    errors.push({
      row,
      code: 'REQUIRED',
      message: 'Map a name or stable external key for this row.',
    });
  }
  const units = values['units'];
  if (units && (!Number.isFinite(Number(units)) || Number(units) <= 0)) {
    errors.push({
      row,
      column: 'units',
      code: 'INVALID_UNITS',
      message: 'Units must be a positive number.',
    });
  }
  const quarter = values['quarter'] ?? values['targetQuarter'];
  if (quarter && !parseQuarter(quarter)) {
    errors.push({
      row,
      column: 'quarter',
      code: 'INVALID_QUARTER',
      message: `“${quarter}” is not a recognised quarter.`,
    });
  }
  if (entity === 'CAPACITY_FOOTPRINT' && (!values['team'] || !values['quarter'])) {
    errors.push({
      row,
      code: 'REQUIRED',
      message: 'Capacity footprints require a team and quarter.',
    });
  }
  if (entity === 'TEAM_QUARTER' && (!values['team'] || !values['quarter'])) {
    errors.push({
      row,
      code: 'REQUIRED',
      message: 'Team-quarter capacity requires a team and quarter.',
    });
  }
}

/** Accepts the import forms specified in §1.3 and returns the canonical quarter. */
export function parseQuarter(value: string): string | null {
  const direct = /^(\d{4})-?Q([1-4])$/i.exec(value.trim());
  if (direct) return `${direct[1]}-Q${direct[2]}`;
  const inverted = /^Q([1-4])\s+(\d{4})$/i.exec(value.trim());
  if (inverted) return `${inverted[2]}-Q${inverted[1]}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.exec(value.trim());
  if (date) {
    const month = Number(value.slice(5, 7));
    return `${value.slice(0, 4)}-Q${Math.ceil(month / 3)}`;
  }
  return null;
}

export function previewImport(
  mapped: readonly MappedRow[],
  errors: readonly ImportIssue[],
  existing: readonly {
    readonly id: string;
    readonly name?: string;
    readonly externalKey?: string;
  }[],
): ImportPreview {
  const keyed = new Map(
    existing.flatMap((record) => (record.externalKey ? [[record.externalKey, record]] : [])),
  );
  const creates: MappedRow[] = [];
  const updates: (MappedRow & { existingId: string })[] = [];
  const possibleDuplicates: DuplicateCandidate[] = [];
  for (const row of mapped) {
    const matched = row.externalKey ? keyed.get(row.externalKey) : undefined;
    if (matched) updates.push({ ...row, existingId: matched.id });
    else {
      creates.push(row);
      const name = row.values['name'];
      const sameName = name
        ? existing.find((record) => record.name?.toLocaleLowerCase() === name.toLocaleLowerCase())
        : undefined;
      if (sameName)
        possibleDuplicates.push({
          row: row.row,
          existingId: sameName.id,
          name: sameName.name ?? name ?? '',
        });
    }
  }
  return { creates, updates, possibleDuplicates, errors };
}

/** Builds one entity plan, preserving every row-level issue for the error CSV. */
export function createImportPlan(
  entity: ImportEntity,
  rows: readonly Readonly<Record<string, string>>[],
  mappings: readonly ColumnMapping[],
  existing: readonly {
    readonly id: string;
    readonly name?: string;
    readonly externalKey?: string;
  }[],
  enumValues: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): ImportPlan {
  const mapped = mapRows(rows, mappings, enumValues, entity);
  return { entity, ...previewImport(mapped.rows, mapped.errors, existing) };
}

export function errorCsv(errors: readonly ImportIssue[]): string {
  return toCsv(
    errors.map((error) => ({
      row: error.row,
      column: error.column ?? '',
      code: error.code,
      message: error.message,
    })),
  );
}

export function toCsv(rows: readonly Readonly<Record<string, unknown>>[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((key) => escape(row[key])).join(',')),
  ].join('\n');
}

/** A workbook export uses the same rows and columns as the list companion. */
export async function toXlsx(
  rows: readonly Readonly<Record<string, unknown>>[],
  sheetName = 'Flowmap',
): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  appendRows(book.addWorksheet(sheetName.slice(0, 31) || 'Flowmap'), rows);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export type ExportSheet = {
  readonly name: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
};

/**
 * Workbook exports always carry the same sensitivity/readme information. The
 * caller supplies only presentation rows, so current-view exports cannot
 * accidentally grow hidden columns that are not visible in the companion.
 */
export async function toWorkbook(
  sheets: readonly ExportSheet[],
  readme: {
    readonly workspace: string;
    readonly exportedAt: string;
    readonly schemaVersion: number;
  },
  options?: { readonly state?: WorkspaceState },
): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const readmeRows: Readonly<Record<string, unknown>>[] = [
    { field: 'Workspace', value: readme.workspace },
    { field: 'Exported at', value: readme.exportedAt },
    { field: 'Schema version', value: readme.schemaVersion },
    { field: 'Sensitivity', value: SENSITIVITY_WARNING },
  ];
  if (options?.state) {
    readmeRows.push(
      {
        field: 'Portfolio wall',
        value: 'Graphical team × quarter view of placed work.',
      },
      {
        field: 'Roadmap',
        value:
          'Deliverables by theme across the horizon, teams set aside, with a dotted line at the export date. Not a Gantt: no percent complete, no critical path.',
      },
      {
        field: 'Timeline',
        value:
          'Graphical footprint view across the horizon. Not a Gantt: no percent complete, no critical path.',
      },
    );
  }
  appendRows(book.addWorksheet('_README'), readmeRows);
  // The export's own timestamp is what "today" means for the roadmap's line:
  // one workspace exported twice on the same day draws the same picture.
  if (options?.state) paintGraphicalSheets(book, options.state, readme.exportedAt.slice(0, 10));
  for (const sheet of sheets) {
    appendRows(book.addWorksheet(sheet.name.slice(0, 31) || 'Flowmap'), sheet.rows);
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}

function appendRows(sheet: ExcelJS.Worksheet, rows: readonly Readonly<Record<string, unknown>>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  sheet.addRow(columns);
  for (const row of rows) sheet.addRow(columns.map((column) => row[column] ?? ''));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Rows for the all-entity workspace data export (one sheet/file per entity type). */
export function workspaceDataSheets(state: WorkspaceState): readonly ExportSheet[] {
  return Object.entries(entitiesFromState(state)).map(([name, rows]) => ({
    name,
    rows: rows as readonly Readonly<Record<string, unknown>>[],
  }));
}

export function workspaceDataJson(state: WorkspaceState, exportedAt: string): string {
  return JSON.stringify(
    {
      _README: {
        workspace: state.workspace.name,
        exportedAt,
        schemaVersion: state.workspace.schemaVersion,
        sensitivity: SENSITIVITY_WARNING,
      },
      workspace: state.workspace,
      entities: entitiesFromState(state),
    },
    null,
    2,
  );
}

export type PortableManifest = {
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly workspaceId: string;
  readonly exportedAt: string;
  readonly exportedBy: string;
  readonly appVersion: string;
  readonly contentHash: string;
  readonly entityCounts: Readonly<Record<string, number>>;
};

export type PortableWorkspace = {
  readonly manifest: PortableManifest;
  readonly workspace: WorkspaceState['workspace'];
  readonly entities: Readonly<Record<string, readonly unknown[]>>;
  readonly events: readonly DomainEvent[];
  readonly savedViews: readonly unknown[];
};

export type PortableExportInput = {
  readonly state: WorkspaceState;
  readonly events?: readonly DomainEvent[];
  readonly savedViews?: readonly unknown[];
  readonly exportedAt: string;
  readonly exportedBy: string;
  readonly appVersion: string;
};

export async function createPortableWorkspace(
  input: PortableExportInput,
): Promise<PortableWorkspace> {
  const entities = entitiesFromState(input.state);
  const payload = portablePayload(
    input.state.workspace,
    entities,
    input.events ?? [],
    input.savedViews ?? input.state.workspace.settings.savedViews ?? [],
  );
  const contentHash = await sha256Hex(canonicalPayload(payload));
  return {
    manifest: {
      formatVersion: PORTABLE_FORMAT_VERSION,
      schemaVersion: input.state.workspace.schemaVersion,
      workspaceId: input.state.workspace.id,
      exportedAt: input.exportedAt,
      exportedBy: input.exportedBy,
      appVersion: input.appVersion,
      contentHash,
      entityCounts: Object.fromEntries(
        Object.entries(entities).map(([key, rows]) => [key, rows.length]),
      ),
    },
    workspace: input.state.workspace,
    entities,
    events: input.events ?? [],
    savedViews: input.savedViews ?? input.state.workspace.settings.savedViews ?? [],
  };
}

/** Encodes the documented ZIP container, with stable file ordering and JSON. */
export function encodePortableWorkspace(pkg: PortableWorkspace): Uint8Array {
  const payload = portablePayload(pkg.workspace, pkg.entities, pkg.events, pkg.savedViews);
  const files: Record<string, Uint8Array> = {
    '_README.txt': text(portableReadme(pkg.manifest)),
    'manifest.json': text(canonicalJson(pkg.manifest)),
    'workspace.json': text(canonicalJson(pkg.workspace)),
    'history/events.json': text(canonicalJson(pkg.events)),
    'views/saved-views.json': text(canonicalJson(pkg.savedViews)),
  };
  for (const [kind, rows] of Object.entries(pkg.entities).sort(([a], [b]) => a.localeCompare(b))) {
    files[`entities/${kind}.json`] = text(canonicalJson(rows));
  }
  // Keep construction deterministic: the calling environment may choose where
  // to write these bytes, but bytes from the same state are always identical.
  void payload;
  return zipSync(files, { level: 6 });
}

export async function decodePortableWorkspace(bytes: Uint8Array): Promise<PortableWorkspace> {
  if (bytes.byteLength > MAX_PORTABLE_PACKAGE_BYTES) {
    throw new Error('The .flowmap package exceeds the supported file size.');
  }
  const files = unzipSync(bytes);
  if (Object.keys(files).some((name) => name.startsWith('/') || name.split('/').includes('..'))) {
    throw new Error('The .flowmap package contains an unsafe file path.');
  }
  const unpackedBytes = Object.values(files).reduce((total, file) => total + file.byteLength, 0);
  if (unpackedBytes > MAX_PORTABLE_UNPACKED_BYTES) {
    throw new Error('The .flowmap package expands beyond the supported file size.');
  }
  const read = <T>(name: string): T => {
    const content = files[name];
    if (!content) throw new Error(`Missing ${name} from portable workspace.`);
    return JSON.parse(strFromU8(content)) as T;
  };
  const manifest = read<PortableManifest>('manifest.json');
  if (manifest.formatVersion > PORTABLE_FORMAT_VERSION) {
    throw new Error(`This .flowmap file uses newer format version ${manifest.formatVersion}.`);
  }
  const workspace = read<WorkspaceState['workspace']>('workspace.json');
  const entities = Object.fromEntries(
    Object.keys(files)
      .filter((name) => name.startsWith('entities/') && name.endsWith('.json'))
      .sort()
      .map((name) => [name.slice('entities/'.length, -'.json'.length), read<unknown[]>(name)]),
  );
  const events = files['history/events.json'] ? read<DomainEvent[]>('history/events.json') : [];
  const savedViews = files['views/saved-views.json']
    ? read<unknown[]>('views/saved-views.json')
    : [];
  const hash = await sha256Hex(
    canonicalPayload(portablePayload(workspace, entities, events, savedViews)),
  );
  if (hash !== manifest.contentHash)
    throw new Error('The .flowmap content hash does not match its manifest.');
  return { manifest, workspace, entities, events, savedViews };
}

/** Restores the portable record collections to the immutable domain projection shape. */
export function rehydratePortableWorkspace(pkg: PortableWorkspace): WorkspaceState {
  const map = <T>(name: string) =>
    new Map(
      (pkg.entities[name] ?? []).flatMap((value) => {
        const record = value as { id?: string };
        return typeof record.id === 'string' ? [[record.id, value as T] as const] : [];
      }),
    );
  return {
    workspace: pkg.workspace,
    teams: map('teams'),
    teamQuarters: map('team-quarters'),
    commitments: map('commitments'),
    footprints: map('footprints'),
    ...(Object.hasOwn(pkg.entities, 'products') ? { products: map('products') } : {}),
    ...(Object.hasOwn(pkg.entities, 'impacts') ? { productImpacts: map('impacts') } : {}),
    ...(Object.hasOwn(pkg.entities, 'dependencies') ? { dependencies: map('dependencies') } : {}),
    ...(Object.hasOwn(pkg.entities, 'decisions') ? { decisions: map('decisions') } : {}),
    ...(Object.hasOwn(pkg.entities, 'milestones') ? { milestones: map('milestones') } : {}),
    ...(Object.hasOwn(pkg.entities, 'themes') ? { themes: map('themes') } : {}),
    ...(Object.hasOwn(pkg.entities, 'commitment-themes')
      ? { commitmentThemes: map('commitment-themes') }
      : {}),
    ...(Object.hasOwn(pkg.entities, 'links') ? { externalLinks: map('links') } : {}),
    ...(Object.hasOwn(pkg.entities, 'people') ? { people: map('people') } : {}),
    ...(Object.hasOwn(pkg.entities, 'scenarios') ? { scenarios: map('scenarios') } : {}),
  } as WorkspaceState;
}

function entitiesFromState(state: WorkspaceState): Record<string, readonly unknown[]> {
  return {
    teams: [...state.teams.values()],
    'team-quarters': [...state.teamQuarters.values()],
    commitments: [...state.commitments.values()],
    footprints: [...state.footprints.values()],
    ...(state.products ? { products: [...state.products.values()] } : {}),
    ...(state.productImpacts ? { impacts: [...state.productImpacts.values()] } : {}),
    ...(state.dependencies ? { dependencies: [...state.dependencies.values()] } : {}),
    ...(state.decisions ? { decisions: [...state.decisions.values()] } : {}),
    ...(state.milestones ? { milestones: [...state.milestones.values()] } : {}),
    ...(state.themes ? { themes: [...state.themes.values()] } : {}),
    ...(state.commitmentThemes
      ? { 'commitment-themes': [...state.commitmentThemes.values()] }
      : {}),
    ...(state.externalLinks ? { links: [...state.externalLinks.values()] } : {}),
    ...(state.people ? { people: [...state.people.values()] } : {}),
    ...(state.scenarios ? { scenarios: [...state.scenarios.values()] } : {}),
  };
}

function portablePayload(
  workspace: unknown,
  entities: Readonly<Record<string, readonly unknown[]>>,
  events: readonly unknown[],
  savedViews: readonly unknown[],
) {
  return { workspace, entities, events, savedViews };
}

function canonicalPayload(value: unknown): string {
  return canonicalJson(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function portableReadme(manifest: PortableManifest): string {
  return [
    'Flowmap portable workspace',
    '',
    SENSITIVITY_WARNING,
    '',
    `Format version: ${manifest.formatVersion}`,
    `Workspace: ${manifest.workspaceId}`,
    `Exported at: ${manifest.exportedAt}`,
    '',
    'This ZIP contains the workspace, entities, saved views, and event history.',
    'Do not modify individual files: Flowmap verifies the content hash on import.',
  ].join('\n');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', text(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
