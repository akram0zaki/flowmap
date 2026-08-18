import { useCallback, useState } from 'react';

import {
  applyAppearance,
  readStoredAppearance,
  resolveAppearance,
  writeStoredAppearance,
  type Appearance,
} from './appearance.js';

export function useAppearance(): {
  readonly mode: Appearance;
  readonly toggle: () => void;
} {
  const [mode, setMode] = useState<Appearance>(() => resolveAppearance(readStoredAppearance()));

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: Appearance = current === 'dark' ? 'light' : 'dark';
      writeStoredAppearance(next);
      applyAppearance(next);
      return next;
    });
  }, []);

  return { mode, toggle };
}
