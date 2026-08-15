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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  allBlocks,
  isBlockFocused,
  isCellFocused,
  matchesFilter,
  type BoardModel,
  type CellModel,
  type FilterState,
  type FocusModel,
  type ZoomLevel,
} from '@flowmap/visual-model';
import { utilisationPercent, type QuarterId } from '@flowmap/domain';

import { CapacityVessel, type VesselBlock } from './CapacityVessel.jsx';
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
}: PortfolioMapProps) {
  // Roving focus: the grid is one tab stop, arrows move within it.
  const [cursor, setCursor] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const gridRef = useRef<HTMLDivElement>(null);

  const move = useCallback(
    (dRow: number, dCol: number) => {
      setCursor((prev) => {
        const row = Math.min(board.rows.length - 1, Math.max(0, prev.row + dRow));
        const col = Math.min(board.quarters.length - 1, Math.max(0, prev.col + dCol));
        const cell = board.rows[row]?.cells[col];
        if (cell) onAnnounce(describeCell(cell));
        return { row, col };
      });
    },
    [board, onAnnounce],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
          const cell = board.rows[cursor.row]?.cells[cursor.col];
          if (cell) onSelectCell(cell.teamId, cell.quarterId);
          break;
        }
        default:
          break;
      }
    },
    [board, cursor, move, onSelectCell],
  );

  // Centre the current quarter on first render, as the spec requires.
  useEffect(() => {
    const node = gridRef.current;
    if (!node || board.currentQuarterIndex < 0) return;
    const column = node.querySelector<HTMLElement>(`[data-column="${board.currentQuarterIndex}"]`);
    column?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
  }, [board.currentQuarterIndex, board.quarters.length]);

  return (
    <div className="fm-map" data-level={level}>
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
          style={{
            gridTemplateColumns: `var(--fm-row-header) repeat(${board.quarters.length}, 1fr)`,
          }}
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

                return (
                  <div
                    key={cell.key}
                    role="gridcell"
                    data-column={colIndex}
                    aria-selected={isCursor}
                    aria-label={describeCell(cell)}
                    className="fm-grid__cell"
                    data-cursor={isCursor || undefined}
                    data-dimmed={!focused || undefined}
                    data-closed={cell.closed || undefined}
                    onClick={() => {
                      setCursor({ row: rowIndex, col: colIndex });
                      onSelectCell(cell.teamId, cell.quarterId);
                    }}
                  >
                    {level === 1 ? (
                      <AggregateBar cell={cell} />
                    ) : cell.teamQuarter && cell.summary ? (
                      <CapacityVessel
                        teamName={cell.teamName}
                        teamQuarter={cell.teamQuarter}
                        summary={cell.summary}
                        blocks={vesselBlocksFor(cell)}
                        compact={level === 2}
                        dimmedFootprintIds={dimmedIds(cell, focus, filter)}
                        {...(selectedFootprintId !== null ? { selectedFootprintId } : {})}
                        onSelect={(footprintId) => {
                          const block = cell.blocks.find((b) => b.footprintId === footprintId);
                          if (block) onSelectBlock(footprintId, block.commitmentId);
                        }}
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
      </div>
    </div>
  );
}

/**
 * Level 1: one bar per cell instead of every block. Aggregate before cluttering
 * — at 20 teams × 6 quarters, drawing every block is noise, not information.
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

  return (
    <div className="fm-aggregate" data-over={over || undefined}>
      <div className="fm-aggregate__track" aria-hidden="true">
        <div className="fm-aggregate__fill" style={{ width: `${Math.min(100, percent ?? 0)}%` }} />
      </div>
      <span className="fm-aggregate__label" data-figure="">
        {percent === null ? '—' : `${percent}%`}
      </span>
      <span className="fm-aggregate__count">
        {t('map.blockCount', { count: cell.blocks.length })}
      </span>
      {over && <span className="fm-aggregate__over">▲</span>}
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

export { describeCell, allBlocks };
