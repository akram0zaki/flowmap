// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ShortcutReference } from './ShortcutReference.jsx';

afterEach(cleanup);

describe('ShortcutReference', () => {
  it('lists the global and canvas shortcuts from the spec', () => {
    render(<ShortcutReference onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByText('Command palette')).toBeTruthy();
    expect(
      screen.getByText('Move mode — arrows choose a target, Enter commits, Esc cancels'),
    ).toBeTruthy();
    expect(screen.getByText('Ctrl/Cmd + K')).toBeTruthy();
  });
});
