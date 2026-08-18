/**
 * Application entry point.
 *
 * Selects a runtime — the Tauri shell when running inside it, an in-process
 * repository otherwise — then mounts. Nothing above this file knows which one
 * it got.
 *
 * Bootstrapping is a function rather than top-level await: the portable Windows
 * build may run on an older WebView2, and a module-level await would raise the
 * required target for the whole bundle.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from '@flowmap/ui';
import { readStoredAppearance } from './state/appearance.js';

import '@flowmap/ui/fonts.css';
import '@flowmap/ui/tokens.css';
import './styles.css';

import { App } from './app/App.jsx';
import { ErrorBoundary } from './app/ErrorBoundary.jsx';
import { createRuntime } from './runtime.js';
import { useWorkspace } from './state/workspace-store.js';

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');

  applyTheme(document.documentElement, {
    mode: readStoredAppearance() ?? 'system',
    contrast: 'normal',
    motion: 'system',
    density: 'default',
    presentation: false,
  });

  const runtime = await createRuntime();

  // A door for the benchmark harness only. Seeding 500 commitments through the
  // UI would measure the form, not the board, and the budgets in spec 11 §6.2
  // are about the board.
  Object.assign(globalThis, {
    __flowmapLoadScale: (size: 25 | 100 | 500) => useWorkspace.getState().loadSample(size),
  });
  await useWorkspace.getState().init(runtime, 'You');

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap();
