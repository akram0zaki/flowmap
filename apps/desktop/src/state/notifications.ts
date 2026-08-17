/** Foreground-only notification policy. Radar is still the source of truth. */

import type { NotificationSettings } from '@flowmap/domain';
import type { RuleResult } from '@flowmap/rules';

export type NotificationMessage = {
  readonly key: string;
  readonly title: string;
  readonly body: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function notificationMessages(
  signals: readonly RuleResult[],
  settings: NotificationSettings | undefined,
  now: Date,
  delivered: ReadonlyMap<string, number>,
  text: (key: string, params?: Record<string, string | number>) => string,
): readonly NotificationMessage[] {
  const preference = settings ?? { mode: 'MY_ACTIONS' as const };
  if (preference.mode === 'OFF' || isQuietHour(preference, now.getHours())) return [];
  const eligible = signals.filter(
    (signal) =>
      matchesPreference(signal, preference.mode) &&
      now.getTime() - (delivered.get(signal.signalKey) ?? 0) >= DAY_MS,
  );
  if (eligible.length > 3) {
    return [
      {
        key: eligible.map((signal) => signal.signalKey).join('|'),
        title: text('notifications.title'),
        body: text('notifications.summary', { count: eligible.length }),
      },
    ];
  }
  return eligible.map((signal) => ({
    key: signal.signalKey,
    title: text('notifications.title'),
    body: text('notifications.signal', { rule: signal.ruleCode, severity: signal.severity }),
  }));
}

function matchesPreference(signal: RuleResult, mode: NotificationSettings['mode']): boolean {
  if (mode === 'URGENT_ONLY') return signal.severity === 'HIGH';
  if (mode === 'STALE_ITEMS') return signal.ruleCode.includes('STALE');
  if (mode === 'PORTFOLIO_WARNINGS')
    return signal.severity === 'HIGH' || signal.severity === 'MEDIUM';
  // My actions: due/attention signals. Without shared identity in M6, owner
  // matching cannot be truthful, so this intentionally limits delivery to
  // action-bearing signals rather than guessing a person.
  return signal.dueOn !== undefined || signal.actions.length > 0;
}

function isQuietHour(settings: NotificationSettings, hour: number): boolean {
  const range = settings.quietHours;
  if (!range || range.startHour === range.endHour) return false;
  return range.startHour < range.endHour
    ? hour >= range.startHour && hour < range.endHour
    : hour >= range.startHour || hour < range.endHour;
}
