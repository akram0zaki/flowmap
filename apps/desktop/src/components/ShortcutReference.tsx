/**
 * The keyboard model from spec 06 §11, as a readable companion to the native
 * Help menu and the `?` shortcut.
 */

import { t } from '../i18n/t.js';

const GLOBAL: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Ctrl/Cmd + K', action: 'shortcuts.palette' },
  { keys: 'Ctrl/Cmd + L', action: 'shortcuts.list' },
  { keys: 'Ctrl/Cmd + Z', action: 'shortcuts.undo' },
  { keys: 'Ctrl/Cmd + Shift + Z', action: 'shortcuts.redo' },
  { keys: 'Ctrl/Cmd + Shift + P', action: 'shortcuts.presentation' },
  { keys: 'Ctrl/Cmd + ,', action: 'shortcuts.settings' },
  { keys: '1 … 8', action: 'shortcuts.lens' },
  { keys: 'n', action: 'shortcuts.capture' },
  { keys: '/', action: 'shortcuts.search' },
  { keys: '?', action: 'shortcuts.this' },
  { keys: 'Esc', action: 'shortcuts.escape' },
];

const CANVAS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: '← → ↑ ↓', action: 'shortcuts.moveSelection' },
  { keys: 'Tab', action: 'shortcuts.regions' },
  { keys: 'Enter', action: 'shortcuts.open' },
  { keys: 'Space', action: 'shortcuts.focus' },
  { keys: 'm', action: 'shortcuts.moveMode' },
  { keys: 'r', action: 'shortcuts.resizeMode' },
  { keys: 'd', action: 'shortcuts.draw' },
  { keys: 'Delete', action: 'shortcuts.drop' },
  { keys: 'f', action: 'shortcuts.neighbourhood' },
  { keys: '+ / −', action: 'shortcuts.zoom' },
  { keys: 'g', action: 'shortcuts.gate' },
];

export function ShortcutReference({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="fm-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fm-dialog fm-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="fm-panel__head">
          <h2 id="shortcuts-title">{t('shortcuts.title')}</h2>
          <button type="button" className="fm-panel__close" onClick={onClose}>
            {t('shortcuts.close')}
          </button>
        </header>
        <ShortcutTable caption={t('shortcuts.global')} rows={GLOBAL} />
        <ShortcutTable caption={t('shortcuts.canvas')} rows={CANVAS} />
      </section>
    </div>
  );
}

function ShortcutTable({
  caption,
  rows,
}: {
  readonly caption: string;
  readonly rows: readonly { readonly keys: string; readonly action: string }[];
}) {
  return (
    <table className="fm-shortcuts__table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t('shortcuts.keys')}</th>
          <th scope="col">{t('shortcuts.does')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.action}>
            <th scope="row">
              <kbd>{row.keys}</kbd>
            </th>
            <td>{t(row.action)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
