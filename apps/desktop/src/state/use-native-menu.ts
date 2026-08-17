/**
 * Native menu actions arrive as events from the Rust shell. The webview keeps
 * the same handlers so the browser target still works; a short guard stops a
 * menu accelerator and the matching keydown from firing twice.
 */

import { useCallback, useEffect, useRef } from 'react';

import { isTauri } from '../runtime.js';

export type MenuCommand =
  | 'clear-local-data'
  | 'undo'
  | 'redo'
  | 'command-palette'
  | 'list-companion'
  | 'presentation'
  | 'settings'
  | 'shortcuts'
  | 'about';

const MENU_EVENT = 'flowmap://menu';

export function useNativeMenu(onCommand: (command: MenuCommand) => void): {
  once: (command: MenuCommand, run: () => void) => void;
} {
  const last = useRef<{ command: string; at: number } | null>(null);

  const once = useCallback((command: MenuCommand, run: () => void) => {
    const at = Date.now();
    if (last.current && last.current.command === command && at - last.current.at < 120) {
      return;
    }
    last.current = { command, at };
    run();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return;
      void listen<string>(MENU_EVENT, (event) => {
        if (isMenuCommand(event.payload)) {
          const command = event.payload;
          once(command, () => onCommand(command));
        }
      }).then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      });
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onCommand, once]);

  return { once };
}

function isMenuCommand(value: string): value is MenuCommand {
  return (
    value === 'clear-local-data' ||
    value === 'undo' ||
    value === 'redo' ||
    value === 'command-palette' ||
    value === 'list-companion' ||
    value === 'presentation' ||
    value === 'settings' ||
    value === 'shortcuts' ||
    value === 'about'
  );
}
