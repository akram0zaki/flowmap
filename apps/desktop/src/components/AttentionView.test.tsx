// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RuleResult } from '@flowmap/rules';
import { NO_FILTER } from '@flowmap/visual-model';

import { AttentionView } from './AttentionView.jsx';

afterEach(cleanup);

function signal(over: Partial<RuleResult> = {}): RuleResult {
  return {
    signalKey: 'sig-1',
    ruleCode: 'CAP_OVERFLOW',
    entityRef: { kind: 'TEAM_QUARTER', id: 'tq-1' },
    category: 'CAPACITY',
    severity: 'HIGH',
    surfaces: ['RADAR', 'HEALTH', 'INLINE'],
    facts: { team: 'Payments', teamId: 'payments', quarterId: '2026-Q3' },
    conditionFingerprint: 'fp',
    actions: [{ kind: 'OPEN', ref: { kind: 'TEAM_QUARTER', id: 'tq-1' }, labelKey: 'open' }],
    occurredOn: '2026-08-15',
    dueOn: '2026-08-10',
    ...over,
  };
}

describe('AttentionView', () => {
  it('lists attention signals instead of the portfolio map', () => {
    render(
      <AttentionView
        signals={[signal()]}
        today="2026-08-15"
        ownedRefs={new Set()}
        filter={NO_FILTER}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Attention' })).toBeTruthy();
    expect(screen.getByText(/need a human look now/i)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Attention signals' })).toBeTruthy();
    expect(screen.queryByRole('grid', { name: /portfolio map/i })).toBeNull();
  });

  it('opens the matching item from the list', async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(
      <AttentionView
        signals={[signal()]}
        today="2026-08-15"
        ownedRefs={new Set()}
        filter={NO_FILTER}
        onOpen={(item) => {
          opened.push(item.signalKey);
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Over capacity/i }));
    expect(opened).toEqual(['sig-1']);
  });

  it('shows an empty state when nothing needs a look', () => {
    render(
      <AttentionView
        signals={[]}
        today="2026-08-15"
        ownedRefs={new Set()}
        filter={NO_FILTER}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText('Nothing needs attention.')).toBeTruthy();
  });
});
