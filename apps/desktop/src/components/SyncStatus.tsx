/**
 * Last-known-remote time, pending writes, and conflict counts.
 *
 * The File provider is not live sync. The status says when we last saw the
 * shared document, never that peers are up to date right now.
 *
 * See docs/spec/07-persistence-sync.md §6 and 08-providers.md §3.
 */

import type { SyncStatus as Status } from '@flowmap/storage';

import { t } from '../i18n/t.js';

export type SyncStatusProps = {
  readonly status: Status | null;
  readonly onSync: () => void;
  readonly onOpenConflicts: () => void;
};

export function SyncStatus({ status, onSync, onOpenConflicts }: SyncStatusProps) {
  if (!status) {
    return (
      <span role="status" aria-live="polite">
        {t('status.saved')}
      </span>
    );
  }

  const when = status.lastKnownRemoteAt ? formatClock(status.lastKnownRemoteAt) : t('sync.never');
  const label = status.reachable
    ? t('sync.lastSeen', { time: when })
    : t('sync.unreachable', { time: when });

  return (
    <div className="fm-sync" role="status" aria-live="polite">
      <span>{label}</span>
      {status.pendingCount > 0 && <span>{t('sync.pending', { count: status.pendingCount })}</span>}
      {status.conflictCount > 0 && (
        <button type="button" className="fm-header__action" onClick={onOpenConflicts}>
          {t('sync.conflicts', { count: status.conflictCount })}
        </button>
      )}
      {status.shareMode === 'READ_ONLY' && <span>{t('sync.readOnly')}</span>}
      {status.shareMode === 'VANISHED' && <span>{t('sync.vanished')}</span>}
      {status.conflictCopies.length > 0 && (
        <span>{t('sync.conflictCopies', { count: status.conflictCopies.length })}</span>
      )}
      <button type="button" className="fm-header__action" onClick={onSync}>
        {t('sync.now')}
      </button>
    </div>
  );
}

function formatClock(iso: string): string {
  const match = /T(\d{2}:\d{2})/.exec(iso);
  return match?.[1] ?? iso;
}
