/**
 * The Portfolio Map.
 *
 * Quarters run left to right as columns, teams are rows, and commitment blocks
 * sit inside team-quarter containers. The Ideas/Demand lane is pinned left,
 * outside the capacity grid — Ideas never occupy a capacity block.
 *
 * Three zoom levels, per docs/spec/06-views-interaction.md §3.3:
 *   L1  team rows as aggregate bars — counts and pressure, no individual blocks
 *   L2  blocks, reserves, capacity numbers
 *   L3  everything L2 shows, plus labels and full detail
 *
 * Accessibility: the grid is a real `role="grid"` with `row` and `gridcell`,
 * navigated with arrow keys from a single tab stop. Every state carries a glyph
 * and text, never colour alone.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  allBlocks,
  arrivingUnits,
  isBlockFocused,
  isCellFocused,
  locateReveal,
  matchesFilter,
  previewDrop,
  type BoardModel,
  type BoardReveal,
  type CellModel,
  type DragPayload,
  type FilterState,
  type FocusModel,
  type ZoomLevel,
} from '@flowmap/visual-model';
import { utilisationPercent, type QuarterId } from '@flowmap/domain';

import { CapacityVessel, type VesselBlock } from './CapacityVessel.jsx';
import { DependencyLayer, type DependencyEdge } from './DependencyLayer.jsx';
import { observeResize } from '../state/observe-resize.js';
import { t } from '../i18n/t.js';

export type PortfolioMapProps = {
  readonly board: BoardModel;
  readonly level: ZoomLevel;
  readonly focus: FocusModel;
  readonly filter: FilterState;
  readonly selectedFootprintId: string | null;
  readonly vesselBlocksFor: (cell: CellModel) => VesselBlock[];
  readonly onSelectBlock: (footprintId: string, commitmentId: string) => void;
  readonly onSelectCell: (teamId: string, quarterId: QuarterId) => void;
  readonly onFilterTeam: (teamId: string) => void;
  readonly onFilterQuarter: (quarterId: QuarterId) => void;
  readonly onAnnounce: (message: string) => void;
  /** Work currently in the hand, if any — drives the drop preview. */
  readonly dragging: DragPayload | null;
  /** Where a keyboard drag is aimed. The pointer aims itself, by hit-testing. */
  readonly dragTarget:
    { kind: 'CELL'; teamId: string; quarterId: string } | { kind: 'RAIL' } | null;
  readonly onPickUpBlock: (
    footprintId: string,
    teamId: string,
    quarterId: QuarterId,
    event?: ReactPointerEvent,
  ) => void;
  readonly onAimDrag: (teamId: string, quarterId: QuarterId) => void;
  readonly onRemoveBlock: (footprintId: string, teamId: string, quarterId: QuarterId) => void;
  readonly onResizeBlock: (
    footprintId: string,
    teamId: string,
    quarterId: QuarterId,
    units: number,
    via: 'pointer' | 'keyboard',
  ) => void;
  readonly onResizeStart: (
    input: {
      footprintId: string;
      teamId: string;
      quarterId: QuarterId;
      units: number;
      unitPx: number;
    },
    event: ReactPointerEvent,
  ) => void;
  readonly resizing: { footprintId: string; units: number } | null;
  readonly onLinkFrom: (commitmentId: string, event?: ReactPointerEvent) => void;
  /** Continuous zoom. Blocks scale with it, so a thin one can be made hittable. */
  readonly scale: number;
  readonly onWheelZoom: (deltaY: number) => void;
  /** Dependencies of the focused commitment, drawn over the grid. */
  readonly dependencyEdges: readonly DependencyEdge[];
  readonly onDropHere: () => void;
  /** Dragging a block's side runs the work across more quarters, or fewer. */
  readonly onSpanStart?: (
    footprintId: string,
    teamId: string,
    quarterId: string,
    edge: 'START' | 'END',
    event: ReactPointerEvent,
  ) => void;
  /** The same reach, one quarter at a time, from the keyboard. */
  readonly onSpanStep?: (
    footprintId: string,
    teamId: string,
    quarterId: string,
    edge: 'START' | 'END',
    direction: 1 | -1,
  ) => void;
  /** Quarters the stretch in progress would add or drop, for this team row. */
  readonly spanning?: {
    readonly teamId: string;
    readonly added: readonly string[];
    readonly removed: readonly string[];
  } | null;
  /** Planner-only: move a team row up or down. Absent for anyone else. */
  readonly onMoveRow?: (teamId: string, direction: -1 | 1) => void;
  /** Archive a team. Blocked while the row still holds live footprints. */
  readonly onArchiveTeam?: (teamId: string) => void;
  readonly busyTeamIds?: ReadonlySet<string>;
  /** Names for the Ideas a refinement reserve supports, by id. */
  readonly ideaNames?: ReadonlyMap<string, string>;
  /** Radar/list Open: scroll this cell into view on both axes. */
  readonly reveal?: BoardReveal | null;
};

