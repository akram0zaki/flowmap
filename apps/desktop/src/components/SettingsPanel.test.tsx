// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SettingsPanel } from './SettingsPanel.jsx';
import type { Runtime } from '../state/workspace-store.js';

afterEach(cleanup);

function runtime(over: Partial<Runtime> = {}): Runtime {
  return {
    repository: {} as Runtime['repository'],
    now: () => '2026-08-17T09:00:00Z',
    newId: () => 'id',
    dataDir: '/Users/x/Library/Application Support/Flowmap',
    workspacesDir: '/Users/x/Library/Application Support/Flowmap/workspaces',
    logsDir: '/Users/x/Library/Logs/Flowmap',
    portable: false,
    portableSource: 'APP_DATA',
    version: '0.1.0',
    webview: 'wkwebview',
    ...over,
  };
}

describe('SettingsPanel', () => {
  it('shows the resolved data directory and storage mode', () => {
    render(<SettingsPanel runtime={runtime()} onClearLocalData={() => {}} onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('/Users/x/Library/Application Support/Flowmap')).toBeTruthy();
    expect(screen.getByText('Per-user application data.')).toBeTruthy();
    expect(screen.getByText('Version 0.1.0')).toBeTruthy();
  });

  it('names portable mode when a data folder sits beside the app', () => {
    render(
      <SettingsPanel
        runtime={runtime({
          dataDir: '/Volumes/USB/Flowmap/data',
          workspacesDir: '/Volumes/USB/Flowmap/data/workspaces',
          logsDir: '/Volumes/USB/Flowmap/data/logs',
          portable: true,
          portableSource: 'BESIDE_EXE',
        })}
        onClearLocalData={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('Portable — using the data folder beside the app.')).toBeTruthy();
    expect(screen.getByText(/create a folder named data/i)).toBeTruthy();
  });

  it('explains the browser target when no folder exists', () => {
    const browserRuntime: Runtime = {
      repository: {} as Runtime['repository'],
      now: () => '2026-08-17T09:00:00Z',
      newId: () => 'id',
      version: '0.1.0',
      webview: 'browser',
    };
    render(
      <SettingsPanel runtime={browserRuntime} onClearLocalData={() => {}} onClose={() => {}} />,
    );

    expect(screen.getByText('Browser development target.')).toBeTruthy();
    expect(screen.getByText(/stored in this browser/i)).toBeTruthy();
  });

  it('names the standalone ZIP when the runtime is WebView2', () => {
    render(
      <SettingsPanel
        runtime={runtime({ webview: 'evergreen' })}
        onClearLocalData={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/Flowmap-0.1.0-win-x64-standalone\.zip/)).toBeTruthy();
  });

  it('has a three-part tooltip for the data directory', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel runtime={runtime()} onClearLocalData={() => {}} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /what does data directory mean/i }));
    expect(screen.getByText(/local cache, snapshots, and logs/i)).toBeTruthy();
    expect(screen.getByText(/never this SQLite cache/i)).toBeTruthy();
  });

  it('asks before clearing local data', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<SettingsPanel runtime={runtime()} onClearLocalData={onClear} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Clear local data' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
