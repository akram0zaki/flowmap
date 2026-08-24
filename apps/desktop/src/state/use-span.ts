/**
 * Dragging a block's side to run the work across more quarters, or fewer.
 *
 * Same architecture as `usePlacement` and `useResize`, for the same reason: the
 * gesture lives in a ref every handler writes synchronously, and React state
 * mirrors it only so the board can draw what the release would do. A fast drag
 * releases before React has committed, and a state-led version reads a stale
 * value and does nothing.
 *
 * Unlike a resize, this one is not measured in pixels. What matters is which
 * quarter column the pointer is over, and the DOM is the authority on that —
 * the same hit test the drag-and-drop path uses, so a stretch and a move cannot
 * disagree about where a column ends.
 *
 * The commit happens once, on release. A command per column crossed would fill
 * the undo stack with the journey instead of the destination.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpanEdge } from '@flowmap/visual-model';

export type SpanState = {
  readonly footprintId: string;
  readonly commitmentId: string;
  readonly name: string;
  readonly teamId: string;
  readonly quarterId: string;
  readonly units: number;
  readonly edge: SpanEdge;
  /** The quarter the pointer is over now; the anchor's own until it moves. */
  readonly toQuarterId: string;
};

export type UseSpanOptions = {
  readonly onCommit: (state: SpanState) => void;
  readonly onCancel?: (state: SpanState) => void;
  /** Announced when the reach changes, for the live region. */
  readonly describe: (state: SpanState) => string;
  readonly announce: (message: string) => void;
};

/** Which team-quarter is under a point. The DOM owns the hit areas. */
function quarterAt(x: number, y: number): { teamId: string; quarterId: string } | null {
  const under = document.elementFromPoint(x, y);
  const cell = under?.closest<HTMLElement>('[data-drop-team][data-drop-quarter]');
  const teamId = cell?.dataset['dropTeam'];
  const quarterId = cell?.dataset['dropQuarter'];
  return teamId && quarterId ? { teamId, quarterId } : null;
}

export function useSpan({ onCommit, onCancel, describe, announce }: UseSpanOptions) {
  const drag = useRef<SpanState | null>(null);
  const [spanning, setSpanning] = useState<SpanState | null>(null);

  const set = useCallback((next: SpanState | null) => {
    const previous = drag.current;
    drag.current = next;
    // Re-render only when the reach changes. Everything else about this gesture
    // is the cursor moving inside a column it is already in.
    if (previous && next && previous.toQuarterId === next.toQuarterId) return;
    setSpanning(next);
  }, []);

  const latest = useRef({ onCommit, onCancel, describe, announce, set });
  latest.current = { onCommit, onCancel, describe, announce, set };

  const begin = useCallback(
    (input: Omit<SpanState, 'toQuarterId'>, event: React.PointerEvent) => {
      if (event.button !== 0) return;
      // Or the browser starts selecting the SVG text under the grip, and a
      // selection drag cancels the gesture halfway across the board.
      event.preventDefault();
      event.stopPropagation();
      set({ ...input, toQuarterId: input.quarterId });
    },
    [set],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current) return;

      const at = quarterAt(event.clientX, event.clientY);
      // Only along its own row. Wandering into another team's row is a move,
      // which is a different gesture, and reading it as a stretch would put
      // this work on a team nobody chose.
      if (!at || at.teamId !== current.teamId || at.quarterId === current.toQuarterId) return;

      const next = { ...current, toQuarterId: at.quarterId };
      latest.current.set(next);
      latest.current.announce(latest.current.describe(next));
    };

    const onUp = () => {
      const current = drag.current;
      latest.current.set(null);
      if (current) latest.current.onCommit(current);
    };

    const onCancelEvent = () => {
      const current = drag.current;
      latest.current.set(null);
      if (current) latest.current.onCancel?.(current);
    };

    // Escape abandons it. A gesture you cannot back out of is a trap.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) onCancelEvent();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelEvent);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancelEvent);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return { spanning, begin };
}
