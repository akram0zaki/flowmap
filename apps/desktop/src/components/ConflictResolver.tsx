/**
 * Field-level sync conflict UI.
 *
 * Overlapping edits are never silently overwritten. Each row is one field,
 * with keep mine / take theirs / edit merged value. Resolution is a normal
 * command so it is authorised, validated, and recorded.
 *
 * See docs/spec/07-persistence-sync.md §5.
 */

import { useState } from 'react';
import type { ConflictRecord } from '@flowmap/storage';

import { t } from '../i18n/t.js';

export type ConflictResolverProps = {
  readonly conflicts: readonly ConflictRecord[];
  readonly onResolve: (
    conflict: ConflictRecord,
    action: 'KEEP_MINE' | 'TAKE_THEIRS' | 'EDIT',
    value?: unknown,
  ) => void;
  readonly onClose: () => void;
};

export function ConflictResolver({ conflicts, onResolve, onClose }: ConflictResolverProps) {
  const open = conflicts.filter((row) => row.resolvedAt === undefined);
  const [edits, setEdits] = useState<Record<string, string>>({});

  return (
    <div className="fm-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fm-dialog fm-conflicts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflicts-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="fm-panel__head">
          <h2 id="conflicts-title">{t('sync.conflictsTitle')}</h2>
          <button type="button" className="fm-panel__close" onClick={onClose}>
            {t('settings.close')}
          </button>
        </header>
        <p>{t('sync.conflictsLead')}</p>
        {open.length === 0 ? (
          <p>{t('sync.conflictsEmpty')}</p>
        ) : (
          <ul className="fm-conflicts__list">
            {open.map((conflict) => (
              <li key={conflict.id}>
                <p>
                  {t('sync.conflictRow', {
                    entity: 'id' in conflict.entityRef ? conflict.entityRef.id : conflict.field,
                    field: conflict.field,
                  })}
                </p>
                <p>
                  {t('sync.yours')}: {stringify(conflict.localValue)}
                </p>
                <p>
                  {t('sync.theirs')}: {stringify(conflict.remoteValue)}
                </p>
                <label>
                  <span className="fm-visually-hidden">{t('sync.mergedValue')}</span>
                  <input
                    value={edits[conflict.id] ?? ''}
                    onChange={(event) =>
                      setEdits((current) => ({ ...current, [conflict.id]: event.target.value }))
                    }
                    placeholder={t('sync.mergedValue')}
                  />
                </label>
                <div className="fm-dialog__actions">
                  <button type="button" onClick={() => onResolve(conflict, 'KEEP_MINE')}>
                    {t('sync.keepMine')}
                  </button>
                  <button type="button" onClick={() => onResolve(conflict, 'TAKE_THEIRS')}>
                    {t('sync.takeTheirs')}
                  </button>
                  <button
                    type="button"
                    className="fm-primary"
                    onClick={() => onResolve(conflict, 'EDIT', edits[conflict.id])}
                    disabled={(edits[conflict.id] ?? '').trim().length === 0}
                  >
                    {t('sync.editMerged')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
