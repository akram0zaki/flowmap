/**
 * Semantic zoom, focus, and filtering.
 *
 * The governing principle is "aggregate before cluttering": detail appears
 * because the user asked for it, never because the data exists.
 *
 * Thresholds are from docs/spec/06-views-interaction.md §3.3. They are also
 * reachable through an explicit Level 1/2/3 control, so zoom never requires a
 * precise pointer.
 */

import type { EntityId, QuarterId } from '@flowmap/domain';

import type { BlockModel, BoardModel, CellModel } from './layout.js';

export type ZoomLevel = 1 | 2 | 3;

export const ZOOM_THRESHOLDS = { level2: 0.6, level3: 1.4 } as const;
/**
 * The top of the range is not arbitrary: it is the zoom at which the smallest
 * footprint the size mapping allows (XS, five units) reaches a 24 px pointer
 * target. A block's height *is* its size, so that target cannot be met by
 * padding — only by being able to zoom far enough in. 2.5 was enough when a
 * column was the full width of the vessel drawing; once columns shrink to fit
 * the window it no longer is.
 */
export const ZOOM_RANGE = { min: 0.35, max: 4 } as const;

export function levelForScale(scale: number): ZoomLevel {
  if (scale < ZOOM_THRESHOLDS.level2) return 1;
  if (scale < ZOOM_THRESHOLDS.level3) return 2;
  return 3;
}

/** The scale an explicit Level control snaps to. */
export function scaleForLevel(level: ZoomLevel): number {
  switch (level) {
    case 1:
      return 0.5;
    case 2:
      return 1;
    case 3:
      return 1.6;
  }
}

export function clampScale(scale: number): number {
  return Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, scale));
}

// ── Selection and focus ────────────────────────────────────────────────────

export type Selection =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'CELL'; readonly teamId: EntityId; readonly quarterId: QuarterId }
  | { readonly kind: 'BLOCK'; readonly footprintId: EntityId; readonly commitmentId: EntityId }
  | { readonly kind: 'IDEA'; readonly commitmentId: EntityId };

export const NO_SELECTION: Selection = { kind: 'NONE' };

/**
 * What focus mode emphasises.
 *
 * Selecting a commitment relates *all* of its footprints across every team and
 * quarter — that is the point of focus, and the reason the model is keyed by
 * commitment rather than by the block that happened to be clicked.
 */
export type FocusModel = {
  readonly commitmentId: EntityId | null;
  readonly relatedFootprintIds: ReadonlySet<EntityId>;
  readonly relatedCellKeys: ReadonlySet<string>;
  readonly relatedTeamIds: ReadonlySet<EntityId>;
  readonly relatedQuarterIds: ReadonlySet<QuarterId>;
};

export const NO_FOCUS: FocusModel = {
  commitmentId: null,
  relatedFootprintIds: new Set(),
  relatedCellKeys: new Set(),
  relatedTeamIds: new Set(),
  relatedQuarterIds: new Set(),
};

export function focusOn(board: BoardModel, commitmentId: EntityId | null): FocusModel {
  if (commitmentId === null) return NO_FOCUS;

  const footprintIds = new Set<EntityId>();
  const cellKeys = new Set<string>();
  const teamIds = new Set<EntityId>();
  const quarterIds = new Set<QuarterId>();

  for (const row of board.rows) {
    for (const cell of row.cells) {
      for (const block of cell.blocks) {
        if (block.commitmentId !== commitmentId) continue;
        footprintIds.add(block.footprintId);
        cellKeys.add(cell.key);
        teamIds.add(cell.teamId);
        quarterIds.add(cell.quarterId);
      }
    }
  }

  return {
    commitmentId,
    relatedFootprintIds: footprintIds,
    relatedCellKeys: cellKeys,
    relatedTeamIds: teamIds,
    relatedQuarterIds: quarterIds,
  };
}

export function isBlockFocused(focus: FocusModel, block: BlockModel): boolean {
  return focus.commitmentId === null || focus.relatedFootprintIds.has(block.footprintId);
}

export function isCellFocused(focus: FocusModel, cell: CellModel): boolean {
  return focus.commitmentId === null || focus.relatedCellKeys.has(cell.key);
}

/**
 * A one-line summary of what focus revealed, announced to screen readers so a
 * non-sighted user learns the same thing a sighted one learns from the dimming.
 */
