/**
 * Picking work up and putting it down.
 *
 * One state machine drives both routes into the same place:
 *
 *   pointer   press and move past a threshold → hover a container → release
 *   keyboard  Space on a block or Idea        → arrow keys        → Enter
 *
 * They are not two features. A pointer drag that a keyboard cannot perform is
 * an inaccessible product, and a keyboard path bolted on afterwards always
 * disagrees with the pointer one about what a drop means. Here both end at the
 * same `finish`, and the rules they consult are the same pure `previewDrop`.
 *
 * **The drag lives in a ref, not in React state.** This is the whole design and
 * it was learned the hard way: with the state as the authority, a fast drag
 * would produce one `pointermove` and then `pointerup` in the same frame, React
 * would not have committed the render that set it, and the release would read
 * `null` — no drop, and a carry chip stuck to the cursor with no way to shake
 * it off. Pointer input is synchronous and its state has to be too. React state
 * mirrors the ref purely so the preview can render.
 *
 * The move threshold matters as well: a press that never travels is a click,
 * which selects. Without it, every attempt to select a block starts a drag.
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
};

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

/** Pixels per frame when holding a drag against the edge of the board. */
const EDGE_SCROLL_PX = 14;

export type UsePlacementOptions = {
  readonly onDrop: (payload: DragPayload, target: DropTarget) => void;
  readonly onCancel?: (payload: DragPayload) => void;
  /** Announced on every meaningful change, for the live region. */
  readonly announce: (message: string) => void;
  readonly describe: (payload: DragPayload, target: DropTarget | null) => string;
};

