/**
 * The persistent scenario affordance.
 *
 * A scenario is shown as an explicit draft alongside the baseline — never as a
 * mysterious alternate mode. The comparison surface will attach here as M4's
 * overlay and diff steps land.
 */

import type { Scenario } from '@flowmap/domain';

import { t } from '../i18n/t.js';

export type ScenarioDockProps = {
  readonly scenarios: readonly Scenario[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onCreate: () => void;
  readonly onDiscard: (id: string) => void;
  readonly summary?: { teamsAffected: number; quartersAffected: number; netUnitsMoved: number; newOverflows: number; resolvedOverflows: number };
};

export function ScenarioDock({
  scenarios,
  selectedId,
  onSelect,
  onCreate,
  onDiscard,
  summary,
}: ScenarioDockProps) {
  const active = scenarios.filter((scenario) => scenario.status === 'DRAFT' || scenario.status === 'SHARED');
  const selected = active.find((scenario) => scenario.id === selectedId) ?? null;

  return (
    <section className="fm-scenarios" aria-label={t('scenario.label')}>
      <div className="fm-scenarios__head">
        <div>
          <p className="fm-scenarios__eyebrow">{t('scenario.eyebrow')}</p>
          <h2>{selected ? selected.name : t('scenario.baseline')}</h2>
        </div>
        <button type="button" className="fm-quiet" onClick={onCreate}>
          {t('scenario.new')}
        </button>
      </div>

      <p className="fm-scenarios__status" role="status">
        {selected ? t('scenario.draftStatus') : t('scenario.baselineStatus')}
      </p>

      {active.length > 0 && (
        <div className="fm-scenarios__choices" role="list" aria-label={t('scenario.available')}>
          <button
            type="button"
            aria-pressed={selected === null}
            className="fm-scenarios__choice"
            onClick={() => onSelect(null)}
          >
            {t('scenario.baseline')}
          </button>
          {active.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              aria-pressed={scenario.id === selected?.id}
              className="fm-scenarios__choice"
              onClick={() => onSelect(scenario.id)}
            >
              <span>{scenario.name}</span>
              <span className="fm-scenarios__meta">{t(`scenario.visibility.${scenario.visibility}`)}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          {summary && (
            <dl className="fm-scenarios__diff" aria-label={t('scenario.diffLabel')}>
              <div><dt>{t('scenario.teamsAffected')}</dt><dd>{summary.teamsAffected}</dd></div>
              <div><dt>{t('scenario.quartersAffected')}</dt><dd>{summary.quartersAffected}</dd></div>
              <div><dt>{t('scenario.unitsMoved')}</dt><dd>{summary.netUnitsMoved}</dd></div>
              <div><dt>{t('scenario.newOverflows')}</dt><dd>{summary.newOverflows}</dd></div>
            </dl>
          )}
        <div className="fm-scenarios__footer">
          <span>{t('scenario.commands', { count: selected.commands.length })}</span>
          <button type="button" className="fm-danger" onClick={() => onDiscard(selected.id)}>
            {t('scenario.discard')}
          </button>
        </div>
        </>
      )}
    </section>
  );
}
