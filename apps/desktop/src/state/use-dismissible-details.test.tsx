// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';

import { HEADER_MENU_NAME, useDismissibleDetails } from './use-dismissible-details.js';

afterEach(cleanup);

function Menu({ label, body }: { readonly label: string; readonly body: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(ref);
  return (
    <details ref={ref} name={HEADER_MENU_NAME}>
      <summary>{label}</summary>
      <section>{body}</section>
    </details>
  );
}

describe('header menus', () => {
  it('closes the open menu when another in the group is opened', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Menu label="First" body="First panel" />
        <Menu label="Second" body="Second panel" />
      </>,
    );
    await user.click(screen.getByText('First'));
    expect(screen.getByText('First panel').closest('details')?.open).toBe(true);
    await user.click(screen.getByText('Second'));
    expect(screen.getByText('First panel').closest('details')?.open).toBe(false);
    expect(screen.getByText('Second panel').closest('details')?.open).toBe(true);
  });

  it('closes when the pointer lands outside', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Menu label="Open me" body="Inside" />
        <button type="button">Away</button>
      </>,
    );
    await user.click(screen.getByText('Open me'));
    expect(screen.getByText('Inside').closest('details')?.open).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Away' }));
    expect(screen.getByText('Inside').closest('details')?.open).toBe(false);
  });
});
