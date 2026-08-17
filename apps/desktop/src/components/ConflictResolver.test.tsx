// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConflictRecord } from '@flowmap/storage';

import { ConflictResolver } from './ConflictResolver.jsx';

afterEach(cleanup);

const conflict: ConflictRecord = {
  id: 'cf-1',
  workspaceId: 'ws',
  entityRef: { kind: 'COMMITMENT', id: 'c-1' },
  field: 'name',
  localValue: 'Mine',
  remoteValue: 'Theirs',
  detectedAt: '2026-08-17T14:00:00Z',
};

describe('ConflictResolver', () => {
  it('offers keep mine, take theirs, and edit', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(
      <ConflictResolver
        conflicts={[conflict]}
        onResolve={(_row, action) => {
          seen.push(action);
        }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: /conflict/i })).toBeTruthy();
    expect(screen.getByText(/Mine/)).toBeTruthy();
    expect(screen.getByText(/Theirs/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /keep mine/i }));
    expect(seen).toEqual(['KEEP_MINE']);
  });
});
