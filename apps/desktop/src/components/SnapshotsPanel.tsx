/** Recovery points are explicit, local-only records; the event history remains intact. */

import type { SnapshotRecord } from '@flowmap/storage';
import { useRef, useState } from 'react';

import { t } from '../i18n/t.js';
import { HEADER_MENU_NAME, useDismissibleDetails } from '../state/use-dismissible-details.js';

export function SnapshotsPanel({
  snapshots,
  onCreate,
  onRestore,
}: {
  readonly snapshots: readonly SnapshotRecord[];
  readonly onCreate: () => void;
  readonly onRestore: (snapshotId: string, confirmation: string) => void;
}) {
  const [confirmation, setConfirmation] = useState<Record<string, string>>({});
  const menu = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menu);
  return (
    <details ref={menu} className="fm-header-menu fm-snapshots" name={HEADER_MENU_NAME}>
      <summary>{t('snapshot.summary')}</summary>
      <section aria-label={t('snapshot.summary')}>
        <h2>{t('snapshot.title')}</h2>
        <p>{t('snapshot.definition')}</p>
        <p>{t('snapshot.not')}</p>
        <p>{t('snapshot.example')}</p>
        <button type="button" className="fm-primary" onClick={onCreate}>
          {t('snapshot.create')}
        </button>
        <ul aria-label={t('snapshot.list')}>
          {snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              <span>{snapshot.commandName}</span>
              <time dateTime={snapshot.createdAt}>{snapshot.createdAt}</time>
              <label>
                <span>{t('snapshot.confirm')}</span>
                <input
                  value={confirmation[snapshot.id] ?? ''}
                  onChange={(event) =>
                    setConfirmation((current) => ({
                      ...current,
                      [snapshot.id]: event.target.value,
                    }))
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => onRestore(snapshot.id, confirmation[snapshot.id] ?? '')}
              >
                {t('snapshot.restore')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </details>
  );
}
