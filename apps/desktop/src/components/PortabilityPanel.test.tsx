// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceState } from '@flowmap/domain';

import { PortabilityPanel } from './PortabilityPanel.jsx';

afterEach(cleanup);

const state = {
  workspace: {
    id: 'ws-1',
    name: 'My portfolio',
    schemaVersion: 1,
    settings: {},
  },
  commitments: new Map(),
} as unknown as WorkspaceState;

describe('PortabilityPanel', () => {
  it('groups exports as visible actions, not a wrap of unmarked text', async () => {
    const user = userEvent.setup();
    render(
      <PortabilityPanel
        state={state}
        events={[]}
        profileName="You"
        now={() => '2026-08-18T09:00:00Z'}
        rows={[]}
        radarRows={[]}
        onImportedIdeas={async () => true}
        onSaveMapping={async () => true}
        onNotificationSettings={async () => true}
        announce={() => undefined}
      />,
    );

    await user.click(screen.getByText('Import and export'));
    expect(screen.getByRole('heading', { name: 'This view' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Radar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Workspace data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export current view as CSV' }).className).toContain(
      'fm-quiet',
    );
    expect(screen.getByRole('button', { name: 'Export workspace' }).className).toContain(
      'fm-primary',
    );
    expect(screen.getByRole('button', { name: 'Choose file to import' }).className).toContain(
      'fm-quiet',
    );
  });
});
