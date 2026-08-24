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

/**
 * Where a drop would land. The Ideas rail is a destination in its own right —
 * taking work off the board is the same gesture as putting it on, run backwards.
 */
export type DropTarget =
  | {
      readonly kind: 'CELL';
      readonly teamId: string;
      readonly quarterId: string;
      /** The block under the pointer, when there is one. Dependencies need it. */
      readonly commitmentId?: string;
    }
  | { readonly kind: 'RAIL' };

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

/** Identity of a target, for deciding whether anything a component draws moved. */
function describeTarget(target: DropTarget | null | undefined): string {
  if (!target) return '';
  return target.kind === 'RAIL'
    ? 'rail'
    : `${target.teamId}:${target.quarterId}:${target.commitmentId ?? ''}`;
}

export type UsePlacementOptions = {
  readonly onDrop: (payload: DragPayload, target: DropTarget) => void;
  readonly onCancel?: (payload: DragPayload) => void;
  /** Announced on every meaningful change, for the live region. */
  readonly announce: (message: string) => void;
  readonly describe: (payload: DragPayload, target: DropTarget | null) => string;
  /**
   * Rewrites what is in the hand when Alt goes down or comes back up.
   *
   * The modifier does not change where the drop lands, it changes what the drop
   * *means* — a plain drag has another team pick the work up as well, Alt moves
   * the placement instead. The hook owns the key state because the preview has
   * to flip mid-drag, without the pointer moving; what the two readings of the
   * payload are is the caller's business, not the gesture's.
   */
  readonly resolve?: (payload: DragPayload, alt: boolean) => DragPayload;
};

