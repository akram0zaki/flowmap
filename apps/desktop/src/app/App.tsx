/**
 * The M1 walking skeleton, on screen.
 *
 * One board with real capacity vessels, a list companion whose totals must match
 * them exactly, and the create → place → persist → reload loop. Deliberately
 * small: M2 replaces this board with the real Portfolio Map.
 */

import { useEffect, useMemo, useState } from 'react';
import { isCounted, summariseCapacity, type CapacitySummary } from '@flowmap/domain';

import { useWorkspace } from '../state/workspace-store.js';
import { CapacityVessel, type VesselBlock } from '../components/CapacityVessel.jsx';
import { ListCompanion } from '../components/ListCompanion.jsx';
import { t } from '../i18n/t.js';

export function App() {
  const state = useWorkspace((s) => s.state);
  const status = useWorkspace((s) => s.status);
  const profileName = useWorkspace((s) => s.profileName);
  const pendingCount = useWorkspace((s) => s.pendingCount);
  const selected = useWorkspace((s) => s.selectedFootprintId);
  const { captureIdea, addTeam, placeFootprint, undo, redo, select, clearStatus, clearLocalData } =
    useWorkspace.getState();

  const [ideaName, setIdeaName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [showList, setShowList] = useState(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      }
      if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setShowList((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const cells = useMemo(() => buildCells(state), [state]);

  if (!state) {
    return (
      <main className="fm-shell">
        <p className="fm-empty">Loading workspace…</p>
      </main>
    );
  }

  const teams = [...state.teams.values()].filter((team) => team.archivedAt === undefined);
  const ideas = [...state.commitments.values()].filter((c) => c.archivedAt === undefined);

  return (
    <div className="fm-shell">
      <header className="fm-topbar">
        <h1 className="fm-brand">
          {t('app.name')} <span className="fm-brand__tagline">{t('app.tagline')}</span>
        </h1>
        <div className="fm-topbar__status" role="status">
          <span>{t('status.local')}</span>
          <span aria-live="polite">
            {pendingCount > 0 ? t('status.pending', { count: pendingCount }) : t('status.saved')}
          </span>
          <span>{t('status.profile', { name: profileName })}</span>
        </div>
      </header>

      {status && (
        <div
          className={`fm-banner fm-banner--${status.tone}`}
          role={status.tone === 'critical' ? 'alert' : 'status'}
        >
          <span>{status.message}</span>
          <button type="button" onClick={clearStatus}>
            Dismiss
          </button>
        </div>
      )}

      <section className="fm-controls" aria-label="Capture">
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
          <button type="submit">Add team</button>
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
          <button type="submit">{t('action.captureIdea')}</button>
        </form>

        <div className="fm-form">
          <button type="button" onClick={() => void undo()}>
            {t('action.undo')}
          </button>
          <button type="button" onClick={() => void redo()}>
            {t('action.redo')}
          </button>
          <button type="button" onClick={() => setShowList((v) => !v)} aria-pressed={showList}>
            {t('nav.listCompanion')}
          </button>
          <button type="button" className="fm-danger" onClick={() => void clearLocalData()}>
            {t('action.clearLocalData')}
          </button>
        </div>
      </section>

      {ideas.length > 0 && teams.length > 0 && (
        <PlaceForm
          teams={teams.map((team) => ({ id: team.id, name: team.name }))}
          ideas={ideas.map((c) => ({ id: c.id, name: c.name }))}
          currentQuarter={state.workspace.currentQuarterId}
          onPlace={placeFootprint}
        />
      )}

      <main className="fm-board" aria-label={t('nav.portfolio')}>
        {cells.length === 0 ? (
          <div className="fm-empty">
            <h2>{t('empty.board.title')}</h2>
            <p>{t('empty.board.body')}</p>
          </div>
        ) : (
          cells.map((cell) => (
            <CapacityVessel
              key={cell.teamQuarter.id}
              teamName={cell.teamName}
              teamQuarter={cell.teamQuarter}
              summary={cell.summary}
              blocks={cell.blocks}
              {...(selected !== null ? { selectedFootprintId: selected } : {})}
              onSelect={select}
            />
          ))
        )}
      </main>

      {showList && <ListCompanion cells={cells} />}
    </div>
  );
}

export type Cell = {
  teamName: string;
  teamQuarter: NonNullable<ReturnType<typeof buildCells>>[number]['teamQuarter'];
  summary: CapacitySummary;
  blocks: VesselBlock[];
};

function buildCells(state: ReturnType<typeof useWorkspace.getState>['state']) {
  if (!state) return [];

  const footprints = [...state.footprints.values()].filter((f) => f.archivedAt === undefined);

  return [...state.teamQuarters.values()]
    .filter((tq) => tq.archivedAt === undefined)
    .map((teamQuarter) => {
      const team = state.teams.get(teamQuarter.teamId);
      const blocks: VesselBlock[] = footprints
        .filter((f) => f.teamId === teamQuarter.teamId && f.quarterId === teamQuarter.quarterId)
        .map((footprint) => {
          const commitment = state.commitments.get(footprint.commitmentId)!;
          return {
            footprint,
            commitment,
            counted: isCounted(footprint, commitment, state.workspace.currentQuarterId),
          };
        })
        // Mandatory first, then largest — the same order the map uses.
        .sort((a, b) => {
          const mandatory =
            Number(b.commitment.class === 'MANDATORY') - Number(a.commitment.class === 'MANDATORY');
          return mandatory !== 0 ? mandatory : b.footprint.units - a.footprint.units;
        });

      return {
        teamName: team?.name ?? '—',
        teamQuarter,
        summary: summariseCapacity({
          teamQuarter,
          footprints,
          commitmentsById: state.commitments,
          currentQuarterId: state.workspace.currentQuarterId,
        }),
        blocks,
      };
    })
    .sort((a, b) =>
      a.teamName === b.teamName
        ? a.teamQuarter.quarterId.localeCompare(b.teamQuarter.quarterId)
        : a.teamName.localeCompare(b.teamName),
    );
}

function PlaceForm({
  teams,
  ideas,
  currentQuarter,
  onPlace,
}: {
  teams: Array<{ id: string; name: string }>;
  ideas: Array<{ id: string; name: string }>;
  currentQuarter: string;
  onPlace: ReturnType<typeof useWorkspace.getState>['placeFootprint'];
}) {
  const [commitmentId, setCommitmentId] = useState(ideas[0]?.id ?? '');
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [size, setSize] = useState<'XS' | 'S' | 'M' | 'L'>('M');

  return (
    <form
      className="fm-controls fm-form"
      aria-label={t('action.assignFootprint')}
      onSubmit={(e) => {
        e.preventDefault();
        if (!commitmentId || !teamId) return;
        void onPlace({ commitmentId, teamId, quarterId: currentQuarter, size });
      }}
    >
      <label htmlFor="place-commitment">{t('list.commitment')}</label>
      <select
        id="place-commitment"
        value={commitmentId}
        onChange={(e) => setCommitmentId(e.target.value)}
      >
        {ideas.map((idea) => (
          <option key={idea.id} value={idea.id}>
            {idea.name}
          </option>
        ))}
      </select>

      <label htmlFor="place-team">{t('field.team')}</label>
      <select id="place-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
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

      <button type="submit">{t('action.place')}</button>
    </form>
  );
}
