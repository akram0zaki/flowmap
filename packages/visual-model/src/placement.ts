/**
 * What a drop would do, worked out before the pointer is released.
 *
 * This is the part of Flowmap that is not a project-management tool. You do not
 * fill in a form and then discover the quarter is full; you pick work up, and
 * every container you pass over tells you what it would become — the figure it
 * would show, whether it would breach the rule, and by how much. The decision
 * happens during the gesture, not after it.
 *
 * Pure on purpose. The same functions answer the pointer path, the keyboard
 * path, and the tests, so those three cannot drift apart. No DOM, no store.
 *
 * See docs/spec/06-views-interaction.md §5 and §3.1.1 (one commitment across
 * several teams), and 04-capacity-model.md §7.
 */

import type {
  CapacitySummary,
  CapacityUnits,
  Commitment,
  EntityId,
  QuarterId,
} from '@flowmap/domain';
import { utilisationPercent, withCommittedLoad } from '@flowmap/domain';

import type { CellModel } from './layout.js';

/** What is in the hand. */
export type DragPayload =
  | {
      /**
       * Drawing a dependency. The gesture is the same as moving work — pick up,
       * pass over, release — because a dependency is a statement about two
       * pieces of work and pointing at both of them is how you make it.
       */
      readonly kind: 'LINK';
      readonly commitmentId: EntityId;
      readonly name: string;
      readonly units: CapacityUnits;
    }
  | {
      readonly kind: 'IDEA';
      readonly commitmentId: EntityId;
      readonly name: string;
      readonly units: CapacityUnits;
      /** Mandatory work without a target date cannot pass the gate on drop. */
      readonly commitmentClass: Commitment['class'];
      readonly hasTargetDate: boolean;
      /** Who owns it now. A drop onto another team reassigns it. */
      readonly primaryTeamId?: EntityId;
    }
  | {
      readonly kind: 'BLOCK';
      readonly footprintId: EntityId;
      readonly commitmentId: EntityId;
      readonly name: string;
      readonly units: CapacityUnits;
      readonly fromTeamId: EntityId;
      readonly fromQuarterId: QuarterId;
      /** Decides whether taking it off the board can send it back to the rail. */
      readonly lifecycle: Commitment['lifecycle'];
      /** Active footprints this commitment holds, including this one. */
      readonly footprintCount: number;
      /** A settled quarter cannot be edited, so it cannot be unplaced from. */
      readonly fromClosed: boolean;
      /**
       * What a drop on another container does with the placement in hand.
       *
       * Most demand is picked up by more than one team — an epic worked by
       * three squads is the ordinary case, not the exception — and a board that
       * can only move a placement forces that shape to be a lie. So the plain
       * drag **adds**: the team you drop on also picks the work up, and the one
       * you dragged from keeps what it had. Alt moves it instead, for the
       * reschedule and the correction.
       *
       * Ownership is untouched either way. The lead team is
       * `commitment.primaryTeamId` and the added footprint is never primary —
       * accountability stays where it was put.
       */
      readonly intent: 'ADD' | 'MOVE';
      /**
       * Units a second placement would take. A move carries `units` with it;
       * an addition starts at the same default an Idea lands at, because how
       * much of the work the second team takes is a new question and not one
       * the first team's number answers.
       */
      readonly addUnits: CapacityUnits;
    };

/**
 * Why a drop is refused. Each maps to a message key and is shown on the
 * container being hovered, so the reason arrives before the commitment does.
 *
 * Over capacity is deliberately absent: overflow never blocks. Flowmap's whole
 * argument is that you are allowed to overload a team as long as you can see
 * that you did.
 */
export type DropRefusal =
  | 'LINK_NEEDS_WORK'
  | 'LINK_TO_ITSELF'
  | 'NOT_MATERIALISED'
  | 'CLOSED_QUARTER'
  | 'ALREADY_HERE'
  | 'DUPLICATE_FOOTPRINT'
  | 'MANDATORY_NEEDS_TARGET_DATE';

export type DropPreview = {
  readonly allowed: boolean;
  readonly refusal?: DropRefusal;
  /** Load the container would carry after the drop. */
  readonly committedLoad: number;
  /** Utilisation after the drop; null when there is no deliverable capacity. */
  readonly percent: number | null;
  /** Units past the rule after the drop. 0 when it still fits. */
  readonly overflow: number;
  /** Change in utilisation points. Null when either side is undefined. */
  readonly percentDelta: number | null;
  /** True when a drop that fits today would not fit after. */
  readonly tipsOver: boolean;
  /**
   * The drop would move ownership to this container's team.
   *
   * Dropping work on a row says that team does it, and the Commit Gate insists
   * the primary footprint sits on the primary team — so the gesture reassigns.
   * It is stated rather than done quietly, because a lead dragging an Idea to
   * see whether it fits should not silently hand it to someone else.
   */
  readonly reassignsOwner: boolean;
};