export function usePlacement({
  onDrop,
  onCancel,
  announce,
  describe,
  resolve,
}: UsePlacementOptions) {
  // The authority. Written synchronously by every handler.
  const drag = useRef<PlacementState | null>(null);
  /**
   * The payload as it was picked up, before `resolve` read the modifier off it.
   * Kept so that flipping Alt twice returns the original rather than resolving
   * an already-resolved payload.
   */
  const held = useRef<DragPayload | null>(null);
  const altHeld = useRef(false);
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

    const sameTarget = describeTarget(previous?.target) === describeTarget(next?.target);
    if (previous && next && previous.payload === next.payload && sameTarget) return;

    setPlacement(next);
  }, []);

  /** Which container is under a point. The DOM is the authority on hit areas. */
  const targetAt = useCallback((x: number, y: number): DropTarget | null => {
    const under = document.elementFromPoint(x, y);
    if (!under) return null;

    if (under.closest('[data-drop-rail]')) return { kind: 'RAIL' };

    const cell = under.closest<HTMLElement>('[data-drop-team][data-drop-quarter]');
    if (!cell) return null;
    const teamId = cell.dataset['dropTeam'];
    const quarterId = cell.dataset['dropQuarter'];
    if (!teamId || !quarterId) return null;

    // A dependency points at work, not at a container, so the block under the
    // pointer matters as well as the cell it sits in.
    const commitmentId = under.closest<SVGGElement>('[data-commitment]')?.dataset['commitment'];
    return { kind: 'CELL', teamId, quarterId, ...(commitmentId ? { commitmentId } : {}) };
  }, []);

  const cancel = useCallback(() => {
    armed.current = null;
    held.current = null;
    const current = drag.current;
    set(null);
    if (current) onCancel?.(current.payload);
  }, [set, onCancel]);

  const beginPointer = useCallback((payload: DragPayload, event: React.PointerEvent) => {
    // Left button only, and never on a modified click — those are the browser's.
    // Alt is ours: it is the difference between another team taking the work on
    // as well and the placement moving, and it is read again on every move.
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    // Stops the browser from starting a text selection or a native image drag
    // out of the element being picked up, both of which cancel the gesture.
    event.preventDefault();
    altHeld.current = event.altKey;
    armed.current = { payload, x: event.clientX, y: event.clientY };
  }, []);

  const beginKeyboard = useCallback(
    (payload: DragPayload) => {
      held.current = payload;
      const resolved = resolve ? resolve(payload, altHeld.current) : payload;
      set({ payload: resolved, via: 'keyboard', target: null });
      announce(describe(resolved, null));
    },
    [set, announce, describe, resolve],
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
    held.current = null;
    set(null);
    if (current?.target) onDrop(current.payload, current.target);
  }, [set, onDrop]);

  // Held in a ref so the window listeners mount once. Re-subscribing on every
  // pointer move would be wasteful, and gating the effect on a ref silently did
  // not work at all — a ref does not re-run an effect, so the listeners were
  // never attached by the press that needed them.
  const latest = useRef({ targetAt, onDrop, cancel, announce, describe, set, resolve });
  latest.current = { targetAt, onDrop, cancel, announce, describe, set, resolve };

  // On the window rather than the element: a drag that leaves the block it
  // started on must keep tracking, and a release outside the board must still
  // end it rather than leaving a piece stuck to the cursor.
  useEffect(() => {
    const moveCarry = (x: number, y: number) => {
      const node = carryRef.current;
      if (node) node.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    };

    // The board is bigger than its window in both axes, and a hit test can only
    // see what is on screen: without this the last quarters and the team rows
    // below the fold are simply unreachable by pointer. Holding near an edge
    // scrolls the board towards it — vertically as well as horizontally, which
    // is what lets an Idea taken from anywhere in the rail reach any cell.
    let edgeTimer: ReturnType<typeof setInterval> | null = null;
    let edgeSpeed = { x: 0, y: 0 };
    const stopEdgeScroll = () => {
      if (edgeTimer !== null) clearInterval(edgeTimer);
      edgeTimer = null;
      edgeSpeed = { x: 0, y: 0 };
      document.querySelector('.fm-map__scroll')?.removeAttribute('data-dragging');
    };
    const edgeScroll = (x: number, y: number) => {
      const scroller = document.querySelector<HTMLElement>('.fm-map__scroll');
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const zone = 72;
      // The zone is measured against the scroller, not the window: past its
      // edge the pointer is over the rail or the chrome, and pulling the board
      // then would drag it away under a drop the user has already aimed.
      const axis = (position: number, start: number, end: number) =>
        position < start || position > end
          ? 0
          : position < start + zone
            ? -EDGE_SCROLL_PX
            : position > end - zone
              ? EDGE_SCROLL_PX
              : 0;

      edgeSpeed = {
        x: axis(x, box.left, box.right),
        y: axis(y, box.top, box.bottom),
      };

      if (edgeSpeed.x === 0 && edgeSpeed.y === 0) return stopEdgeScroll();
      if (edgeTimer !== null) return;
      // Snapping fights a programmatic scroll, so it stands down for the drag.
      scroller.setAttribute('data-dragging', 'true');
      edgeTimer = setInterval(() => {
        scroller.scrollLeft += edgeSpeed.x;
        scroller.scrollTop += edgeSpeed.y;
      }, 16);
    };

    /**
     * Alt went down or came back up. The pointer has not moved and the target
     * has not changed — what changed is what the drop would do, so the payload
     * is resolved again and the preview and the announcement follow it.
     */
    const reread = (alt: boolean) => {
      altHeld.current = alt;
      const current = drag.current;
      const original = held.current;
      if (!current || !original || !latest.current.resolve) return;

      const payload = latest.current.resolve(original, alt);
      latest.current.set({ ...current, payload });
      latest.current.announce(latest.current.describe(payload, current.target));
    };

    const onMove = (event: PointerEvent) => {
      const start = armed.current;
      if (start) {
        const far =
          Math.abs(event.clientX - start.x) > DRAG_THRESHOLD_PX ||
          Math.abs(event.clientY - start.y) > DRAG_THRESHOLD_PX;
        if (!far) return;
        armed.current = null;
        held.current = start.payload;
        altHeld.current = event.altKey;
        moveCarry(event.clientX, event.clientY);
        latest.current.set({
          payload: latest.current.resolve
            ? latest.current.resolve(start.payload, event.altKey)
            : start.payload,
          via: 'pointer',
          target: latest.current.targetAt(event.clientX, event.clientY),
        });
        return;
      }

      const current = drag.current;
      if (!current || current.via !== 'pointer') return;

      // A move carries the modifier with it, so a drag that starts plain and
      // has Alt pressed halfway through re-reads without waiting for a keydown.
      if (event.altKey !== altHeld.current) reread(event.altKey);

      // Always cheap: a style write on one absolutely-positioned element.
      moveCarry(event.clientX, event.clientY);
      edgeScroll(event.clientX, event.clientY);

      const target = latest.current.targetAt(event.clientX, event.clientY);
      if (describeTarget(target) === describeTarget(current.target)) return;

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
      held.current = null;
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
      held.current = null;
      if (drag.current?.via === 'pointer') latest.current.cancel();
    };

    // Escape cancels from anywhere. A drag you cannot abandon is a trap.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) {
        stopEdgeScroll();
        latest.current.cancel();
        return;
      }
      // Held rather than pressed: the keyboard drag has no pointer to carry the
      // modifier, so the key's own down and up are what the preview reads.
      if (event.key === 'Alt' && drag.current && !altHeld.current) reread(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt' && drag.current && altHeld.current) reread(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelEvent);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      stopEdgeScroll();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancelEvent);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return { placement, carryRef, beginPointer, beginKeyboard, aim, drop: finish, cancel };
}
