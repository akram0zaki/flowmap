/**
 * The Portfolio Map, on screen.
 *
 * Quarters as columns, teams as rows, the Ideas lane pinned left, three zoom
 * levels, focus mode, and filter chips — with a list companion whose totals must
 * equal the projection exactly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isCounted } from '@flowmap/domain';
import {
  buildBoard,
  focusOn,
  NO_FILTER,
  NO_FOCUS,
  toggleFilterValue,
  type CellModel,
  type FilterState,
  type ZoomLevel,
} from '@flowmap/visual-model';

import { useWorkspace } from '../state/workspace-store.js';
import { PortfolioMap } from '../components/PortfolioMap.jsx';
import { LensStrip } from '../components/LensStrip.jsx';
import { IdeasLane } from '../components/IdeasLane.jsx';
import { ListCompanion } from '../components/ListCompanion.jsx';
import { CaptureBar } from '../components/CaptureBar.jsx';
import type { VesselBlock } from '../components/CapacityVessel.jsx';
import { t } from '../i18n/t.js';

export function App() {
  const state = useWorkspace((s) => s.state);
  const status = useWorkspace((s) => s.status);
  const profileName = useWorkspace((s) => s.profileName);
  const pendingCount = useWorkspace((s) => s.pendingCount);
  const selectedFootprintId = useWorkspace((s) => s.selectedFootprintId);
  const { undo, redo, select, clearStatus, clearLocalData } = useWorkspace.getState();

  const [level, setLevelState] = useState<ZoomLevel>(2);
  const [filter, setFilter] = useState<FilterState>(NO_FILTER);
  const [focusedCommitmentId, setFocusedCommitmentId] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);
  const [announcement, setAnnouncement] = useState('');

  // Announcements are debounced through a ref so rapid arrow-key movement does
  // not queue a dozen utterances.
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((message: string) => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnouncement(message), 120);
  }, []);

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
      if (e.key === 'Escape') {
        setFocusedCommitmentId(null);
        select(null);
      }
      if (!mod && ['1', '2', '3'].includes(e.key) && e.target === document.body) {
        setLevelState(Number(e.key) as ZoomLevel);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, select]);

  const board = useMemo(
    () =>
      state
        ? buildBoard({
            workspace: state.workspace,
            teams: state.teams,
            teamQuarters: state.teamQuarters,
            commitments: state.commitments,
            footprints: state.footprints,
          })
        : null,
    [state],
  );

  const focus = useMemo(
    () => (board ? focusOn(board, focusedCommitmentId) : NO_FOCUS),
    [board, focusedCommitmentId],
  );

  const focusedName = useMemo(() => {
    if (!board || focusedCommitmentId === null) return null;
    return (
      board.rows
        .flatMap((r) => r.cells)
        .flatMap((c) => c.blocks)
        .find((b) => b.commitmentId === focusedCommitmentId)?.name ??
      board.ideas.find((i) => i.commitmentId === focusedCommitmentId)?.name ??
      null
    );
  }, [board, focusedCommitmentId]);

  const vesselBlocksFor = useCallback(
    (cell: CellModel): VesselBlock[] => {
      if (!state) return [];
      return cell.blocks.flatMap((block) => {
        const footprint = state.footprints.get(block.footprintId);
        const commitment = state.commitments.get(block.commitmentId);
        if (!footprint || !commitment) return [];
        return [
          {
            footprint,
            commitment,
            counted: isCounted(footprint, commitment, state.workspace.currentQuarterId),
          },
        ];
      });
    },
    [state],
  );

  if (!state || !board) {
    return (
      <main className="fm-shell">
        <p className="fm-empty">Loading workspace…</p>
      </main>
    );
  }

  const teams = [...state.teams.values()].filter((team) => team.archivedAt === undefined);
  const ideas = [...state.commitments.values()].filter(
    (c) => c.archivedAt === undefined && c.lifecycle === 'IDEA',
  );

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

      <CaptureBar
        teams={teams.map((team) => ({ id: team.id, name: team.name }))}
        ideas={ideas.map((c) => ({ id: c.id, name: c.name }))}
        currentQuarter={state.workspace.currentQuarterId}
        showList={showList}
        onToggleList={() => setShowList((v) => !v)}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        onClearLocalData={() => void clearLocalData()}
      />

      <LensStrip
        level={level}
        filter={filter}
        focusedName={focusedName}
        onLevel={setLevelState}
        onRemoveChip={(key) => setFilter((f) => removeChip(f, key))}
        onClearFilters={() => setFilter(NO_FILTER)}
        onToggleHide={() => setFilter((f) => ({ ...f, hideFiltered: !f.hideFiltered }))}
        onClearFocus={() => setFocusedCommitmentId(null)}
      />

      <div className="fm-workspace">
        <IdeasLane
          ideas={board.ideas}
          selectedCommitmentId={focusedCommitmentId}
          onSelect={(commitmentId) =>
            setFocusedCommitmentId((current) => (current === commitmentId ? null : commitmentId))
          }
        />

        <PortfolioMap
          board={board}
          level={level}
          focus={focus}
          filter={filter}
          selectedFootprintId={selectedFootprintId}
          vesselBlocksFor={vesselBlocksFor}
          onSelectBlock={(footprintId, commitmentId) => {
            select(footprintId);
            setFocusedCommitmentId((current) => (current === commitmentId ? null : commitmentId));
          }}
          onSelectCell={(teamId, quarterId) =>
            setFilter((f) =>
              toggleFilterValue(toggleFilterValue(f, 'teams', teamId), 'quarters', quarterId),
            )
          }
          onAnnounce={announce}
        />
      </div>

      {/* Capacity consequences reach a non-sighted user the moment they happen. */}
      <div className="fm-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      {showList && <ListCompanion board={board} filter={filter} />}
    </div>
  );
}

function removeChip(filter: FilterState, key: string): FilterState {
  const [kind, ...rest] = key.split(':');
  const value = rest.join(':');

  switch (kind) {
    case 'quarter':
      return toggleFilterValue(filter, 'quarters', value as FilterState['quarters'][number]);
    case 'team':
      return toggleFilterValue(filter, 'teams', value);
    case 'lifecycle':
      return toggleFilterValue(filter, 'lifecycles', value as FilterState['lifecycles'][number]);
    case 'class':
      return toggleFilterValue(filter, 'classes', value as FilterState['classes'][number]);
    case 'text':
      return { ...filter, text: '' };
    default:
      return filter;
  }
}
