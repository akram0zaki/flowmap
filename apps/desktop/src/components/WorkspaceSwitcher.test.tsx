// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkspaceSwitcher } from './WorkspaceSwitcher.jsx';

afterEach(cleanup);

const personal = { id: 'ws-personal', name: 'My portfolio', updatedAt: '2026-08-15T09:00:00Z' };
const sample = {
  id: 'ws-sample',
  name: 'Retail Payments & Channels',
  updatedAt: '2026-08-15T08:00:00Z',
  isSample: true,
};

describe('WorkspaceSwitcher', () => {
  it('marks the sample workspace and keeps it switchable', async () => {
    const user = userEvent.setup();
    const switched: string[] = [];
    render(
      <WorkspaceSwitcher
        workspaces={[personal, sample]}
        archivedWorkspaces={[]}
        activeWorkspaceId={personal.id}
        timezone="UTC"
        onSwitch={(id) => switched.push(id)}
        onCreate={() => undefined}
        onArchive={() => undefined}
        onRestore={() => undefined}
      />,
    );

    await user.click(screen.getByText('My portfolio', { selector: 'summary' }));
    expect(
      screen.getByRole('button', { name: 'Retail Payments & Channels (sample)' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retail Payments & Channels (sample)' }));
    expect(switched).toEqual([sample.id]);
    expect(
      (document.querySelector('details.fm-workspace-switcher') as HTMLDetailsElement).open,
    ).toBe(false);
  });

  it('does not offer archive when the sample is the other workspace', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSwitcher
        workspaces={[personal, sample]}
        archivedWorkspaces={[]}
        activeWorkspaceId={personal.id}
        timezone="UTC"
        onSwitch={() => undefined}
        onCreate={() => undefined}
        onArchive={() => undefined}
        onRestore={() => undefined}
      />,
    );

    await user.click(screen.getByText('My portfolio', { selector: 'summary' }));
    expect(screen.getByRole('radio', { name: 'This computer' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Shared file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive workspace' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