export function describeFocus(board: BoardModel, focus: FocusModel): string | null {
  if (focus.commitmentId === null) return null;

  const blocks = board.rows
    .flatMap((r) => r.cells)
    .flatMap((c) => c.blocks)
    .filter((b) => b.commitmentId === focus.commitmentId);

  const name = blocks[0]?.name ?? '';
  return JSON.stringify({
    name,
    footprints: blocks.length,
    teams: focus.relatedTeamIds.size,
    quarters: focus.relatedQuarterIds.size,
  });
}

// ── Filters ────────────────────────────────────────────────────────────────

export type FilterState = {
  readonly quarters: readonly QuarterId[];
  readonly teams: readonly EntityId[];
  readonly lifecycles: readonly BlockModel['lifecycle'][];
  readonly classes: readonly BlockModel['commitmentClass'][];
  readonly text: string;
  /** Fade is the default response; hiding is opt-in (spec 06 §10). */
  readonly hideFiltered: boolean;
};

export const NO_FILTER: FilterState = {
  quarters: [],
  teams: [],
  lifecycles: [],
  classes: [],
  text: '',
  hideFiltered: false,
};

export function isFilterActive(filter: FilterState): boolean {
  return (
    filter.quarters.length > 0 ||
    filter.teams.length > 0 ||
    filter.lifecycles.length > 0 ||
    filter.classes.length > 0 ||
    filter.text.trim().length > 0
  );
}

export function matchesFilter(
  filter: FilterState,
  block: BlockModel,
  cell: { teamId: EntityId; quarterId: QuarterId },
): boolean {
  if (!isFilterActive(filter)) return true;

  if (filter.quarters.length > 0 && !filter.quarters.includes(cell.quarterId)) return false;
  if (filter.teams.length > 0 && !filter.teams.includes(cell.teamId)) return false;
  if (filter.lifecycles.length > 0 && !filter.lifecycles.includes(block.lifecycle)) return false;
  if (filter.classes.length > 0 && !filter.classes.includes(block.commitmentClass)) return false;

  const text = filter.text.trim().toLowerCase();
  if (text.length > 0 && !block.name.toLowerCase().includes(text)) return false;

  return true;
}

/** Chips shown in the lens strip, so what is filtered is always visible. */
export type FilterChip = {
  readonly key: string;
  readonly labelKey: string;
  readonly value: string;
};

export function filterChips(filter: FilterState): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const q of filter.quarters)
    chips.push({ key: `quarter:${q}`, labelKey: 'filter.quarter', value: q });
  for (const t of filter.teams) chips.push({ key: `team:${t}`, labelKey: 'filter.team', value: t });
  for (const l of filter.lifecycles) {
    chips.push({ key: `lifecycle:${l}`, labelKey: 'filter.lifecycle', value: l });
  }
  for (const c of filter.classes)
    chips.push({ key: `class:${c}`, labelKey: 'filter.class', value: c });
  if (filter.text.trim()) {
    chips.push({ key: 'text', labelKey: 'filter.text', value: filter.text.trim() });
  }
  return chips;
}

export function toggleFilterValue<K extends 'quarters' | 'teams' | 'lifecycles' | 'classes'>(
  filter: FilterState,
  key: K,
  value: FilterState[K][number],
): FilterState {
  const current = filter[key] as readonly string[];
  const next = current.includes(value as string)
    ? current.filter((v) => v !== value)
    : [...current, value as string];
  return { ...filter, [key]: next } as FilterState;
}

// ── Lenses ─────────────────────────────────────────────────────────────────

export const LENSES = [
  'PORTFOLIO',
  'TEAMS',
  'PRODUCTS',
  'THEMES',
  'ATTENTION',
  'DEPENDENCIES',
  'QBR',
  'TIMELINE',
] as const;

export type LensId = (typeof LENSES)[number];

/**
 * Lenses change emphasis, never data. Switching preserves selection and
 * horizon, which is what makes them a lens rather than a separate screen.
 */
export type ViewState = {
  readonly lens: LensId;
  readonly scale: number;
  readonly level: ZoomLevel;
  readonly selection: Selection;
  readonly filter: FilterState;
};

export const INITIAL_VIEW: ViewState = {
  lens: 'PORTFOLIO',
  scale: 1,
  level: 2,
  selection: NO_SELECTION,
  filter: NO_FILTER,
};

export function setScale(view: ViewState, scale: number): ViewState {
  const clamped = clampScale(scale);
  return { ...view, scale: clamped, level: levelForScale(clamped) };
}

export function setLevel(view: ViewState, level: ZoomLevel): ViewState {
  return { ...view, scale: scaleForLevel(level), level };
}
