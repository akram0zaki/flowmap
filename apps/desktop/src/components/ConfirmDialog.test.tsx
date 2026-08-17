// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConfirmDialog } from './ConfirmDialog.jsx';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('does not confirm on cancel or escape', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Clear local data"
        body="Export first."
        confirmLabel="Clear local data"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms only when the matching action is pressed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Clear local data"
        body="Export first."
        confirmLabel="Clear local data"
        danger
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear local data' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
