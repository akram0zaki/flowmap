/**
 * Portable import and export are deliberately visible but contained: they are
 * workspace operations, not another view competing with the portfolio map.
 */

import { useRef, useState } from 'react';
import type { DomainEvent, WorkspaceState } from '@flowmap/domain';
import {
  createPortableWorkspace,
  encodePortableWorkspace,
  errorCsv,
  mapRows,
  parseImport,
  previewImport,
  suggestMappings,
  toCsv,
  toXlsx,
  type ImportFormat,
  type ImportPreview,
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
  readonly onImportedIdeas: (names: readonly string[]) => Promise<boolean>;
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
  announce,
}: PortabilityPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

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
      const mapped = mapRows(sheet.rows, suggestMappings(sheet.columns));
      setPreview(
        previewImport(
          mapped.rows,
          mapped.errors,
          [...state.commitments.values()].map((commitment) => ({
            id: commitment.id,
            name: commitment.name,
          })),
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
    const names = preview.creates
      .map((row) => row.values['name'])
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) return;
    setImporting(true);
    const imported = await onImportedIdeas(names);
    setImporting(false);
    if (imported) {
      announce(t('portability.importedIdeas', { count: names.length }));
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
        {preview && (
          <div className="fm-portability__preview" aria-live="polite">
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
                preview.creates.length === 0
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
    type: content instanceof Uint8Array ? 'application/octet-stream' : 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
