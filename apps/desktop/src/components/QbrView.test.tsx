// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { QbrToolbar } from './QbrView.jsx';

afterEach(cleanup);

describe('QbrToolbar', () => {
  it('offers Capacity, Demand, and Review as the three QBR surfaces', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(
      <QbrToolbar
        surface="CAPACITY"
        onSurface={(surface) => {
          seen.push(surface);
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'QBR' })).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'QBR view' });
    expect(select).toBeTruthy();
    await user.selectOptions(select, 'DEMAND');
    expect(seen).toEqual(['DEMAND']);
    await user.selectOptions(select, 'REVIEW');
    expect(seen).toEqual(['DEMAND', 'REVIEW']);
  });
});
