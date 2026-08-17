/**
 * Portable import and export are deliberately visible but contained: they are
 * workspace operations, not another view competing with the portfolio map.
 */

import { useRef, useState } from 'react';
import type {
  DomainEvent,
  NotificationSettings,
  SavedImportMapping,
  WorkspaceState,
} from '@flowmap/domain';
import {
  createPortableWorkspace,
  encodePortableWorkspace,
  errorCsv,
  mapRows,
  parseImport,
  previewImport,
  suggestMappings,
  toCsv,
  toWorkbook,
  toXlsx,
  workspaceDataJson,
  workspaceDataSheets,
  type ImportFormat,
  type ImportEntity,
  type ImportPreview,
  type ColumnMapping,
} from '@flowmap/import-export';

import { t } from '../i18n/t.js';

type ExportRow = Readonly<Record<string, string | number | boolean>>;

export type PortabilityPanelProps = {
  readonly state: WorkspaceState;
  readonly events: readonly DomainEvent[];
  readonly profileName: string;
  readonly now: () => string;
  readonly rows: readonly ExportRow[];
  readonly radarRows: readonly ExportRow[];
  readonly onImportedIdeas: (
    rows: readonly {
      readonly name: string;
      readonly externalKey?: string;
      readonly existingId?: string;
    }[],
  ) => Promise<boolean>;
  readonly savedMappings?: readonly SavedImportMapping[];
  readonly onSaveMapping: (mapping: Omit<SavedImportMapping, 'id'>) => Promise<boolean>;
  readonly notificationSettings?: NotificationSettings;
  readonly onNotificationSettings: (settings: NotificationSettings) => Promise<boolean>;
  readonly announce: (message: string) => void;
};

