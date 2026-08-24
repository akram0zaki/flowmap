/**
 * Stretching work across quarters by dragging the side of a block.
 *
 * A commitment "spans" quarters when the same team carries it in consecutive
 * ones. Nothing in the model had to change for that — footprint uniqueness is
 * (commitment, team, quarter), so consecutive footprints have always been legal
 * and the board has always drawn them. What was missing was a way to say it in
 * one gesture, at the place where the consequence is already drawn.
 *
 * A footprint means "this team spends this much of THIS quarter on this work",
 * so extending copies the amount rather than dividing it: work that genuinely
 * runs for two quarters consumes both. Dragging wider therefore costs more, and
 * every cell it reaches redraws while the pointer is still down — which is the
 * point, and the reason this is not a form.
 *
 * Pure, like the rest of the visual model: the pointer path and the keyboard
 * path ask the same function, so they cannot come to different answers.
 *
 * See docs/spec/06-views-interaction.md §3.1.3 and 02-capacity-model.md §5.1.
 */

import type { EntityId, QuarterId } from '@flowmap/domain';

import type { BoardModel, CellModel } from './layout.js';

/** Which edge of the block is being dragged. */
export type SpanEdge = 'START' | 'END';

export type SpanDrag = {
  readonly footprintId: EntityId;
  readonly commitmentId: EntityId;
  readonly name: string;
  readonly teamId: EntityId;
  /** The quarter of the block that was grabbed; the span always contains it. */
  readonly quarterId: QuarterId;
  /** Units each quarter the span reaches will carry. */
  readonly units: number;
  readonly edge: SpanEdge;
};

/** Why a stretch is refused. Each maps to a message shown on the container. */
export type SpanRefusal = 'CLOSED_QUARTER' | 'NOT_MATERIALISED' | 'OUTSIDE_HORIZON';

export type SpanPreview = {
  readonly allowed: boolean;
  readonly refusal?: SpanRefusal;
  /** Quarters the work would newly occupy, in board order. */
  readonly added: readonly QuarterId[];
  /** Quarters it would stop occupying, in board order. */
  readonly removed: readonly QuarterId[];
  /** Every quarter the span would cover afterwards, including the anchor. */
  readonly covered: readonly QuarterId[];
  /** Units the change would add to the team's load across the horizon. */
  readonly unitsDelta: number;
};

const NOTHING: SpanPreview = {
  allowed: false,
  added: [],
  removed: [],
  covered: [],
  unitsDelta: 0,
};

/** The cells of one team row, in board order. */
function rowOf(board: BoardModel, teamId: EntityId): readonly CellModel[] {
  return board.rows.find((row) => row.teamId === teamId)?.cells ?? [];
}

/**
 * The quarters this commitment already occupies on this team, as an unbroken
 * run containing the anchor.
 *
 * Unbroken on purpose: a footprint three quarters away with a gap in between is
 * a separate placement, not the far end of this span, and dragging an edge must
 * not silently adopt it.
 */
export function spanOf(
  board: BoardModel,
  teamId: EntityId,
  commitmentId: EntityId,
  anchor: QuarterId,
): readonly QuarterId[] {
  const cells = rowOf(board, teamId);
  const at = cells.findIndex((cell) => cell.quarterId === anchor);
  if (at === -1) return [];

  const holds = (cell: CellModel): boolean =>
    cell.blocks.some((block) => block.commitmentId === commitmentId);

  let first = at;
  while (first > 0 && holds(cells[first - 1]!)) first -= 1;
  let last = at;
  while (last < cells.length - 1 && holds(cells[last + 1]!)) last += 1;

  return cells.slice(first, last + 1).map((cell) => cell.quarterId);
}

/**
 * What dragging the edge as far as `to` would do.
 *
 * Called for every pointer move, so it stays list arithmetic over one team row.
 */
export function previewSpan(board: BoardModel, drag: SpanDrag, to: QuarterId): SpanPreview {
  const cells = rowOf(board, drag.teamId);
  const index = (quarterId: QuarterId): number =>
    cells.findIndex((cell) => cell.quarterId === quarterId);

  const anchorAt = index(drag.quarterId);
  const toAt = index(to);
  // Dragging past the edge of the drawn horizon is not a refusal to explain, it
  // is simply nowhere: there is no container there to occupy.
  if (anchorAt === -1 || toAt === -1) return { ...NOTHING, refusal: 'OUTSIDE_HORIZON' };

  const current = spanOf(board, drag.teamId, drag.commitmentId, drag.quarterId);
  const from = index(current[0]!);
  const until = index(current[current.length - 1]!);

  /*
   * The edge belongs to the span, not to the block that carries it — which is
   * why only the first and last block of a run offer one. Dragging the end
   * inwards shortens the run; the other end stays put, and the clamp is against
   * *that* end, so the span can never turn inside out or empty itself.
   *
   * Retracting to nothing would be unplacing the work: a different decision,
   * with a different record, made by dragging it to the rail.
   */
  const [first, last] =
    drag.edge === 'END' ? [from, Math.max(toAt, from)] : [Math.min(toAt, until), until];

  const covered = cells.slice(first, last + 1).map((cell) => cell.quarterId);
  const added = covered.filter((quarterId) => !current.includes(quarterId));
  const removed = current.filter((quarterId) => !covered.includes(quarterId));

  const cellAt = (quarterId: QuarterId): CellModel | undefined =>
    cells.find((cell) => cell.quarterId === quarterId);

  // A settled quarter is history at either end: it cannot be occupied, and work
  // already recorded in it cannot be taken out.
  for (const quarterId of [...added, ...removed]) {
    if (cellAt(quarterId)?.closed) {
      return { ...NOTHING, refusal: 'CLOSED_QUARTER', added, removed, covered };
    }
  }

  // An unmaterialised container is not a refusal in the domain — the drop
  // creates it — but one with neither a summary nor a seed cannot say what it
  // would become, and a stretch that cannot state its consequence is a guess.
  for (const quarterId of added) {
    const cell = cellAt(quarterId);
    if (cell && !cell.summary && !cell.seed) {
      return { ...NOTHING, refusal: 'NOT_MATERIALISED', added, removed, covered };
    }
  }

  return {
    allowed: added.length > 0 || removed.length > 0,
    added,
    removed,
    covered,
    unitsDelta: (added.length - removed.length) * drag.units,
  };
}