export function PortfolioMap({
  board,
  level,
  focus,
  filter,
  selectedFootprintId,
  vesselBlocksFor,
  onSelectBlock,
  onSelectCell,
  onFilterTeam,
  onFilterQuarter,
  onAnnounce,
  dragging,
  dragTarget,
  onPickUpBlock,
  onAimDrag,
  onRemoveBlock,
  onResizeBlock,
  onResizeStart,
  resizing,
  onLinkFrom,
  scale,
  onWheelZoom,
  dependencyEdges,
  onDropHere,
  onSpanStart,
  onSpanStep,
  spanning = null,
  onMoveRow,
  onArchiveTeam,
  busyTeamIds,
  ideaNames,
  reveal = null,
}: PortfolioMapProps) {
  // Roving focus: the grid is one tab stop, arrows move within it.
  const [cursor, setCursor] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const lastScale = useRef(scale);
  const visualAnchor = useRef<{ teamId: string; quarterId: string } | null>(null);

  const rememberVisibleCell = useCallback(() => {
    const root = gridRef.current;
    if (!root) return;
    visualAnchor.current = visibleCellAnchor(root);
  }, []);

  const move = useCallback(
    (dRow: number, dCol: number) => {
      setCursor((prev) => {
        const row = Math.min(board.rows.length - 1, Math.max(0, prev.row + dRow));
        const col = Math.min(board.quarters.length - 1, Math.max(0, prev.col + dCol));
        const cell = board.rows[row]?.cells[col];
        // While work is in the hand the cursor *is* the aim: the same arrows
        // that browse the board carry the piece, so there is nothing extra to
        // learn and no second cursor to keep track of.
        if (cell) {
          if (dragging) onAimDrag(cell.teamId, cell.quarterId);
          else onAnnounce(describeCell(cell));
        }
        return { row, col };
      });
    },
    [board, onAnnounce, dragging, onAimDrag],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Only the grid's own keys. The grid is a single tab stop, so navigation
      // events target it directly; anything bubbling up from a descendant
      // belongs to that descendant.
      //
      // Without this the grid ate Enter and Space for every control inside it:
      // `preventDefault` on a bubbled keydown cancels the button's activation,
      // so the row-reorder and header-filter buttons could be tabbed to and not
      // used. Arrow keys had the mirror problem — resizing a block also walked
      // the cursor off it.
      if (e.target !== e.currentTarget) return;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          move(0, 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          move(0, -1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          move(1, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          move(-1, 0);
          break;
        case 'Home':
          e.preventDefault();
          setCursor((p) => ({ ...p, col: 0 }));
          break;
        case 'End':
          e.preventDefault();
          setCursor((p) => ({ ...p, col: board.quarters.length - 1 }));
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          if (dragging) {
            onDropHere();
            break;
          }
          const cell = board.rows[cursor.row]?.cells[cursor.col];
          if (cell) onSelectCell(cell.teamId, cell.quarterId);
          break;
        }
        default:
          break;
      }
    },
    [board, cursor, move, onSelectCell, dragging, onDropHere],
  );

  /**
   * Zoom on Ctrl/Cmd + wheel, and on pinch — which the browser also reports as
   * a wheel event with `ctrlKey` set.
   *
   * Attached natively rather than through `onWheel` because React registers
   * wheel listeners as passive, so `preventDefault` there is ignored and the
   * *browser* zooms the whole page instead of the board. That is not a nuance;
   * it is the difference between the feature working and the page scaling.
   */
  useEffect(() => {
    const node = gridRef.current;
    if (!node) return undefined;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      onWheelZoom(event.deltaY);
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [onWheelZoom]);

  /**
   * Whether the board has anywhere left to go, and how to take it there.
   *
   * A mouse with no horizontal wheel has no way to pan a scroll container, and
   * on macOS the scrollbar is hidden until something moves — so without this
   * the far quarters were simply unreachable with the most common input device
   * in the building.
   */
  const [pan, setPan] = useState({ left: false, right: false });

  const measurePan = useCallback(() => {
    const node = gridRef.current;
    if (!node) return;
    setPan({
      left: node.scrollLeft > 1,
      right: node.scrollLeft + node.clientWidth < node.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const node = gridRef.current;
    if (!node) return undefined;
    measurePan();

    const unobserve = observeResize(node, measurePan);
    node.addEventListener('scroll', measurePan);
    return () => {
      unobserve();
      node.removeEventListener('scroll', measurePan);
    };
  }, [measurePan, board.quarters.length, level]);

  /** One column at a time, so the step matches the unit the board is made of. */
  const step = useCallback((direction: -1 | 1) => {
    const node = gridRef.current;
    if (!node) return;
    const column = node.querySelector<HTMLElement>('[data-column="1"]');
    const width = column?.getBoundingClientRect().width ?? node.clientWidth / 3;
    node.scrollBy({ left: direction * width, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    rememberVisibleCell();
    const node = gridRef.current;
    if (!node) return undefined;
    const onScroll = () => rememberVisibleCell();
    node.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
    };
  }, [rememberVisibleCell, board.rows.length]);

  // After a level change the board's height jumps. Keep the cell that was in
  // the middle of the window there — a scroll-ratio on the map scroller
  // cannot, because the page itself is what moved.
  useLayoutEffect(() => {
    if (lastScale.current === scale) return;
    lastScale.current = scale;
    const anchor = visualAnchor.current;
    if (!anchor) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(
      `[data-drop-team="${CSS.escape(anchor.teamId)}"][data-drop-quarter="${CSS.escape(anchor.quarterId)}"]`,
    );
    cell?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    requestAnimationFrame(rememberVisibleCell);
  }, [scale, rememberVisibleCell]);

  // Centre the current quarter on first render, as the spec requires.
  useEffect(() => {
    const node = gridRef.current;
    if (!node || board.currentQuarterIndex < 0) return;
    const column = node.querySelector<HTMLElement>(`[data-column="${board.currentQuarterIndex}"]`);
    column?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
  }, [board.currentQuarterIndex, board.quarters.length]);

  // Open must land on the cell, not just its quarter. The column header is
  // only X; the team row is Y. Wait a frame so a just-closed Radar has
  // given the board its width back.
  useEffect(() => {
    if (!reveal) return;
    const at = locateReveal(board, reveal);
    if (!at) return;
    setCursor(at);
    const scroller = gridRef.current;
    if (!scroller) return;
    const motion =
      document.documentElement.getAttribute('data-motion') === 'reduced' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
    const frame = requestAnimationFrame(() => {
      const cell = scroller.querySelector<HTMLElement>(
        `[data-drop-team="${CSS.escape(board.rows[at.row]?.teamId ?? '')}"][data-drop-quarter="${CSS.escape(board.rows[at.row]?.cells[at.col]?.quarterId ?? '')}"]`,
      );
      cell?.scrollIntoView({ inline: 'center', block: 'center', behavior: motion });
    });
    return () => cancelAnimationFrame(frame);
  }, [board, reveal]);

  return (
    <div className="fm-map" data-level={level}>
      {(pan.left || pan.right) && (
        <div className="fm-steps" role="group" aria-label={t('map.pan')}>
          <button
            type="button"
            disabled={!pan.left}
            aria-label={t('map.panEarlier')}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            disabled={!pan.right}
            aria-label={t('map.panLater')}
            onClick={() => step(1)}
          >
            ›
          </button>
        </div>
      )}

      <div className="fm-map__scroll" ref={gridRef}>
        <div
          role="grid"
          aria-label={t('map.label', {
            teams: board.rows.length,
            quarters: board.quarters.length,
          })}
          aria-rowcount={board.rows.length + 1}
          aria-colcount={board.quarters.length + 1}
          className="fm-grid"
          tabIndex={0}
          onKeyDown={onKeyDown}
          style={
            {
              gridTemplateColumns: `var(--fm-row-header) repeat(${board.quarters.length}, 1fr)`,
              // Zoom magnifies both axes. Growing only the block heights made
              // zooming feel useless on a narrow screen: the labels were what
              // you could not read, and they never got any more room.
              '--fm-zoom': scale,
            } as CSSProperties
          }
        >
          <div role="row" className="fm-grid__head" style={{ display: 'contents' }}>
            <div role="columnheader" className="fm-grid__corner">
              {t('map.team')}
            </div>
            {board.quarters.map((quarterId, index) => (
              <div
                key={quarterId}
                role="columnheader"
                data-column={index}
                data-current={quarterId === board.currentQuarterId || undefined}
                className="fm-grid__quarter"
              >
                {/* A header is the obvious place to narrow to one quarter. */}
                <button
                  type="button"
                  className="fm-grid__filter"
                  aria-pressed={filter.quarters.includes(quarterId)}
                  onClick={() => onFilterQuarter(quarterId)}
                >
                  {quarterId}
                  {quarterId === board.currentQuarterId && (
                    <span className="fm-grid__now"> · {t('map.now')}</span>
                  )}
                </button>
              </div>
            ))}
          </div>

          {board.rows.map((row, rowIndex) => (
            <div key={row.teamId} role="row" style={{ display: 'contents' }}>
              <div
                role="rowheader"
                className="fm-grid__team"
                data-dimmed={
                  (focus.commitmentId !== null && !focus.relatedTeamIds.has(row.teamId)) ||
                  undefined
                }
              >
                <button
                  type="button"
                  className="fm-grid__filter fm-grid__team-name"
                  aria-pressed={filter.teams.includes(row.teamId)}
                  onClick={() => onFilterTeam(row.teamId)}
                >
                  {row.teamName}
                </button>

                {/* The Planner's order, changed where the order is visible.
                    Two buttons rather than a drag: a drag needs a keyboard
                    equivalent anyway, and for a handful of rows the buttons
                    *are* the better interaction, not the fallback. */}
                {onMoveRow && (
                  <span className="fm-grid__reorder" role="group" aria-label={t('map.rowOrder')}>
                    <button
                      type="button"
                      disabled={rowIndex === 0}
                      aria-label={t('map.moveRowUp', { team: row.teamName })}
                      onClick={() => onMoveRow(row.teamId, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={rowIndex === board.rows.length - 1}
                      aria-label={t('map.moveRowDown', { team: row.teamName })}
                      onClick={() => onMoveRow(row.teamId, 1)}
                    >
                      ↓
                    </button>
                  </span>
                )}
                {onArchiveTeam && (
                  <button
                    type="button"
                    className="fm-quiet fm-grid__archive"
                    disabled={busyTeamIds?.has(row.teamId) === true}
                    aria-label={
                      busyTeamIds?.has(row.teamId) === true
                        ? t('team.archiveBlocked', { team: row.teamName })
                        : t('map.archiveTeam', { team: row.teamName })
                    }
                    onClick={() => onArchiveTeam(row.teamId)}
                  >
                    {t('action.archive')}
                  </button>
                )}
                <span className="fm-grid__team-meta" data-figure="">
                  {row.capacity === 0
                    ? '—'
                    : t('map.rowUtilisation', {
                        percent: Math.round((row.load / row.capacity) * 100),
                      })}
                </span>
                {row.overflowingCells > 0 && (
                  <span className="fm-grid__team-over">
                    {t('map.rowOverflow', { count: row.overflowingCells })}
                  </span>
                )}
              </div>

              {row.cells.map((cell, colIndex) => {
                const focused = isCellFocused(focus, cell);
                const isCursor = cursor.row === rowIndex && cursor.col === colIndex;

                // Every container answers the question during the drag, not
                // after it: what would this become, and would it take this.
                const preview = dragging ? previewDrop(cell, dragging) : null;
                const aimedHere =
                  dragTarget?.kind === 'CELL' &&
                  dragTarget.teamId === cell.teamId &&
                  dragTarget.quarterId === cell.quarterId;

                return (
                  <div
                    key={cell.key}
                    role="gridcell"
                    data-column={colIndex}
                    data-drop-team={cell.teamId}
                    data-drop-quarter={cell.quarterId}
                    aria-selected={isCursor}
                    aria-label={describeCell(cell)}
                    className="fm-grid__cell"
                    data-cursor={isCursor || undefined}
                    data-dimmed={!focused || undefined}
                    data-closed={cell.closed || undefined}
                    data-drop={aimedHere ? (preview?.allowed ? 'ok' : 'no') : undefined}
                    // What a stretch in progress would do to this container:
                    // the reach is drawn on the cells it reaches, not on the
                    // block, because the consequence is theirs.
                    data-span={
                      spanning?.teamId === cell.teamId
                        ? spanning.added.includes(cell.quarterId)
                          ? 'add'
                          : spanning.removed.includes(cell.quarterId)
                            ? 'remove'
                            : undefined
                        : undefined
                    }
                    onClick={() => {
                      setCursor({ row: rowIndex, col: colIndex });
                      onSelectCell(cell.teamId, cell.quarterId);
                    }}
                  >
                    {/* The reason arrives before the commitment does. */}
                    {aimedHere && preview && !preview.allowed && preview.refusal && (
                      <span className="fm-drop__refusal">{t(`drop.no.${preview.refusal}`)}</span>
                    )}
                    {/* Never reassign ownership quietly. An empty cell has no
                        vessel to draw the incoming band on, so the figure the
                        drop would open the quarter at lives here too. */}
                    {aimedHere && preview?.allowed && (!cell.summary || preview.reassignsOwner) && (
                      <span className="fm-drop__note">
                        {[
                          !cell.summary
                            ? preview.percent === null
                              ? t('capacity.noDeliverable')
                              : preview.overflow > 0
                                ? t('capacity.overBy', { units: preview.overflow })
                                : t('drop.wouldOpen', { percent: preview.percent })
                            : null,
                          preview.reassignsOwner
                            ? t('drop.reassigns', { team: cell.teamName })
                            : null,
                        ]
                          .filter((part): part is string => part !== null)
                          .join(' · ')}
                      </span>
                    )}
                    {level === 1 ? (
                      <AggregateBar cell={cell} />
                    ) : cell.teamQuarter && cell.summary ? (
                      <CapacityVessel
                        teamName={cell.teamName}
                        teamQuarter={cell.teamQuarter}
                        summary={cell.summary}
                        blocks={vesselBlocksFor(cell)}
                        compact={level === 2}
                        zoom={scale}
                        dimmedFootprintIds={dimmedIds(cell, focus, filter)}
                        {...(ideaNames ? { ideaNames } : {})}
                        {...(focus.commitmentId !== null
                          ? { focusedMilestoneIds: focus.relatedMilestoneIds }
                          : {})}
                        {...(selectedFootprintId !== null ? { selectedFootprintId } : {})}
                        {...(aimedHere && preview
                          ? {
                              incoming: {
                                // Not `dragging.units`: an addition arrives at
                                // its own size, and the ghost has to be the
                                // block the figure below it was computed from.
                                units: dragging ? arrivingUnits(dragging) : 0,
                                allowed: preview.allowed,
                                percent: preview.percent,
                                overflow: preview.overflow,
                              },
                            }
                          : {})}
                        onSelect={(footprintId) => {
                          const block = cell.blocks.find((b) => b.footprintId === footprintId);
                          if (block) onSelectBlock(footprintId, block.commitmentId);
                        }}
                        onPickUp={(footprintId: string, event?: ReactPointerEvent) =>
                          onPickUpBlock(footprintId, cell.teamId, cell.quarterId, event)
                        }
                        {...(onSpanStep
                          ? {
                              onSpanStep: (
                                footprintId: string,
                                edge: 'START' | 'END',
                                direction: 1 | -1,
                              ) =>
                                onSpanStep(
                                  footprintId,
                                  cell.teamId,
                                  cell.quarterId,
                                  edge,
                                  direction,
                                ),
                            }
                          : {})}
                        {...(onSpanStart
                          ? {
                              onSpanStart: (
                                footprintId: string,
                                edge: 'START' | 'END',
                                event: ReactPointerEvent,
                              ) =>
                                onSpanStart(footprintId, cell.teamId, cell.quarterId, edge, event),
                            }
                          : {})}
                        onRemove={(footprintId: string) =>
                          onRemoveBlock(footprintId, cell.teamId, cell.quarterId)
                        }
                        onLink={onLinkFrom}
                        onResize={(footprintId, units, via) =>
                          onResizeBlock(footprintId, cell.teamId, cell.quarterId, units, via)
                        }
                        onResizeStart={(footprintId, event, unitPx) => {
                          const block = cell.blocks.find((b) => b.footprintId === footprintId);
                          if (!block) return;
                          onResizeStart(
                            {
                              footprintId,
                              teamId: cell.teamId,
                              quarterId: cell.quarterId,
                              units: block.units,
                              unitPx,
                            },
                            event,
                          );
                        }}
                        {...(resizing?.footprintId !== undefined &&
                        cell.blocks.some((b) => b.footprintId === resizing.footprintId)
                          ? { resizing }
                          : {})}
                      />
                    ) : (
                      <span className="fm-grid__empty" aria-hidden="true">
                        —
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <DependencyLayer edges={dependencyEdges} scrollRef={gridRef} />
      </div>
    </div>
  );
}

/**
 * Level 1: one bar per cell instead of every block. Aggregate before cluttering
 * — at 20 teams × 6 quarters, drawing every block is noise, not information.
 *
 * Aggregating is not the same as flattening. A cell at 90% made of work that
 * cannot move is a different problem from one at 90% of work that can, and a
 * single grey bar says they are the same. So the bar is split at the point where
 * choice ends: mandatory load in the heavy tone, discretionary load in the light
 * one, and anything past the capacity rule drawn beyond it rather than clipped.
 */
function AggregateBar({ cell }: { cell: CellModel }) {
  const summary = cell.summary;
  if (!summary)
    return (
      <span className="fm-grid__empty" aria-hidden="true">
        —
      </span>
    );

  const percent = utilisationPercent(summary);
  const over = summary.overflow > 0;
  const { signals } = cell;

  // The bar's own scale. At 121% the rule sits at 83% of the track, so the
  // excess is drawn past the limit instead of pinned to it.
  const axisMax = Math.max(100, percent ?? 0);
  const share = (units: number) =>
    summary.deliverableCapacity > 0
      ? (units / summary.deliverableCapacity) * (100 / axisMax) * 100
      : 0;

  const fixed = Math.min(signals.mandatoryUnits, summary.committedLoad);
  const movable = Math.max(0, summary.committedLoad - fixed);

  // What the bar cannot say on its own: which kind of load dominates, and how
  // much of it arrived rather than was chosen this quarter.
  const notes = [
    t('map.blockCount', { count: signals.commitmentCount }),
    signals.mandatoryUnits > 0 ? t('signal.fixed', { units: signals.mandatoryUnits }) : null,
    signals.carriedUnits > 0 ? t('signal.carried', { units: signals.carriedUnits }) : null,
  ].filter((note): note is string => note !== null);

  return (
    <div className="fm-aggregate" data-over={over || undefined}>
      <div className="fm-aggregate__figure">
        <span className="fm-aggregate__label">{percent === null ? '—' : `${percent}%`}</span>
        {/* The glyph lives in the string — `capacity.overBy` already carries it. */}
        {over && (
          <span className="fm-aggregate__over">
            {t('capacity.overBy', { units: summary.overflow })}
          </span>
        )}
      </div>

      <div
        className="fm-aggregate__track"
        aria-hidden="true"
        style={{ '--fm-rule-at': `${100 / axisMax}` } as CSSProperties}
      >
        <div
          className="fm-aggregate__fill fm-aggregate__fill--fixed"
          style={{ width: `${share(fixed)}%` }}
        />
        <div
          className="fm-aggregate__fill fm-aggregate__fill--movable"
          style={{ width: `${share(movable)}%` }}
        />
        {over && <div className="fm-aggregate__excess" />}
      </div>

      <span className="fm-aggregate__count">{notes.join(' · ')}</span>
    </div>
  );
}

/** Blocks that are out of focus or filtered out — faded, never removed. */
function dimmedIds(cell: CellModel, focus: FocusModel, filter: FilterState): ReadonlySet<string> {
  const dimmed = new Set<string>();
  for (const block of cell.blocks) {
    const inFocus = isBlockFocused(focus, block);
    const inFilter = matchesFilter(filter, block, cell);
    if (!inFocus || !inFilter) dimmed.add(block.footprintId);
  }
  return dimmed;
}

/**
 * What a screen reader hears when the cursor lands on a cell. Says the same
 * thing the vessel shows: who, when, how full, and whether it fits.
 */
function describeCell(cell: CellModel): string {
  if (!cell.summary) {
    return t('map.cellEmpty', { team: cell.teamName, quarter: cell.quarterId });
  }

  const percent = utilisationPercent(cell.summary);
  const parts = [
    cell.teamName,
    cell.quarterId,
    percent === null ? t('capacity.noDeliverable') : t('capacity.utilisation', { percent }),
    cell.summary.overflow > 0
      ? t('capacity.overCapacity', { units: cell.summary.overflow, percent: percent ?? 0 })
      : t('capacity.headroom', { units: cell.summary.headroom }),
    t('map.blockCount', { count: cell.blocks.length }),
  ];
  if (cell.closed) parts.push(t('map.cellClosed'));
  return parts.join('. ');
}

/** The team-quarter closest to the viewport centre among cells on screen. */
export function visibleCellAnchor(
  root: ParentNode,
  viewport: { readonly width: number; readonly height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): { readonly teamId: string; readonly quarterId: string } | null {
  const midX = viewport.width / 2;
  const midY = viewport.height / 2;
  let best: { teamId: string; quarterId: string; dist: number } | null = null;
  for (const node of root.querySelectorAll<HTMLElement>(
    '.fm-grid__cell[data-drop-team][data-drop-quarter]',
  )) {
    const box = node.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= viewport.height) continue;
    const teamId = node.dataset['dropTeam'];
    const quarterId = node.dataset['dropQuarter'];
    if (!teamId || !quarterId) continue;
    const dx = box.left + box.width / 2 - midX;
    const dy = box.top + box.height / 2 - midY;
    const dist = dx * dx + dy * dy;
    if (!best || dist < best.dist) best = { teamId, quarterId, dist };
  }
  return best ? { teamId: best.teamId, quarterId: best.quarterId } : null;
}

export { describeCell, allBlocks };
