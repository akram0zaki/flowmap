// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ThemeToggle } from './ThemeToggle.jsx';
import { clearStoredAppearance, readStoredAppearance } from '../state/appearance.js';

afterEach(() => {
  cleanup();
  clearStoredAppearance();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle', () => {
  it('switches the document between light and dark', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const button = screen.getByRole('button', { name: /appearance/i });
    const first = button.getAttribute('aria-label');
    await user.click(button);
    expect(button.getAttribute('aria-label')).not.toBe(first);
    const theme = document.documentElement.getAttribute('data-theme');
    expect(theme === 'light' || theme === 'dark').toBe(true);
    expect(readStoredAppearance()).toBe(theme);
  });
});
