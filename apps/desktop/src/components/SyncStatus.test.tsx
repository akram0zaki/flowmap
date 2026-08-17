// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SyncStatus as Status } from '@flowmap/storage';

import { SyncStatus } from './SyncStatus.jsx';

afterEach(cleanup);

function status(over: Partial<Status> = {}): Status {
  return {
    providerId: 'FILE',
    lastKnownRemoteAt: '2026-08-17T14:05:00Z',
    lastPullAt: '2026-08-17T14:05:00Z',
    lastPushAt: '2026-08-17T14:05:00Z',
    pendingCount: 2,
    conflictCount: 1,
    reachable: true,
    shareMode: 'WRITABLE',
    conflictCopies: [],
    ...over,
  };
}

describe('SyncStatus', () => {
  it('shows last-known-remote time, pending and conflict counts', async () => {
    const user = userEvent.setup();
    const onSync = { called: false };
    const onConflicts = { called: false };
    render(
      <SyncStatus
        status={status()}
        onSync={() => {
          onSync.called = true;
        }}
        onOpenConflicts={() => {
          onConflicts.called = true;
        }}
      />,
    );
    expect(screen.getByText(/14:05/)).toBeTruthy();
    expect(screen.getByText(/2 pending/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /1 conflict/i }));
    expect(onConflicts.called).toBe(true);
    await user.click(screen.getByRole('button', { name: /sync now/i }));
    expect(onSync.called).toBe(true);
  });

  it('explains a read-only share without implying the work was lost', () => {
    render(
      <SyncStatus
        status={status({ shareMode: 'READ_ONLY', pendingCount: 0, conflictCount: 0 })}
        onSync={() => {}}
        onOpenConflicts={() => {}}
      />,
    );
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });
});
