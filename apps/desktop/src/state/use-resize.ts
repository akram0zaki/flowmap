/**
 * Dragging a block's top edge to change how much of a quarter it takes.
 *
 * Same architecture as `usePlacement`, for the same reason: the gesture lives
 * in a ref that every handler writes synchronously, and React state mirrors it
 * only so the vessel can draw the provisional size. Pointer input is
 * synchronous; a fast drag releases before React has committed, and a state-led
 * version would read a stale value and do nothing.
 *
 * The commit happens on release, once, rather than on every move — a resize is
 * one decision, and a command per pixel would fill the undo stack with the
 * journey instead of the destination.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ResizeState = {
  readonly footprintId: string;
  readonly teamId: string;
  readonly quarterId: string;
  /** Where the block started, so movement is measured from a fixed point. */
  readonly startUnits: number;
  readonly units: number;
};

export type UseResizeOptions = {
  readonly onCommit: (state: ResizeState) => void;
  readonly onPreview: (state: ResizeState) => void;
  readonly onCancel?: () => void;
};

export function useResize({ onCommit, onPreview, onCancel }: UseResizeOptions) {
  const drag = useRef<ResizeState | null>(null);
  const origin = useRef<{ y: number; unitPx: number } | null>(null);
  const [resizing, setResizing] = useState<ResizeState | null>(null);

  const set = useCallback((next: ResizeState | null) => {
    drag.current = next;
    setResizing(next);
  }, []);

  const latest = useRef({ onCommit, onPreview, onCancel, set });
  latest.current = { onCommit, onPreview, onCancel, set };

  const begin = useCallback(
    (
      input: {
        footprintId: string;
        teamId: string;
        quarterId: string;
        units: number;
        unitPx: number;
      },
      event: React.PointerEvent,
    ) => {
      if (event.button !== 0) return;
      // Without this the browser starts selecting the SVG text under the grip.
      event.preventDefault();
      origin.current = { y: event.clientY, unitPx: input.unitPx };
      set({
        footprintId: input.footprintId,
        teamId: input.teamId,
        quarterId: input.quarterId,
        startUnits: input.units,
        units: input.units,
      });
    },
    [set],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      const start = origin.current;
      if (!current || !start || start.unitPx <= 0) return;

      // Up is bigger: the block grows towards the rule, the way the drawing
      // reads. The SVG is scaled to fit its cell, so `unitPx` comes from the
      // element that knows the scale rather than being assumed here.
      const units = Math.max(
        1,
        Math.round(current.startUnits + (start.y - event.clientY) / start.unitPx),
      );
      if (units === current.units) return;

      const next = { ...current, units };
      latest.current.set(next);
      latest.current.onPreview(next);
    };

    const onUp = () => {
      const current = drag.current;
      origin.current = null;
      latest.current.set(null);
      // A grip press that never moved is not a resize.
      if (current && current.units !== current.startUnits) latest.current.onCommit(current);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      origin.current = null;
      latest.current.set(null);
      latest.current.onCancel?.();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return { resizing, begin };
}
