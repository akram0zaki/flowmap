/**
 * Quick Capture and placement.
 *
 * Capture needs a title and nothing else — under five seconds, keyboard only,
 * no modal. Everything else about a commitment is added later, in context.
 *
 * See docs/spec/06-views-interaction.md §9.
 */

import { useState } from 'react';

import { useWorkspace } from '../state/workspace-store.js';
import { t } from '../i18n/t.js';

export type CaptureBarProps = {
  readonly teams: ReadonlyArray<{ id: string; name: string }>;
  readonly ideas: ReadonlyArray<{ id: string; name: string }>;
  readonly currentQuarter: string;
  readonly showList: boolean;
  readonly onToggleList: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onClearLocalData: () => void;
};

export function CaptureBar({
  teams,
  ideas,
  currentQuarter,
  showList,
  onToggleList,
  onUndo,
  onRedo,
  onClearLocalData,
}: CaptureBarProps) {
  const { captureIdea, addTeam, placeFootprint, loadSample } = useWorkspace.getState();

  const [ideaName, setIdeaName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [commitmentId, setCommitmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [size, setSize] = useState<'XS' | 'S' | 'M' | 'L'>('M');
  // Collapsed by default: the map is the product, this is scaffolding until
  // Quick Capture lands on the board itself (M2-COM-1 proper).
  const [open, setOpen] = useState(false);

  const canPlace = ideas.length > 0 && teams.length > 0;
  const resolvedCommitment = commitmentId || ideas[0]?.id || '';
  const resolvedTeam = teamId || teams[0]?.id || '';

  return (
    <>
      {/* Always reachable. Only the creation forms fold away. */}
      <div className="fm-controlbar">
        <button type="button" onClick={onUndo}>
          {t('action.undo')}
        </button>
        <button type="button" onClick={onRedo}>
          {t('action.redo')}
        </button>
        <button type="button" onClick={onToggleList} aria-pressed={showList}>
          {t('nav.listCompanion')}
        </button>
        <span className="fm-controlbar__spacer" />
        <button type="button" className="fm-quiet" onClick={() => void loadSample()}>
          {t('action.loadSample')}
        </button>
        <button type="button" className="fm-danger" onClick={onClearLocalData}>
          {t('action.clearLocalData')}
        </button>
      </div>

      <details className="fm-editor" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{t('action.edit')}</summary>
        <div className="fm-editor__body">
          <form
            className="fm-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!teamName.trim()) return;
              void addTeam(teamName.trim()).then(() => setTeamName(''));
            }}
          >
            <label htmlFor="team-name">{t('field.team')}</label>
            <input
              id="team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Payments"
            />
            <button type="submit" className="fm-quiet">
              Add team
            </button>
          </form>

          <form
            className="fm-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ideaName.trim()) return;
              void captureIdea(ideaName.trim()).then(() => setIdeaName(''));
            }}
          >
            <label htmlFor="idea-name">{t('field.ideaName')}</label>
            <input
              id="idea-name"
              value={ideaName}
              onChange={(e) => setIdeaName(e.target.value)}
              placeholder="SEPA instant payments"
            />
            <button type="submit" className="fm-primary">
              {t('action.captureIdea')}
            </button>
          </form>

          {canPlace && (
            <form
              className="fm-form"
              aria-label={t('action.assignFootprint')}
              onSubmit={(e) => {
                e.preventDefault();
                void placeFootprint({
                  commitmentId: resolvedCommitment,
                  teamId: resolvedTeam,
                  quarterId: currentQuarter,
                  size,
                });
              }}
            >
              <label htmlFor="place-commitment">{t('list.commitment')}</label>
              <select
                id="place-commitment"
                value={resolvedCommitment}
                onChange={(e) => setCommitmentId(e.target.value)}
              >
                {ideas.map((idea) => (
                  <option key={idea.id} value={idea.id}>
                    {idea.name}
                  </option>
                ))}
              </select>

              <label htmlFor="place-team">{t('field.team')}</label>
              <select
                id="place-team"
                value={resolvedTeam}
                onChange={(e) => setTeamId(e.target.value)}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>

              <label htmlFor="place-size">{t('field.size')}</label>
              <select
                id="place-size"
                value={size}
                onChange={(e) => setSize(e.target.value as 'XS' | 'S' | 'M' | 'L')}
              >
                {(['XS', 'S', 'M', 'L'] as const).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <button type="submit" className="fm-quiet">
                {t('action.place')}
              </button>
            </form>
          )}
        </div>
      </details>
    </>
  );
}
