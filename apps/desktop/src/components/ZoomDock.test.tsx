// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ZoomDock } from './ZoomDock.jsx';

afterEach(cleanup);

describe('ZoomDock', () => {
  it('offers Overview, Areas, and Detail without leaving the map', async () => {
    const user = userEvent.setup();
    const chosen: number[] = [];
    render(
      <ZoomDock
        level={2}
        scale={1}
        onLevel={(level) => chosen.push(level)}
        onZoomBy={() => undefined}
      />,
    );
    expect(screen.getByRole('group', { name: 'Zoom level' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Detail' }));
    expect(chosen).toEqual([3]);
  });
});
