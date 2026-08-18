/** Small, keyboard-first entry point for data-free workspace view presets. */

import { useRef, useState } from 'react';
import type { SavedView } from '@flowmap/domain';

import { t } from '../i18n/t.js';
import { HEADER_MENU_NAME, useDismissibleDetails } from '../state/use-dismissible-details.js';

export function SavedViews({
  views,
  onSave,
  onApply,
  onRemove,
}: {
  readonly views: readonly SavedView[];
  readonly onSave: (name: string) => void;
  readonly onApply: (view: SavedView) => void;
  readonly onRemove: (viewId: string) => void;
}) {
  const [name, setName] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menu);
  return (
    <details ref={menu} className="fm-header-menu fm-saved-views" name={HEADER_MENU_NAME}>
      <summary>{t('savedViews.summary')}</summary>
      <section aria-label={t('savedViews.summary')}>
        <h2>{t('savedViews.title')}</h2>
        <p>{t('savedViews.definition')}</p>
        <p>{t('savedViews.not')}</p>
        <p>{t('savedViews.example')}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onSave(name.trim());
            setName('');
          }}
        >
          <label>
            <span>{t('savedViews.name')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit" className="fm-primary">
            {t('savedViews.save')}
          </button>
        </form>
        <ul>
          {views.map((view) => (
            <li key={view.id}>
              <button type="button" onClick={() => onApply(view)}>
                {view.name}
              </button>
              <button type="button" onClick={() => onRemove(view.id)}>
                {t('savedViews.remove', { name: view.name })}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </details>
  );
}
