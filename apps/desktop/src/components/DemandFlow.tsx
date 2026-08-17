/**
 * QBR's planning surface. It deliberately keeps Ideas on the near side of the
 * gate: a placement becomes a ghost only in a selected scenario, never an
 * accidental baseline commitment.
 */

import { useMemo, useState } from 'react';

import { t } from '../i18n/t.js';

export type DemandIdea = { readonly id: string; readonly name: string };
export type DemandTeam = { readonly id: string; readonly name: string };

export type DemandFlowProps = {
  readonly ideas: readonly DemandIdea[];
  readonly teams: readonly DemandTeam[];
  readonly quarters: readonly string[];
  readonly currentQuarter: string;
  readonly scenarioId: string | null;
  readonly defaultUnits: number;
  readonly headroomFor: (teamId: string, quarterId: string) => number;
  readonly onPlace: (input: {
    commitmentId: string;
    teamId: string;
    quarterId: string;
    units: number;
  }) => void;
};

export function DemandFlow({
  ideas,
  teams,
  quarters,
  currentQuarter,
  scenarioId,
  defaultUnits,
  headroomFor,
  onPlace,
}: DemandFlowProps) {
  const [ideaId, setIdeaId] = useState<string | null>(ideas[0]?.id ?? null);
  const [teamId, setTeamId] = useState<string | null>(teams[0]?.id ?? null);
  const [quarterId, setQuarterId] = useState<string | null>(
    quarters.includes(currentQuarter) ? currentQuarter : (quarters[0] ?? null),
  );
  const [units, setUnits] = useState(defaultUnits);
  const [moveMode, setMoveMode] = useState(false);
  const selected = useMemo(() => ideas.find((idea) => idea.id === ideaId) ?? null, [ideas, ideaId]);
  const targetAnnouncement =
    teamId && quarterId
      ? t('qbr.target', {
          team: teams.find((team) => team.id === teamId)?.name ?? teamId,
          quarter: quarterId,
          headroom: headroomFor(teamId, quarterId),
        })
      : '';

  const place = () => {
    if (!selected || !teamId || !quarterId || scenarioId === null || units <= 0) return;
    onPlace({ commitmentId: selected.id, teamId, quarterId, units });
    setMoveMode(false);
  };

  const moveTarget = (axis: 'team' | 'quarter', delta: number) => {
    const choices = axis === 'team' ? teams.map((team) => team.id) : quarters;
    const value = axis === 'team' ? teamId : quarterId;
    const current = Math.max(0, choices.indexOf(value ?? ''));
    const next = choices[Math.max(0, Math.min(choices.length - 1, current + delta))] ?? null;
    if (axis === 'team') setTeamId(next);
    else setQuarterId(next);
  };

  return (
    <section className="fm-demand-flow" aria-label={t('qbr.label')}>
      <section className="fm-demand-flow__lane">
        <h2 id="demand-flow-ideas">{t('qbr.ideas')}</h2>
        <div
          role="listbox"
          aria-labelledby="demand-flow-ideas"
          tabIndex={0}
          onKeyDown={(event) => {
            if (!moveMode && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
              event.preventDefault();
              const current = Math.max(
                0,
                ideas.findIndex((idea) => idea.id === ideaId),
              );
              const next = Math.max(
                0,
                Math.min(ideas.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)),
              );
              setIdeaId(ideas[next]?.id ?? null);
              return;
            }
            if (event.key === 'm') {
              event.preventDefault();
              setMoveMode(true);
              return;
            }
            if (event.key === 'Escape') {
              setMoveMode(false);
              return;
            }
            if (moveMode && event.key === 'ArrowLeft') {
              event.preventDefault();
              moveTarget('quarter', -1);
              return;
            }
            if (moveMode && event.key === 'ArrowRight') {
              event.preventDefault();
              moveTarget('quarter', 1);
              return;
            }
            if (moveMode && event.key === 'ArrowUp') {
              event.preventDefault();
              moveTarget('team', -1);
              return;
            }
            if (moveMode && event.key === 'ArrowDown') {
              event.preventDefault();
              moveTarget('team', 1);
              return;
            }
            if (moveMode && event.key === 'Enter') {
              event.preventDefault();
              place();
            }
          }}
        >
          {ideas.map((idea) => (
            <button
              key={idea.id}
              type="button"
              role="option"
              aria-selected={idea.id === ideaId}
              onClick={() => setIdeaId(idea.id)}
            >
              {idea.name}
            </button>
          ))}
        </div>
      </section>

      <section className="fm-demand-flow__pipe" aria-label={t('qbr.pipe')}>
        <h2>{t('qbr.pipe')}</h2>
        {selected ? (
          <p>{t('qbr.selected', { name: selected.name })}</p>
        ) : (
          <p>{t('qbr.pipeEmpty')}</p>
        )}
        <label>
          <span>{t('qbr.units')}</span>
          <input
            type="number"
            min="1"
            value={units}
            onChange={(event) => setUnits(Number(event.target.value))}
          />
        </label>
        <fieldset>
          <legend>{t('qbr.quarters')}</legend>
          <div className="fm-demand-flow__quarters">
            {quarters.map((quarter) => (
              <button
                key={quarter}
                type="button"
                aria-pressed={quarter === quarterId}
                onClick={() => setQuarterId(quarter)}
              >
                {quarter}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t('qbr.teams')}</legend>
          <div className="fm-demand-flow__teams">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                aria-pressed={team.id === teamId}
                onClick={() => setTeamId(team.id)}
              >
                {team.name}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="fm-demand-flow__gate" aria-label={t('qbr.gate')}>
        <h2>{t('qbr.gate')}</h2>
        <p>{scenarioId === null ? t('qbr.scenarioRequired') : t('qbr.gateDescription')}</p>
        <button
          type="button"
          className="fm-primary"
          disabled={scenarioId === null || !selected || !teamId || !quarterId || units <= 0}
          onClick={place}
        >
          {t('qbr.place')}
        </button>
      </section>
      <p className="fm-visually-hidden" aria-live="polite">
        {moveMode ? `${t('qbr.moveMode')} ${targetAnnouncement}` : ''}
      </p>
    </section>
  );
}