/**
 * How many units a drop would actually put into a container.
 *
 * Exported because the board draws a ghost of the arriving block and must use
 * the same number the figure was computed from. It did not, once: an addition
 * drew the source block's size while the percentage underneath counted the
 * addition's, and the two disagreed on screen.
 */
export function arrivingUnits(payload: DragPayload): CapacityUnits {
  if (payload.kind === 'LINK') return 0;
  return payload.kind === 'BLOCK' && payload.intent === 'ADD' ? payload.addUnits : payload.units;
}

/**
 * The state of the drop, for one candidate container.
 *
 * Called for every visible cell on every pointer move, so it stays arithmetic —
 * no allocation of a projected board, no re-layout.
 */
export function previewDrop(
  cell: CellModel,
  payload: DragPayload,
  /**
   * The block under the pointer, when there is one. Dropping a block onto
   * another **in its own container** is not a move that goes nowhere — it is a
   * reorder, which is how you choose what sits above the capacity rule.
   */
  over?: EntityId,
): DropPreview {
  const summary = cell.summary ?? summaryFromSeed(cell);

  // A container that does not exist yet is not a refusal in the domain — the
  // store materialises it on drop. The cell carries the seed `EnsureTeamQuarter`
  // would apply, so the gesture can still say what the quarter would become.
  // A cell with neither a summary nor a seed cannot answer that question.
  if (!summary) {
    return {
      allowed: false,
      refusal: 'NOT_MATERIALISED',
      committedLoad: 0,
      percent: null,
      overflow: 0,
      percentDelta: null,
      tipsOver: false,
      reassignsOwner: false,
    };
  }

  const movingWithin =
    payload.kind === 'BLOCK' &&
    payload.fromTeamId === cell.teamId &&
    payload.fromQuarterId === cell.quarterId;

  // A dependency changes nothing about capacity — it is a statement, not a
  // placement — so the figures must not move while one is being drawn.
  const arriving = movingWithin ? 0 : arrivingUnits(payload);
  const projected = withCommittedLoad(summary, summary.committedLoad + arriving);

  const percentBefore = utilisationPercent(summary);
  const percent = utilisationPercent(projected);
  const { committedLoad, overflow } = projected;

  const base = {
    committedLoad,
    percent,
    overflow,
    percentDelta: percent !== null && percentBefore !== null ? percent - percentBefore : null,
    tipsOver: summary.overflow === 0 && overflow > 0,
    reassignsOwner:
      payload.kind === 'IDEA' &&
      payload.primaryTeamId !== undefined &&
      payload.primaryTeamId !== cell.teamId,
  };

  const refusal = refuse(cell, payload, movingWithin, over);
  return refusal ? { allowed: false, refusal, ...base } : { allowed: true, ...base };
}

function refuse(
  cell: CellModel,
  payload: DragPayload,
  movingWithin: boolean,
  over?: EntityId,
): DropRefusal | undefined {
  // A dependency points at work. A container is not work, and work cannot
  // depend on itself.
  if (payload.kind === 'LINK') {
    const target = cell.blocks.find((block) => block.commitmentId !== payload.commitmentId);
    if (cell.blocks.some((block) => block.commitmentId === payload.commitmentId) && !target) {
      return 'LINK_TO_ITSELF';
    }
    return target ? undefined : 'LINK_NEEDS_WORK';
  }

  if (cell.closed) return 'CLOSED_QUARTER';
  if (movingWithin) {
    // Onto another block in the same container: a reorder, and the only way to
    // say which work is the work that will not fit.
    const onAnother =
      payload.kind === 'BLOCK' &&
      over !== undefined &&
      cell.blocks.some(
        (block) => block.commitmentId === over && block.footprintId !== payload.footprintId,
      );
    return onAnother ? undefined : 'ALREADY_HERE';
  }

  // One commitment cannot hold two footprints in the same container — the
  // domain refuses it, so the drag must too rather than failing on release.
  const occupied = cell.blocks.some((block) => block.commitmentId === payload.commitmentId);
  if (occupied) return 'DUPLICATE_FOOTPRINT';

  // Dropping an Idea takes it through the Commit Gate, because an Idea may not
  // hold a capacity block on the near side of that gate. The drop itself
  // supplies the three placement blockers — a team, a footprint, and a primary
  // footprint on that team — which leaves exactly one that it cannot.
  if (
    payload.kind === 'IDEA' &&
    payload.commitmentClass === 'MANDATORY' &&
    !payload.hasTargetDate
  ) {
    return 'MANDATORY_NEEDS_TARGET_DATE';
  }

  return undefined;
}

/**
 * Empty cells still have a capacity figure: the seed `EnsureTeamQuarter` would
 * write. Load is zero because no footprints exist until the drop lands.
 */
function summaryFromSeed(cell: CellModel): CapacitySummary | null {
  const seed = cell.seed;
  if (!seed) return null;
  return {
    teamId: cell.teamId,
    quarterId: cell.quarterId,
    effectiveCapacity: seed.effectiveCapacity,
    reservedTotal: seed.reservedTotal,
    deliverableCapacity: seed.deliverableCapacity,
    committedLoad: 0,
    headroom: seed.deliverableCapacity,
    overflow: 0,
    utilisation: seed.deliverableCapacity === 0 ? null : 0,
  };
}

