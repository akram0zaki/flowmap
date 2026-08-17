/**
 * The persistent scenario affordance.
 *
 * A scenario is shown as an explicit draft alongside the baseline — never as a
 * mysterious alternate mode. The comparison surface will attach here as M4's
 * overlay and diff steps land.
 */

import { useState } from 'react';
import type { RebaseOutcome, RebaseResolution, Scenario, ScenarioDiff } from '@flowmap/domain';

import { t } from '../i18n/t.js';

export type ScenarioDockProps = {
  readonly scenarios: readonly Scenario[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onCreate: () => void;
  readonly onDiscard: (id: string) => void;
  readonly onApply: (id: string, selectedCommandIds?: readonly string[]) => void;
  readonly onShare: (id: string) => void;
  readonly onClone: (id: string) => void;
  readonly summary?: {
    teamsAffected: number;
    quartersAffected: number;
    netUnitsMoved: number;
    newOverflows: number;
    resolvedOverflows: number;
  };
  readonly diff?: ScenarioDiff;
  readonly rebase?: readonly RebaseOutcome[];
  readonly onRebase: (id: string, resolutions: readonly RebaseResolution[]) => void;
};

export function ScenarioDock({
  scenarios,
  selectedId,
  onSelect,
  onCreate,
  onDiscard,
  onApply,
  onShare,
  onClone,
  summary,
  diff,
  rebase,
  onRebase,
}: ScenarioDockProps) {
  const active = scenarios.filter(
    (scenario) => scenario.status === 'DRAFT' || scenario.status === 'SHARED',
  );
  const selected = active.find((scenario) => scenario.id === selectedId) ?? null;
  const [resolutions, setResolutions] = useState<Record<string, RebaseResolution['action']>>({});
  const [confirmingApply, setConfirmingApply] = useState(false);
  const [selectedCommandIds, setSelectedCommandIds] = useState<readonly string[] | null>(null);
  const conflicts = rebase?.filter((outcome) => outcome.status === 'CONFLICT') ?? [];
  const stale = selected !== null && rebase !== undefined;

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
              <span className="fm-scenarios__meta">
                {t(`scenario.visibility.${scenario.visibility}`)}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          {summary && (
            <dl className="fm-scenarios__diff" aria-label={t('scenario.diffLabel')}>
              <div>
                <dt>{t('scenario.teamsAffected')}</dt>
                <dd>{summary.teamsAffected}</dd>
              </div>
              <div>
                <dt>{t('scenario.quartersAffected')}</dt>
                <dd>{summary.quartersAffected}</dd>
              </div>
              <div>
                <dt>{t('scenario.unitsMoved')}</dt>
                <dd>{summary.netUnitsMoved}</dd>
              </div>
              <div>
                <dt>{t('scenario.newOverflows')}</dt>
                <dd>{summary.newOverflows}</dd>
              </div>
            </dl>
          )}
          <section className="fm-scenario-diff" aria-label={t('scenario.diff.list')}>
            <h3>{t('scenario.comparison')}</h3>
            {diff &&
            (diff.capacity.length > 0 ||
              diff.commitments.length > 0 ||
              diff.gatePassages.length > 0) ? (
              <ul>
                {diff.capacity.map((change) => (
                  <li key={`${change.teamId}:${change.quarterId}`}>
                    {t('scenario.diff.capacityChange', {
                      team: change.teamId,
                      quarter: change.quarterId,
                      before: change.loadBefore,
                      after: change.loadAfter,
                      ghost: change.scenarioLoad,
                    })}
                  </li>
                ))}
                {diff.commitments.map((change) => (
                  <li key={change.commitmentId}>
                    {t('scenario.diff.commitmentChange', { count: change.changedFields.length })}
                  </li>
                ))}
                {diff.gatePassages.length > 0 && (
                  <li>{t('scenario.diff.gateCount', { count: diff.gatePassages.length })}</li>
                )}
              </ul>
            ) : (
              <p>{t('scenario.diff.empty')}</p>
            )}
          </section>
          {selected.commands.length > 0 && (
            <details className="fm-scenario-selective">
              <summary>{t('scenario.selective')}</summary>
              <p>{t('scenario.selectiveDescription')}</p>
              <ul>
                {selected.commands.map((command) => {
                  const checked = selectedCommandIds?.includes(command.id) ?? false;
                  return (
                    <li key={command.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedCommandIds((current) => {
                              const ids = new Set(current ?? []);
                              if (ids.has(command.id)) ids.delete(command.id);
                              else ids.add(command.id);
                              return [...ids];
                            })
                          }
                        />
                        {t(command.label)}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          {stale && (
            <section className="fm-scenario-rebase" aria-label={t('scenario.rebase')}>
              <h3>{t('scenario.rebase')}</h3>
              <p>{t('scenario.rebaseDescription')}</p>
              <ul>
                {rebase.map((outcome) => (
                  <li key={outcome.commandId}>
                    {outcome.status === 'CLEAN' && t('scenario.rebase.clean')}
                    {outcome.status === 'REDUNDANT' && t('scenario.rebase.redundant')}
                    {outcome.status === 'OBSOLETE' && t('scenario.rebase.obsolete')}
                    {outcome.status === 'CONFLICT' && (
                      <label>
                        <span>{t('scenario.rebase.conflict', { field: outcome.field })}</span>
                        <select
                          value={resolutions[outcome.commandId] ?? ''}
                          onChange={(event) =>
                            setResolutions((current) => ({
                              ...current,
                              [outcome.commandId]: event.target.value as RebaseResolution['action'],
                            }))
                          }
                        >
                          <option value="">{t('scenario.rebase.choose')}</option>
                          <option value="KEEP_MINE">{t('scenario.rebase.keepMine')}</option>
                          <option value="TAKE_THEIRS">{t('scenario.rebase.takeTheirs')}</option>
                        </select>
                      </label>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="fm-primary"
                disabled={conflicts.some((outcome) => resolutions[outcome.commandId] === undefined)}
                onClick={() =>
                  onRebase(
                    selected.id,
                    conflicts.map((outcome) => ({
                      commandId: outcome.commandId,
                      action: resolutions[outcome.commandId]!,
                    })),
                  )
                }
              >
                {t('scenario.rebase')}
              </button>
            </section>
          )}
          <div className="fm-scenarios__footer">
            <span>{t('scenario.commands', { count: selected.commands.length })}</span>
            <button
              type="button"
              className="fm-primary"
              disabled={stale}
              onClick={() => {
                setSelectedCommandIds(null);
                setConfirmingApply(true);
              }}
            >
              {t('scenario.apply')}
            </button>
            {selectedCommandIds !== null && selectedCommandIds.length > 0 && (
              <button type="button" disabled={stale} onClick={() => setConfirmingApply(true)}>
                {t('scenario.selective')}
              </button>
            )}
            {selected.visibility === 'PRIVATE' && (
              <button type="button" onClick={() => onShare(selected.id)}>
                {t('scenario.share')}
              </button>
            )}
            <button type="button" onClick={() => onClone(selected.id)}>
              {t('scenario.clone')}
            </button>
            <button type="button" className="fm-danger" onClick={() => onDiscard(selected.id)}>
              {t('scenario.discard')}
            </button>
          </div>
          {confirmingApply && diff && (
            <section
              className="fm-consequence-preview"
              role="dialog"
              aria-modal="true"
              aria-label={t('consequence.label')}
            >
              <h3>{t('consequence.label')}</h3>
              <p>{t('consequence.apply')}</p>
              <ul>
                {diff.capacity.length > 0 && (
                  <li>{t('consequence.capacity', { count: diff.capacity.length })}</li>
                )}
                {diff.summary.newOverflows > 0 && (
                  <li>{t('consequence.overflow', { count: diff.summary.newOverflows })}</li>
                )}
                {diff.gatePassages.length > 0 && (
                  <li>{t('consequence.gate', { count: diff.gatePassages.length })}</li>
                )}
              </ul>
              <div className="fm-consequence-preview__actions">
                <button type="button" onClick={() => setConfirmingApply(false)}>
                  {t('consequence.cancel')}
                </button>
                <button
                  type="button"
                  className="fm-primary"
                  onClick={() => {
                    setConfirmingApply(false);
                    onApply(selected.id, selectedCommandIds ?? undefined);
                  }}
                >
                  {t('consequence.continue')}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
