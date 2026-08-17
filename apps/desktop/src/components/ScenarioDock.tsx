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
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirmingApply, setConfirmingApply] = useState(false);
  const [selectedCommandIds, setSelectedCommandIds] = useState<readonly string[] | null>(null);
  const conflicts = rebase?.filter((outcome) => outcome.status === 'CONFLICT') ?? [];
  const stale = selected !== null && rebase !== undefined;
  const missingPrerequisites = selected ? prerequisitesFor(selected, selectedCommandIds ?? []) : [];

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
          <div role="listitem">
            <button
              type="button"
              aria-pressed={selected === null}
              className="fm-scenarios__choice"
              onClick={() => onSelect(null)}
            >
              {t('scenario.baseline')}
            </button>
          </div>
          {active.map((scenario) => (
            <div key={scenario.id} role="listitem">
              <button
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
            </div>
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
              diff.gatePassages.length > 0 ||
              diff.productImpact.length > 0 ||
              diff.dependencies.length > 0 ||
              diff.milestones.length > 0 ||
              diff.attention.added.length > 0 ||
              diff.attention.removed.length > 0 ||
              diff.attention.worsened.length > 0) ? (
              <ul tabIndex={0} aria-label={t('scenario.diff.list')}>
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
                {diff.productImpact.map((change) => (
                  <li key={`${change.productServiceId}:${change.quarterId}`}>
                    {t('scenario.diff.changeLoad', {
                      product: change.productServiceId,
                      quarter: change.quarterId,
                      before: change.changeLoadBefore,
                      after: change.changeLoadAfter,
                    })}
                  </li>
                ))}
                {diff.dependencies.map((change) => (
                  <li key={change.dependencyId}>
                    {t('scenario.diff.dependency', { effect: change.effect })}
                  </li>
                ))}
                {diff.milestones.map((change) => (
                  <li key={change.milestoneId}>
                    {t('scenario.diff.milestone', { conflict: change.conflict })}
                  </li>
                ))}
                {(diff.attention.added.length > 0 ||
                  diff.attention.removed.length > 0 ||
                  diff.attention.worsened.length > 0) && (
                  <li>
                    {t('scenario.diff.attention', {
                      added: diff.attention.added.length,
                      removed: diff.attention.removed.length,
                      worsened: diff.attention.worsened.length,
                    })}
                  </li>
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
              {missingPrerequisites.length > 0 && (
                <button
                  type="button"
                  className="fm-quiet"
                  onClick={() =>
                    setSelectedCommandIds((current) => [
                      ...new Set([...(current ?? []), ...missingPrerequisites]),
                    ])
                  }
                >
                  {t('scenario.includePrerequisites', { count: missingPrerequisites.length })}
                </button>
              )}
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
                          <option value="EDIT">{t('scenario.rebase.edit')}</option>
                        </select>
                        {resolutions[outcome.commandId] === 'EDIT' && (
                          <input
                            value={edits[outcome.commandId] ?? String(outcome.scenarioValue ?? '')}
                            aria-label={t('scenario.rebase.editValue', { field: outcome.field })}
                            onChange={(event) =>
                              setEdits((current) => ({
                                ...current,
                                [outcome.commandId]: event.target.value,
                              }))
                            }
                          />
                        )}
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
                    conflicts.map((outcome) => {
                      const action = resolutions[outcome.commandId]!;
                      const record = selected.commands.find(
                        (item) => item.id === outcome.commandId,
                      )!;
                      if (action !== 'EDIT') return { commandId: outcome.commandId, action };
                      const command = record.command as {
                        payload?: Readonly<Record<string, unknown>>;
                      };
                      const payload = command.payload ?? {};
                      const patch = (payload['patch'] as Readonly<Record<string, unknown>>) ?? {};
                      return {
                        commandId: outcome.commandId,
                        action,
                        command: {
                          ...record.command,
                          payload: {
                            ...payload,
                            patch: { ...patch, [outcome.field]: edits[outcome.commandId] ?? '' },
                          },
                        },
                      } as RebaseResolution;
                    }),
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
                {diff.productImpact.length > 0 && (
                  <li>{t('consequence.changeLoad', { count: diff.productImpact.length })}</li>
                )}
                {diff.dependencies.length > 0 && (
                  <li>{t('consequence.dependencies', { count: diff.dependencies.length })}</li>
                )}
                {(diff.attention.added.length > 0 || diff.attention.worsened.length > 0) && (
                  <li>
                    {t('consequence.attention', {
                      count: diff.attention.added.length + diff.attention.worsened.length,
                    })}
                  </li>
                )}
              </ul>
              <details>
                <summary>{t('consequence.details')}</summary>
                <ul>
                  {diff.capacity.map((item) => (
                    <li key={`${item.teamId}:${item.quarterId}`}>
                      {t('consequence.capacityDetail', {
                        team: item.teamId,
                        quarter: item.quarterId,
                        delta: item.loadAfter - item.loadBefore,
                      })}
                    </li>
                  ))}
                </ul>
              </details>
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

function prerequisitesFor(scenario: Scenario, selectedIds: readonly string[]): readonly string[] {
  const selected = new Set(selectedIds);
  const missing = new Set<string>();
  for (const record of scenario.commands.filter((item) => selected.has(item.id))) {
    const command = record.command as { name?: string; payload?: { commitmentId?: string } };
    const commitmentId = command.payload?.commitmentId;
    if (!commitmentId || command.name === 'SetPrimaryTeam') continue;
    for (const earlier of scenario.commands.filter((item) => item.sequence < record.sequence)) {
      const candidate = earlier.command as { name?: string; payload?: { commitmentId?: string } };
      if (candidate.payload?.commitmentId !== commitmentId) continue;
      const required =
        (command.name === 'AssignCapacityFootprint' && candidate.name === 'SetPrimaryTeam') ||
        (command.name === 'PassCommitGate' &&
          (candidate.name === 'SetPrimaryTeam' || candidate.name === 'AssignCapacityFootprint'));
      if (required && !selected.has(earlier.id)) missing.add(earlier.id);
    }
  }
  return [...missing];
}
