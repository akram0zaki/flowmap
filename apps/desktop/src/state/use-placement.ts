/**
 * Picking work up and putting it down.
 *
 * One state machine drives both routes into the same place:
 *
 *   pointer   press and move past a threshold → hover a container → release
 *   keyboard  Enter/Space on a block or Idea  → arrow keys        → Enter
 *
 * They are not two features. A pointer drag that a keyboard cannot perform is
 * an inaccessible product, and a keyboard path bolted on afterwards always
 * disagrees with the pointer one about what a drop means. Here both end at
 * `drop()`, and the rules they consult are the same pure `previewDrop`.
 *
 * The threshold matters: a press that never moves is a click, which selects.
 * Without it, every attempt to select a block would start a drag.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragPayload } from '@flowmap/visual-model';

export type DropTarget = { readonly teamId: string; readonly quarterId: string };

export type PlacementState = {
  readonly payload: DragPayload;
  /** How the drag was started; decides whether a pointer or the arrows aim it. */
  readonly via: 'pointer' | 'keyboard';
  /** Where the drop would land right now, or null while over nothing. */
  readonly target: DropTarget | null;
  /** Viewport position of the pointer, for the piece that follows it. */
  readonly at: { x: number; y: number } | null;
};

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

export type UsePlacementOptions = {
  readonly onDrop: (payload: DragPayload, target: DropTarget) => void;
  readonly onCancel?: (payload: DragPayload) => void;
  /** Announced on every meaningful change, for the live region. */
  readonly announce: (message: string) => void;
  readonly describe: (payload: DragPayload, target: DropTarget | null) => string;
};

export function usePlacement({ onDrop, onCancel, announce, describe }: UsePlacementOptions) {
  const [placement, setPlacement] = useState<PlacementState | null>(null);

  // A press that has not yet travelled far enough to be a drag. Kept in a ref
  // because it changes on every pointer move and must not re-render anything.
  const armed = useRef<{ payload: DragPayload; x: number; y: number; pointerId: number } | null>(
    null,
  );

  // Mirrors `placement` so the window listeners and the drop can read the
  // current value without the effect re-subscribing on every pointer move.
  const placementRef = useRef<PlacementState | null>(null);
  placementRef.current = placement;

  const cancel = useCallback(() => {
    armed.current = null;
    const current = placementRef.current;
    setPlacement(null);
    if (current) onCancel?.(current.payload);
  }, [onCancel]);

  /** Which container is under a point. The DOM is the authority on hit areas. */
  const targetAt = useCallback((x: number, y: number): DropTarget | null => {
    const cell = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-drop-team][data-drop-quarter]');
    if (!cell) return null;
    const teamId = cell.dataset['dropTeam'];
    const quarterId = cell.dataset['dropQuarter'];
    return teamId && quarterId ? { teamId, quarterId } : null;
  }, []);

  const beginPointer = useCallback((payload: DragPayload, event: React.PointerEvent) => {
    // Left button only, and never on a modified click — those are the browser's.
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    armed.current = {
      payload,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  }, []);

  const beginKeyboard = useCallback(
    (payload: DragPayload) => {
      const state: PlacementState = { payload, via: 'keyboard', target: null, at: null };
      setPlacement(state);
      announce(describe(payload, null));
    },
    [announce, describe],
  );

  /** Aim the keyboard drag. Returns true when the event was consumed. */
  const aim = useCallback(
    (target: DropTarget) => {
      setPlacement((current) => {
        if (!current || current.via !== 'keyboard') return current;
        announce(describe(current.payload, target));
        return { ...current, target };
      });
    },
    [announce, describe],
  );

  // The drop runs outside the state updater. React invokes updaters twice in
  // development to surface impurity, and a dispatch in there is exactly that —
  // it ran the whole placement twice, and the second attempt failed on the
  // duplicate the first had just created.
  const drop = useCallback(() => {
    const current = placementRef.current;
    setPlacement(null);
    if (current?.target) onDrop(current.payload, current.target);
  }, [onDrop]);

  // Held in a ref so the window listeners can mount once. Re-subscribing on
  // every pointer move would be wasteful, and gating the effect on `armed`
  // silently did not work at all: a ref does not re-run an effect, so the
  // listeners were never attached by the press that needed them.
  const latest = useRef({ targetAt, onDrop, cancel, announce, describe });
  latest.current = { targetAt, onDrop, cancel, announce, describe };

  // On the window rather than the element: a drag that leaves the block it
  // started on must keep tracking, and a release outside the board must still
  // end it rather than leaving a piece stuck to the cursor.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const start = armed.current;
      if (start) {
        const far =
          Math.abs(event.clientX - start.x) > DRAG_THRESHOLD_PX ||
          Math.abs(event.clientY - start.y) > DRAG_THRESHOLD_PX;
        if (!far) return;
        armed.current = null;
        const target = latest.current.targetAt(event.clientX, event.clientY);
        setPlacement({
          payload: start.payload,
          via: 'pointer',
          target,
          at: { x: event.clientX, y: event.clientY },
        });
        return;
      }

      setPlacement((current) => {
        if (!current || current.via !== 'pointer') return current;
        const target = latest.current.targetAt(event.clientX, event.clientY);
        const changed =
          target?.teamId !== current.target?.teamId ||
          target?.quarterId !== current.target?.quarterId;
        if (changed && target)
          latest.current.announce(latest.current.describe(current.payload, target));
        return { ...current, target, at: { x: event.clientX, y: event.clientY } };
      });
    };

    const onUp = () => {
      if (armed.current) {
        armed.current = null;
        return;
      }
      const current = placementRef.current;
      if (!current || current.via !== 'pointer') return;
      setPlacement(null);
      if (current.target) latest.current.onDrop(current.payload, current.target);
    };

    // Escape cancels from anywhere. A drag you cannot abandon is a trap.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') latest.current.cancel();
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

  return { placement, beginPointer, beginKeyboard, aim, drop, cancel };
}
