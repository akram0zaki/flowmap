/** First-run orientation is concise, dismissible, and explains the map's vocabulary. */

import { useState } from 'react';
import { t } from '../i18n/t.js';

export function FirstRunGuide() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <aside className="fm-first-run" aria-label={t('firstRun.title')}>
      <div>
        <h2>{t('firstRun.title')}</h2>
        <p>{t('firstRun.definition')}</p>
        <p>{t('firstRun.not')}</p>
        <p>{t('firstRun.example')}</p>
      </div>
      <button type="button" onClick={() => setOpen(false)}>
        {t('firstRun.dismiss')}
      </button>
    </aside>
  );
}
