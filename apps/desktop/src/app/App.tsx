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
  defaultDropUnits,
  findCell,
  previewDrop,
  readinessForIdeas,
  toggleFilterValue,
  type CellModel,
  type DragPayload,
  type FilterState,
  type ZoomLevel,
} from '@flowmap/visual-model';

import { useWorkspace } from '../state/workspace-store.js';
import { usePlacement, type DropTarget } from '../state/use-placement.js';
import type { QuarterId } from '@flowmap/domain';
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
  const selectedFootprintId = useWorkspace((s) => s.selectedFootprintId);
  const { undo, redo, select, clearStatus, clearLocalData, commitIdeaInto, moveFootprint } =
    useWorkspace.getState();

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

  const readiness = useMemo(
    () => (state ? readinessForIdeas(state.commitments, state.footprints) : new Map()),
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

  // ── Placing work ───────────────────────────────────────────────────────
  //
  // Dragging is not a shortcut for the form; it is the product's argument. You
  // pick work up, every container tells you what it would become, and the drop
  // is the decision. For an Idea the drop is also the Commit Gate — the gesture
  // supplies a team, a footprint, and a primary footprint, which is three of
  // the four hard blockers, so there is nothing left to fill in.

  const describeDrag = useCallback(
    (payload: DragPayload, target: DropTarget | null): string => {
      if (!board || !target) return t('drop.carrying', { name: payload.name });
      const cell = findCell(board, target.teamId, target.quarterId as QuarterId);
      if (!cell) return t('drop.carrying', { name: payload.name });

      const preview = previewDrop(cell, payload);
      if (!preview.allowed) {
        return t('drop.refusedAt', {
          team: cell.teamName,
          quarter: cell.quarterId,
          reason: preview.refusal ? t(`drop.no.${preview.refusal}`) : '',
        });
      }
      return t('drop.wouldLand', {
        name: payload.name,
        team: cell.teamName,
        quarter: cell.quarterId,
        percent: preview.percent ?? 0,
      });
    },
    [board],
  );

  const applyDrop = useCallback(
    (payload: DragPayload, target: DropTarget) => {
      if (!board) return;
      const cell = findCell(board, target.teamId, target.quarterId as QuarterId);
      // Re-check on release. The board can change under a slow drag, and the
      // preview that allowed it may no longer be the truth.
      if (!cell || !previewDrop(cell, payload).allowed) return;

      if (payload.kind === 'BLOCK') {
        void moveFootprint(payload.footprintId, {
          teamId: target.teamId,
          quarterId: target.quarterId,
        });
      } else {
        void commitIdeaInto({
          commitmentId: payload.commitmentId,
          teamId: target.teamId,
          quarterId: target.quarterId,
          units: payload.units,
        });
      }
      announce(
        t('drop.placed', { name: payload.name, team: cell.teamName, quarter: cell.quarterId }),
      );
    },
    [board, moveFootprint, commitIdeaInto, announce],
  );

  const { placement, beginPointer, beginKeyboard, aim, drop, cancel } = usePlacement({
    onDrop: applyDrop,
    onCancel: (payload) => announce(t('drop.cancelled', { name: payload.name })),
    announce,
    describe: describeDrag,
  });

  const pickUpIdea = useCallback(
    (commitmentId: string, event?: React.PointerEvent) => {
      const idea = board?.ideas.find((i) => i.commitmentId === commitmentId);
      if (!idea || !state) return;
      const payload: DragPayload = {
        kind: 'IDEA',
        commitmentId,
        name: idea.name,
        units: defaultDropUnits(state.workspace.settings.capacity.sizeMapping),
        commitmentClass: idea.commitmentClass,
        hasTargetDate: state.commitments.get(commitmentId)?.targetDate !== undefined,
      };
      if (event) beginPointer(payload, event);
      else beginKeyboard(payload);
    },
    [board, state, beginPointer, beginKeyboard],
  );

  const pickUpBlock = useCallback(
    (footprintId: string, teamId: string, quarterId: string, event?: React.PointerEvent) => {
      const block = board?.rows
        .flatMap((row) => row.cells)
        .flatMap((cell) => cell.blocks)
        .find((b) => b.footprintId === footprintId);
      if (!block) return;
      const payload: DragPayload = {
        kind: 'BLOCK',
        footprintId,
        commitmentId: block.commitmentId,
        name: block.name,
        units: block.units,
        fromTeamId: teamId,
        fromQuarterId: quarterId as never,
      };
      if (event) beginPointer(payload, event);
      else beginKeyboard(payload);
    },
    [board, beginPointer, beginKeyboard],
  );

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
      <header className="fm-header">
        <h1 className="fm-header__brand">{t('app.name')}</h1>
        <span className="fm-header__workspace">{state.workspace.name}</span>
        <span className="fm-header__spacer" />
        <div className="fm-header__status" role="status">
          {/* Pending count is sync plumbing. With no shared provider there is
              nothing for it to be pending *to*, so it is noise rather than
              status — it returns in M8 when it means something. */}
          <span aria-live="polite">{t('status.saved')}</span>
          <span>{profileName}</span>
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

      <div className="fm-controlbar">
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
      </div>

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

      <div className="fm-workspace">
        <IdeasLane
          ideas={board.ideas}
          readiness={readiness}
          selectedCommitmentId={focusedCommitmentId}
          draggingCommitmentId={placement?.payload.commitmentId ?? null}
          onSelect={(commitmentId) =>
            setFocusedCommitmentId((current) => (current === commitmentId ? null : commitmentId))
          }
          onPickUp={pickUpIdea}
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
          // Selecting a cell used to toggle filters, which quietly stacked up
          // until the board was unreadable. Until the detail panel exists
          // (M2-COM-2), selecting a cell does nothing but move the cursor.
          onSelectCell={() => undefined}
          onFilterTeam={(teamId) => setFilter((f) => toggleFilterValue(f, 'teams', teamId))}
          onFilterQuarter={(quarterId) =>
            setFilter((f) => toggleFilterValue(f, 'quarters', quarterId))
          }
          onAnnounce={announce}
          dragging={placement?.payload ?? null}
          dragTarget={placement?.target ?? null}
          onPickUpBlock={pickUpBlock}
          onAimDrag={(teamId, quarterId) => aim({ teamId, quarterId })}
          onDropHere={drop}
        />
      </div>

      {/* The piece that follows the cursor. Small and quiet — the answer is on
          the board, not under the pointer. */}
      {placement?.at && (
        <div
          className="fm-carry"
          aria-hidden="true"
          style={{ transform: `translate(${placement.at.x + 12}px, ${placement.at.y + 12}px)` }}
        >
          {placement.payload.name} · {placement.payload.units}
        </div>
      )}

      {placement?.via === 'keyboard' && (
        <div className="fm-carry fm-carry--keyboard" aria-hidden="true">
          {t('drop.keyboardHint', { name: placement.payload.name })}
          <button type="button" onClick={cancel}>
            {t('drop.cancel')}
          </button>
        </div>
      )}

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
