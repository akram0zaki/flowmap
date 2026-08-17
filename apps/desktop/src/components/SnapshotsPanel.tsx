/** Recovery points are explicit, local-only records; the event history remains intact. */

import type { SnapshotRecord } from '@flowmap/storage';

import { t } from '../i18n/t.js';

export function SnapshotsPanel({
  snapshots,
  onCreate,
}: {
  readonly snapshots: readonly SnapshotRecord[];
  readonly onCreate: () => void;
}) {
  return (
    <details className="fm-snapshots">
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
            </li>
          ))}
        </ul>
      </section>
    </details>
  );
}
