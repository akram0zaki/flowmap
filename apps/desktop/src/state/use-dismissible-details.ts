/**
 * Header `<details>` menus.
 *
 * The same `name` makes them exclusive (opening one closes the others). A
 * document pointer-down outside, or Escape, closes the open one. Native
 * `<details>` does neither of those on its own.
 */

import { useEffect, type RefObject } from 'react';

export const HEADER_MENU_NAME = 'fm-header-menu';

export function useDismissibleDetails(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!node.open) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      node.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !node.open) return;
      node.open = false;
      node.querySelector('summary')?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref]);
}
