// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FirstRunGuide } from './FirstRunGuide.jsx';

afterEach(cleanup);

describe('FirstRunGuide', () => {
  it('offers the sample workspace as a first action', async () => {
    const user = userEvent.setup();
    const explored = { called: false };
    render(
      <FirstRunGuide
        onExploreSample={() => {
          explored.called = true;
        }}
      />,
    );
    expect(screen.getByText(/always in the workspace switcher/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Explore sample workspace' }));
    expect(explored.called).toBe(true);
  });
});