/**
 * The size an Idea arrives at when nothing has said otherwise.
 *
 * An Idea carries no size — it has no footprint, by invariant — so the drop has
 * to choose one. Half of M is the smallest amount that still visibly moves the
 * figure, which is the point: you drop it, you see it land, you resize it.
 */
/**
 * Resizing a block: the same question as a drop, asked about one that is
 * already there.
 *
 * Units are the only thing a footprint has that anyone argues about, so it has
 * to be adjustable where you can see the consequence — on the block itself,
 * against the rule. The figure updates as the edge moves; overflow is allowed
 * and drawn, never blocked.
 */
export type ResizePreview = {
  readonly allowed: boolean;
  readonly refusal?: 'CLOSED_QUARTER';
  readonly units: number;
  readonly percent: number | null;
  readonly overflow: number;
};

/** Units are whole and at least one — a footprint of nothing is a deletion. */
export function clampUnits(units: number): number {
  return Math.max(1, Math.round(units));
}

export function previewResize(
  cell: CellModel,
  footprintId: EntityId,
  units: number,
): ResizePreview {
  const wanted = clampUnits(units);
  const block = cell.blocks.find((b) => b.footprintId === footprintId);
  const { summary } = cell;

  if (!summary || !block) {
    return { allowed: false, units: wanted, percent: null, overflow: 0 };
  }
  if (cell.closed) {
    return {
      allowed: false,
      refusal: 'CLOSED_QUARTER',
      units: wanted,
      percent: null,
      overflow: summary.overflow,
    };
  }

  // Only counted blocks move the figure; resizing an ON_HOLD block changes what
  // it will cost when it resumes, not what the quarter carries today.
  const delta = block.counted ? wanted - block.units : 0;
  const projected = withCommittedLoad(summary, summary.committedLoad + delta);

  return {
    allowed: true,
    units: wanted,
    percent: utilisationPercent(projected),
    overflow: projected.overflow,
  };
}

/** Why work cannot be taken off the board here. */
export type RemovalRefusal = 'IDEA_NOT_PLACED' | 'NOT_REVERTIBLE' | 'FROM_CLOSED_QUARTER';

export type RemovalPreview = {
  readonly allowed: boolean;
  readonly refusal?: RemovalRefusal;
  /**
   * True when this is the commitment's last placement, so taking it off the
   * board returns it to the demand lane rather than merely unplacing it.
   */
  readonly returnsToRail: boolean;
  readonly units: number;
};

/**
 * What dropping work back on the Ideas rail would do.
 *
 * The inverse of placing it, and deliberately not a delete: work you take off
 * the board goes back to being demand, where it can be placed again. Nothing
 * here removes a commitment — dropping work for good is `DropCommitment`, a
 * different decision with a different record.
 */
export function previewRemoval(payload: DragPayload): RemovalPreview {
  if (payload.kind !== 'BLOCK') {
    // An Idea is already in the lane; there is nothing to take off the board.
    return { allowed: false, refusal: 'IDEA_NOT_PLACED', returnsToRail: false, units: 0 };
  }

  // The domain refuses to edit a settled quarter, so the gesture must too —
  // otherwise the drag promises something the command will then decline.
  if (payload.fromClosed) {
    return {
      allowed: false,
      refusal: 'FROM_CLOSED_QUARTER',
      returnsToRail: false,
      units: payload.units,
    };
  }

  const last = payload.footprintCount <= 1;

  /*
   * Dropped work has no gate left to revert and no delivery to record. The
   * decision is held on the commitment, and taking its placement off the board
   * does not touch that — so there is nothing to protect by refusing.
   *
   * Refusing it was a dead end: `DROPPED` has no transition out of it, and
   * neither the drag nor Delete would remove a last footprint, so the block sat
   * in its cell for good under a message advising the reader to drop something
   * they had already dropped.
   *
   * `DONE` is terminal too and is deliberately *not* included. Completed work
   * on the board is the record of what a team delivered that quarter; removing
   * it changes what the quarter says it shipped, which is a different decision
   * from tidying away work nobody is going to do.
   */
  const dropped = payload.lifecycle === 'DROPPED';

  // Only COMMITTED work can go back through the gate. Work in delivery, on
  // hold, or done has a history that unplacing would quietly rewrite.
  if (last && !dropped && payload.lifecycle !== 'COMMITTED') {
    return {
      allowed: false,
      refusal: 'NOT_REVERTIBLE',
      returnsToRail: false,
      units: payload.units,
    };
  }

  // Dropped work is unplaced, never returned: the lane is for demand, and a
  // decision not to do something is not demand.
  return { allowed: true, returnsToRail: last && !dropped, units: payload.units };
}

export function defaultDropUnits(sizeMapping: Readonly<Record<string, number>>): CapacityUnits {
  return sizeMapping['S'] ?? sizeMapping['M'] ?? 10;
}
