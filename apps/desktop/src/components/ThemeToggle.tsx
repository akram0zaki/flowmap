/** Light / dark is an explicit choice, announced in words — never by colour alone. */

import { useAppearance } from '../state/use-appearance.js';
import { t } from '../i18n/t.js';

export function ThemeToggle() {
  const { mode, toggle } = useAppearance();
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="fm-header__action"
      aria-pressed={mode === 'dark'}
      aria-label={t(next === 'dark' ? 'theme.toDark' : 'theme.toLight')}
      onClick={toggle}
    >
      {t(mode === 'dark' ? 'theme.dark' : 'theme.light')}
    </button>
  );
}