export function PortabilityPanel({
  state,
  events,
  profileName,
  now,
  rows,
  radarRows,
  onImportedIdeas,
  savedMappings,
  onSaveMapping,
  notificationSettings,
  onNotificationSettings,
  announce,
}: PortabilityPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [sourceRows, setSourceRows] = useState<readonly Readonly<Record<string, string>>[]>([]);
  const [mappings, setMappings] = useState<readonly ColumnMapping[]>([]);
  const [entity, setEntity] = useState<ImportEntity>('COMMITMENT');

  function updatePreview(nextMappings: readonly ColumnMapping[], nextEntity = entity) {
    const mapped = mapRows(sourceRows, nextMappings, {}, nextEntity);
    setMappings(nextMappings);
    setPreview(
      previewImport(
        mapped.rows,
        mapped.errors,
        [...state.commitments.values()].map((commitment) => {
          const externalKey = Object.entries(
            state.workspace.settings.externalKeys?.['COMMITMENT'] ?? {},
          ).find(([, id]) => id === commitment.id)?.[0];
          return {
            id: commitment.id,
            name: commitment.name,
            ...(externalKey ? { externalKey } : {}),
          };
        }),
      ),
    );
  }

  async function exportWorkspace() {
    const pkg = await createPortableWorkspace({
      state,
      events,
      exportedAt: now(),
      exportedBy: profileName,
      appVersion: '0.0.0',
    });
    download(`${safeName(state.workspace.name)}.flowmap`, encodePortableWorkspace(pkg));
    announce(t('portability.exportedWorkspace'));
  }

  async function previewFile(file: File) {
    try {
      const format = formatFor(file.name);
      const source =
        format === 'XLSX' ? new Uint8Array(await file.arrayBuffer()) : await file.text();
      const parsed = parseImport(format, source);
      const sheet = parsed.sheets[0];
      if (!sheet) {
        setPreview({ creates: [], updates: [], possibleDuplicates: [], errors: [] });
        return;
      }
      const proposed = suggestMappings(sheet.columns);
      setSourceRows(sheet.rows);
      setMappings(proposed);
      const mapped = mapRows(sheet.rows, proposed, {}, entity);
      setPreview(
        previewImport(
          mapped.rows,
          mapped.errors,
          [...state.commitments.values()].map((commitment) => {
            const externalKey = Object.entries(
              state.workspace.settings.externalKeys?.['COMMITMENT'] ?? {},
            ).find(([, id]) => id === commitment.id)?.[0];
            return {
              id: commitment.id,
              name: commitment.name,
              ...(externalKey ? { externalKey } : {}),
            };
          }),
        ),
      );
    } catch {
      setPreview({
        creates: [],
        updates: [],
        possibleDuplicates: [],
        errors: [{ row: 0, code: 'INVALID_JSON', message: t('portability.importUnreadable') }],
      });
    }
  }

  async function applyIdeas() {
    if (!preview || preview.errors.length > 0 || preview.possibleDuplicates.length > 0) return;
    if (entity !== 'COMMITMENT') return;
    const importedRows = [
      ...preview.creates.map((row) => ({
        name: row.values['name'] ?? '',
        ...(row.externalKey ? { externalKey: row.externalKey } : {}),
      })),
      ...preview.updates.map((row) => ({
        name: row.values['name'] ?? '',
        existingId: row.existingId,
        ...(row.externalKey ? { externalKey: row.externalKey } : {}),
      })),
    ].filter((row) => row.name.length > 0);
    if (importedRows.length === 0) return;
    setImporting(true);
    const imported = await onImportedIdeas(importedRows);
    setImporting(false);
    if (imported) {
      announce(t('portability.importedIdeas', { count: importedRows.length }));
      setPreview(null);
    }
  }

  return (
    <details className="fm-portability">
      <summary>{t('portability.summary')}</summary>
      <section aria-label={t('portability.summary')}>
        <h2>{t('portability.title')}</h2>
        <p>{t('portability.definition')}</p>
        <p>{t('portability.not')}</p>
        <p>{t('portability.example')}</p>
        <p className="fm-portability__warning" role="note">
          {t('portability.sensitivity')}
        </p>
        <div className="fm-portability__actions">
          <button type="button" onClick={() => download('flowmap-view.csv', toCsv(rows))}>
            {t('portability.exportCsv')}
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                'flowmap-view.xlsx',
                toXlsx(
                  rows.map((row) => ({ ...row })),
                  t('portability.sheetName'),
                ),
              )
            }
          >
            {t('portability.exportXlsx')}
          </button>
          <button type="button" onClick={() => download('flowmap-radar.csv', toCsv(radarRows))}>
            {t('portability.exportRadar')}
          </button>
          <button
            type="button"
            onClick={() =>
              download('flowmap-radar.xlsx', toXlsx(radarRows, t('portability.radarSheetName')))
            }
          >
            {t('portability.exportRadarXlsx')}
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                `${safeName(state.workspace.name)}-data.xlsx`,
                toWorkbook(workspaceDataSheets(state), {
                  workspace: state.workspace.name,
                  exportedAt: now(),
                  schemaVersion: state.workspace.schemaVersion,
                }),
              )
            }
          >
            {t('portability.exportDataXlsx')}
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                `${safeName(state.workspace.name)}-data.json`,
                workspaceDataJson(state, now()),
              )
            }
          >
            {t('portability.exportDataJson')}
          </button>
          <button
            type="button"
            onClick={() => {
              const reviews = events
                .filter((event) => event.eventType === 'QUARTER_CLOSED')
                .map((event) => ({
                  quarter: String(event.facts['quarterId'] ?? ''),
                  outcomes: JSON.stringify(event.facts['outcomes'] ?? []),
                  carryOver: JSON.stringify(event.facts['carryOver'] ?? []),
                }));
              download(
                'flowmap-quarter-review.xlsx',
                toWorkbook([{ name: t('portability.reviewSheetName'), rows: reviews }], {
                  workspace: state.workspace.name,
                  exportedAt: now(),
                  schemaVersion: state.workspace.schemaVersion,
                }),
              );
            }}
          >
            {t('portability.exportQuarterReview')}
          </button>
          <button type="button" className="fm-primary" onClick={() => void exportWorkspace()}>
            {t('portability.exportWorkspace')}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            {t('portability.chooseImport')}
          </button>
          <input
            ref={fileRef}
            className="fm-visually-hidden"
            type="file"
            accept=".csv,.json,.xlsx"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void previewFile(file);
              event.currentTarget.value = '';
            }}
          />
        </div>
        <label className="fm-portability__notifications">
          {t('notifications.preference')}
          <select
            value={notificationSettings?.mode ?? 'MY_ACTIONS'}
            onChange={(event) => {
              const mode = event.target.value as NotificationSettings['mode'];
              if (
                mode !== 'OFF' &&
                typeof Notification !== 'undefined' &&
                Notification.permission === 'default'
              ) {
                void Notification.requestPermission();
              }
              void onNotificationSettings({ mode });
            }}
          >
            {(
              ['MY_ACTIONS', 'URGENT_ONLY', 'PORTFOLIO_WARNINGS', 'STALE_ITEMS', 'OFF'] as const
            ).map((mode) => (
              <option key={mode} value={mode}>
                {t(`notifications.${mode}`)}
              </option>
            ))}
          </select>
          {typeof Notification !== 'undefined' && Notification.permission === 'denied' && (
            <span>{t('notifications.blocked')}</span>
          )}
        </label>
        {preview && (
          <div className="fm-portability__preview" aria-live="polite">
            <label>
              {t('portability.entity')}
              <select
                value={entity}
                onChange={(event) => {
                  const next = event.target.value as ImportEntity;
                  setEntity(next);
                  updatePreview(mappings, next);
                }}
              >
                {(
                  [
                    'COMMITMENT',
                    'TEAM',
                    'PRODUCT_SERVICE',
                    'PERSON',
                    'CAPACITY_FOOTPRINT',
                    'DEPENDENCY',
                    'MILESTONE',
                    'THEME',
                    'EXTERNAL_LINK',
                    'TEAM_QUARTER',
                  ] as const
                ).map((item) => (
                  <option key={item} value={item}>
                    {t(`portability.entity.${item}`)}
                  </option>
                ))}
              </select>
            </label>
            {mappings.map((mapping, index) => (
              <label key={`${mapping.field}:${index}`}>
                {t(`portability.field.${mapping.field}`)}
                <select
                  value={mapping.column}
                  onChange={(event) =>
                    updatePreview(
                      mappings.map((item, current) =>
                        current === index
                          ? { ...item, column: event.target.value, confidence: 'LOW' }
                          : item,
                      ),
                    )
                  }
                >
                  {[...new Set(sourceRows.flatMap((row) => Object.keys(row)))].map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="button"
              onClick={() => {
                const name = window.prompt(t('portability.mappingName'));
                if (name)
                  void onSaveMapping({
                    name,
                    entity,
                    mappings: mappings.map(({ field, column }) => ({ field, column })),
                    enumValues: {},
                  });
              }}
            >
              {t('portability.saveMapping')}
            </button>
            {savedMappings && savedMappings.length > 0 && (
              <label>
                {t('portability.useMapping')}
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const selected = savedMappings.find((item) => item.id === event.target.value);
                    if (selected)
                      updatePreview(
                        selected.mappings.map((item) => ({
                          field: item.field as ColumnMapping['field'],
                          column: item.column,
                          confidence: 'LOW' as const,
                        })),
                        selected.entity as ImportEntity,
                      );
                  }}
                >
                  <option value="">{t('portability.chooseMapping')}</option>
                  {savedMappings.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p>
              {t('portability.previewSummary', {
                creates: preview.creates.length,
                updates: preview.updates.length,
                duplicates: preview.possibleDuplicates.length,
                errors: preview.errors.length,
              })}
            </p>
            {preview.errors.length > 0 && (
              <button
                type="button"
                onClick={() => download('flowmap-import-errors.csv', errorCsv(preview.errors))}
              >
                {t('portability.exportErrors')}
              </button>
            )}
            {preview.possibleDuplicates.length > 0 && (
              <p>{t('portability.duplicatesNeedReview')}</p>
            )}
            <button
              type="button"
              className="fm-primary"
              disabled={
                importing ||
                preview.errors.length > 0 ||
                preview.possibleDuplicates.length > 0 ||
                preview.creates.length + preview.updates.length === 0 ||
                entity !== 'COMMITMENT'
              }
              onClick={() => void applyIdeas()}
            >
              {t('portability.applyImport')}
            </button>
          </div>
        )}
      </section>
    </details>
  );
}

function formatFor(name: string): ImportFormat {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'csv') return 'CSV';
  if (extension === 'xlsx') return 'XLSX';
  return 'JSON';
}

function safeName(name: string): string {
  return (
    name
      .trim()
      .replaceAll(/[^A-Za-z0-9_-]+/g, '-')
      .replaceAll(/^-|-$/g, '') || 'flowmap'
  );
}

function download(name: string, content: string | Uint8Array) {
  const data = content instanceof Uint8Array ? new Uint8Array([...content]).buffer : content;
  const blob = new Blob([data], {
    type:
      content instanceof Uint8Array
        ? 'application/octet-stream'
        : name.endsWith('.json')
          ? 'application/json;charset=utf-8'
          : 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
