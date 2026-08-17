import { describe, expect, it } from 'vitest';
import type { RuleResult } from '@flowmap/rules';

import { notificationMessages } from './notifications.js';

const signal = (key: string, severity: RuleResult['severity'] = 'HIGH'): RuleResult => ({
  signalKey: key,
  ruleCode: 'ATT_DATE_REACHED',
  entityRef: { kind: 'COMMITMENT', id: key },
  category: 'TIMING',
  severity,
  surfaces: ['RADAR'],
  facts: {},
  conditionFingerprint: key,
  actions: [],
  occurredOn: '2026-08-17',
  dueOn: '2026-08-17',
});
const text = (key: string, params: Record<string, string | number> = {}) =>
  `${key}:${params['count'] ?? ''}`;

describe('foreground notification policy', () => {
  it('coalesces a notification storm and does not re-deliver a signal inside 24 hours', () => {
    const now = new Date('2026-08-17T10:00:00Z');
    expect(
      notificationMessages(
        [signal('a'), signal('b'), signal('c'), signal('d')],
        { mode: 'MY_ACTIONS' },
        now,
        new Map(),
        text,
      ),
    ).toEqual([{ key: 'a|b|c|d', title: 'notifications.title:', body: 'notifications.summary:4' }]);
    expect(
      notificationMessages(
        [signal('a')],
        { mode: 'MY_ACTIONS' },
        now,
        new Map([['a', now.getTime()]]),
        text,
      ),
    ).toEqual([]);
  });

  it('honours quiet hours and the urgent-only preference', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    expect(
      notificationMessages(
        [signal('a')],
        { mode: 'MY_ACTIONS', quietHours: { startHour: 21, endHour: 7 } },
        now,
        new Map(),
        text,
      ),
    ).toEqual([]);
    expect(
      notificationMessages(
        [signal('a', 'MEDIUM')],
        { mode: 'URGENT_ONLY' },
        new Date('2026-08-17T10:00:00Z'),
        new Map(),
        text,
      ),
    ).toEqual([]);
  });
});