export function usePlacement({ onDrop, onCancel, announce, describe }: UsePlacementOptions) {
  // The authority. Written synchronously by every handler.
  const drag = useRef<PlacementState | null>(null);
  // The mirror. Exists only so the preview renders — and it deliberately does
  // NOT carry the pointer position. Putting the cursor in React state re-rendered
  // all thirty capacity vessels on every pointermove, which locked the main
  // thread solid: the drag looked like it did nothing because the board could
  // not repaint. The chip that follows the cursor is moved by writing to its
  // style directly, sixty times a second, touching no component at all.
  const [placement, setPlacement] = useState<PlacementState | null>(null);
  const carryRef = useRef<HTMLDivElement | null>(null);

  /** A press that has not yet travelled far enough to count as a drag. */
  const armed = useRef<{ payload: DragPayload; x: number; y: number } | null>(null);

  /**
   * Writes the ref always; re-renders only when something a component draws has
   * actually changed. Everything else about a drag is the cursor moving.
   */
  const set = useCallback((next: PlacementState | null) => {
    const previous = drag.current;
    drag.current = next;

    const sameTarget =
      previous?.target?.teamId === next?.target?.teamId &&
      previous?.target?.quarterId === next?.target?.quarterId;
    if (previous && next && previous.payload === next.payload && sameTarget) return;

    setPlacement(next);
  }, []);

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

  const cancel = useCallback(() => {
    armed.current = null;
    const current = drag.current;
    set(null);
    if (current) onCancel?.(current.payload);
  }, [set, onCancel]);

  const beginPointer = useCallback((payload: DragPayload, event: React.PointerEvent) => {
    // Left button only, and never on a modified click — those are the browser's.
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    // Stops the browser from starting a text selection or a native image drag
    // out of the element being picked up, both of which cancel the gesture.
    event.preventDefault();
    armed.current = { payload, x: event.clientX, y: event.clientY };
  }, []);

  const beginKeyboard = useCallback(
    (payload: DragPayload) => {
      set({ payload, via: 'keyboard', target: null });
      announce(describe(payload, null));
    },
    [set, announce, describe],
  );

  const aim = useCallback(
    (target: DropTarget) => {
      const current = drag.current;
      if (!current || current.via !== 'keyboard') return;
      set({ ...current, target });
      announce(describe(current.payload, target));
    },
    [set, announce, describe],
  );

  // The drop runs after the state is cleared, never inside a state updater:
  // React invokes updaters twice in development to surface impurity, and a
  // dispatch in one is exactly that — it ran the whole placement twice, and the
  // second attempt failed on the duplicate the first had just created.
  const finish = useCallback(() => {
    const current = drag.current;
    set(null);
    if (current?.target) onDrop(current.payload, current.target);
  }, [set, onDrop]);

  // Held in a ref so the window listeners mount once. Re-subscribing on every
  // pointer move would be wasteful, and gating the effect on a ref silently did
  // not work at all — a ref does not re-run an effect, so the listeners were
  // never attached by the press that needed them.
  const latest = useRef({ targetAt, onDrop, cancel, announce, describe, set });
  latest.current = { targetAt, onDrop, cancel, announce, describe, set };

  // On the window rather than the element: a drag that leaves the block it
  // started on must keep tracking, and a release outside the board must still
  // end it rather than leaving a piece stuck to the cursor.
  useEffect(() => {
    const moveCarry = (x: number, y: number) => {
      const node = carryRef.current;
      if (node) node.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    };

    // The horizon is wider than the window, and a hit test can only see what is
    // on screen: without this, the last two quarters are simply unreachable by
    // pointer. Holding near an edge scrolls the board towards it.
    let edgeTimer: ReturnType<typeof setInterval> | null = null;
    const stopEdgeScroll = () => {
      if (edgeTimer !== null) clearInterval(edgeTimer);
      edgeTimer = null;
      document.querySelector('.fm-map__scroll')?.removeAttribute('data-dragging');
    };
    const edgeScroll = (x: number) => {
      const scroller = document.querySelector<HTMLElement>('.fm-map__scroll');
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const zone = 72;
      const speed =
        x < box.left + zone ? -EDGE_SCROLL_PX : x > box.right - zone ? EDGE_SCROLL_PX : 0;

      if (speed === 0) return stopEdgeScroll();
      if (edgeTimer !== null) return;
      // Snapping fights a programmatic scroll, so it stands down for the drag.
      scroller.setAttribute('data-dragging', 'true');
      edgeTimer = setInterval(() => {
        scroller.scrollLeft += speed;
      }, 16);
    };

    const onMove = (event: PointerEvent) => {
      const start = armed.current;
      if (start) {
        const far =
          Math.abs(event.clientX - start.x) > DRAG_THRESHOLD_PX ||
          Math.abs(event.clientY - start.y) > DRAG_THRESHOLD_PX;
        if (!far) return;
        armed.current = null;
        moveCarry(event.clientX, event.clientY);
        latest.current.set({
          payload: start.payload,
          via: 'pointer',
          target: latest.current.targetAt(event.clientX, event.clientY),
        });
        return;
      }

      const current = drag.current;
      if (!current || current.via !== 'pointer') return;

      // Always cheap: a style write on one absolutely-positioned element.
      moveCarry(event.clientX, event.clientY);
      edgeScroll(event.clientX);

      const target = latest.current.targetAt(event.clientX, event.clientY);
      const changed =
        target?.teamId !== current.target?.teamId ||
        target?.quarterId !== current.target?.quarterId;
      if (!changed) return;

      latest.current.set({ ...current, target });
      if (target) latest.current.announce(latest.current.describe(current.payload, target));
    };

    const onUp = (event: PointerEvent) => {
      if (armed.current) {
        armed.current = null;
        return;
      }
      stopEdgeScroll();
      const current = drag.current;
      if (!current || current.via !== 'pointer') return;

      // The release is also a position. A drag fast enough to produce a single
      // move event lands here before the target has been read, so read it now
      // rather than trusting whatever the last move happened to see.
      const target = latest.current.targetAt(event.clientX, event.clientY) ?? current.target;
      latest.current.set(null);
      if (target) latest.current.onDrop(current.payload, target);
    };

    const onCancelEvent = () => {
      stopEdgeScroll();
      armed.current = null;
      if (drag.current?.via === 'pointer') latest.current.cancel();
    };

    // Escape cancels from anywhere. A drag you cannot abandon is a trap.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) {
        stopEdgeScroll();
        latest.current.cancel();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelEvent);
    window.addEventListener('keydown', onKey);
    return () => {
      stopEdgeScroll();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancelEvent);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return { placement, carryRef, beginPointer, beginKeyboard, aim, drop: finish, cancel };
}
