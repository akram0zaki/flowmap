/** First-run orientation is concise, dismissible, and explains the map's vocabulary. */

import { useState } from 'react';
import { t } from '../i18n/t.js';

export function FirstRunGuide({
  onExploreSample,
  onDismiss,
}: {
  readonly onExploreSample: () => void;
  readonly onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <aside className="fm-first-run" aria-label={t('firstRun.title')}>
      <div>
        <h2>{t('firstRun.title')}</h2>
        <p>{t('firstRun.definition')}</p>
        <p>{t('firstRun.not')}</p>
        <p>{t('firstRun.example')}</p>
        <p>{t('firstRun.sampleHint')}</p>
      </div>
      <div className="fm-first-run__actions">
        <button
          type="button"
          className="fm-primary"
          onClick={() => {
            onExploreSample();
            setOpen(false);
          }}
        >
          {t('action.exploreSample')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onDismiss?.();
          }}
        >
          {t('firstRun.dismiss')}
        </button>
      </div>
    </aside>
  );
}
