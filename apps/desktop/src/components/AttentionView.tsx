/**
 * Attention lens: what needs a human look now.
 *
 * Radar is the same list as a side sheet. This lens is the full-canvas
 * companion — grouped by reason, with a table, so Attention is not another
 * copy of the Portfolio map.
 */

import { useMemo, useState } from 'react';
import {
  RADAR_GROUPS,
  filterMode,
  groupSignals,
  type RadarMode,
  type RuleResult,
} from '@flowmap/rules';
import type { FilterState } from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

export function AttentionView({
  signals,
  today,
  ownedRefs,
  filter,
  onOpen,
}: {
  readonly signals: readonly RuleResult[];
  readonly today: string;
  readonly ownedRefs: ReadonlySet<string>;
  readonly filter: FilterState;
  readonly onOpen: (signal: RuleResult) => void;
}) {
  const [mode, setMode] = useState<RadarMode>('PORTFOLIO');
  const visible = useMemo(() => {
    const scoped = filterMode(signals, mode, ownedRefs);
    return scoped.filter((signal) => matchesAttentionFilter(signal, filter));
  }, [signals, mode, ownedRefs, filter]);
  const groups = useMemo(() => groupSignals(visible, today), [visible, today]);

  return (
    <section className="fm-m5" aria-labelledby="attention-title">
      <header className="fm-m5__header">
        <div>
          <h2 id="attention-title">{t('attention.title')}</h2>
          <p>{t('attention.description')}</p>
        </div>
        <div className="fm-m5__controls">
          <label>
            {t('radar.mode')}
            <select
              value={mode}
              aria-label={t('radar.mode')}
              onChange={(event) => setMode(event.target.value as RadarMode)}
            >
              {(['PORTFOLIO', 'MINE'] as const).map((item) => (
                <option key={item} value={item}>
                  {t(`radar.mode.${item}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {groups.length === 0 ? (
        <p className="fm-empty">{mode === 'MINE' ? t('radar.emptyMine') : t('attention.empty')}</p>
      ) : (
        <div className="fm-attention">
          {groups.map((group) => (
            <article key={group.id} className="fm-attention__group">
              <h3>
                {t(`radar.group.${group.id}`)}
                <span>{group.signals.length}</span>
              </h3>
              <ul>
                {group.signals.map((signal) => (
                  <li key={signal.signalKey}>
                    <button
                      type="button"
                      className="fm-attention__item"
                      data-severity={signal.severity}
                      onClick={() => onOpen(signal)}
                    >
                      <strong>{t(`rules.${signal.ruleCode}.title`)}</strong>
                      <span>{t(`rules.${signal.ruleCode}.message`, signal.facts)}</span>
                      <em>{t(`severity.${signal.severity.toLowerCase()}`)}</em>
                      {signal.dueOn && <i>{signal.dueOn}</i>}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}

      <div className="fm-m5__table">
        <table>
          <caption>{t('attention.table')}</caption>
          <thead>
            <tr>
              <th>{t('attention.signal')}</th>
              <th>{t('attention.reason')}</th>
              <th>{t('attention.severity')}</th>
              <th>{t('attention.due')}</th>
              <th>{t('attention.open')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((signal) => (
              <tr key={signal.signalKey}>
                <td>{t(`rules.${signal.ruleCode}.title`)}</td>
                <td>{t(`radar.group.${groupOfFallback(signal, today)}`)}</td>
                <td>{t(`severity.${signal.severity.toLowerCase()}`)}</td>
                <td>{signal.dueOn ?? '—'}</td>
                <td>
                  <button type="button" className="fm-link" onClick={() => onOpen(signal)}>
                    {t('attention.open')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function matchesAttentionFilter(signal: RuleResult, filter: FilterState): boolean {
  const team = String(signal.facts['teamId'] ?? '');
  const quarter = String(signal.facts['quarterId'] ?? '');
  const name = String(
    signal.facts['commitment'] ?? signal.facts['team'] ?? signal.facts['product'] ?? '',
  );
  if (filter.teams.length > 0 && team && !filter.teams.includes(team)) return false;
  if (filter.quarters.length > 0 && quarter && !filter.quarters.includes(quarter as never))
    return false;
  const text = filter.text.trim().toLowerCase();
  return text.length === 0 || name.toLowerCase().includes(text);
}

function groupOfFallback(signal: RuleResult, today: string): string {
  return groupSignals([signal], today)[0]?.id ?? RADAR_GROUPS[0];
}
