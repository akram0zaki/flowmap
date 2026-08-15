/**
 * The Ideas / Demand lane.
 *
 * Pinned left, outside the capacity grid. Uncommitted Ideas live only here —
 * they never occupy a team-quarter block before Commit Gate, and the only way
 * one touches the grid is as a marker from a refinement reserve.
 *
 * See docs/spec/06-views-interaction.md §3.1 and 02 §5.1.
 */

import type { IdeaModel } from '@flowmap/visual-model';

import { t } from '../i18n/t.js';

export type IdeasLaneProps = {
  readonly ideas: readonly IdeaModel[];
  readonly selectedCommitmentId: string | null;
  readonly onSelect: (commitmentId: string) => void;
};

export function IdeasLane({ ideas, selectedCommitmentId, onSelect }: IdeasLaneProps) {
  return (
    <section className="fm-ideas" aria-label={t('map.ideasLane')}>
      <div className="fm-ideas__head">
        <h2>{t('map.ideasLane')}</h2>
        <span className="fm-ideas__count">{ideas.length}</span>
      </div>

      {ideas.length === 0 ? (
        <p className="fm-idea__meta">{t('map.ideasEmpty')}</p>
      ) : (
        <ul>
          {ideas.map((idea) => (
            <li key={idea.commitmentId}>
              <button
                type="button"
                className="fm-idea"
                aria-pressed={selectedCommitmentId === idea.commitmentId}
                onClick={() => onSelect(idea.commitmentId)}
              >
                <span>
                  {idea.commitmentClass === 'MANDATORY' ? '🔒 ' : ''}
                  {idea.name}
                </span>
                {(idea.targetQuarterId !== undefined || idea.refinementLinks.length > 0) && (
                  <span className="fm-idea__meta">
                    {idea.targetQuarterId ?? ''}
                    {idea.refinementLinks.length > 0 &&
                      `${idea.targetQuarterId ? ' · ' : ''}${t('map.refinementLinked', {
                        count: idea.refinementLinks.length,
                      })}`}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
