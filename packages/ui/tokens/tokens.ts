/**
 * Typed access to Flowmap design tokens.
 *
 * Values here are CSS custom-property *references*, never literals — the single
 * source of truth for every value is `tokens.css`. TypeScript consumers get
 * autocomplete and a compile error when a token is renamed; the runtime still
 * resolves through the cascade, so theming keeps working.
 *
 * See docs/design/design-system.md for the reasoning behind each group.
 */

export const color = {
  ground: 'var(--ground)',
  surface: 'var(--surface)',
  surfaceSunken: 'var(--surface-sunken)',
  surfaceHover: 'var(--surface-hover)',
  surfaceActive: 'var(--surface-active)',
  surfaceRaised: 'var(--surface-raised)',

  ink: 'var(--ink)',
  inkMuted: 'var(--ink-muted)',
  inkSubtle: 'var(--ink-subtle)',
  inkInverse: 'var(--ink-inverse)',

  rule: 'var(--rule)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',

  graphite1: 'var(--graphite-1)',
  graphite2: 'var(--graphite-2)',
  graphite3: 'var(--graphite-3)',
  graphite4: 'var(--graphite-4)',

  accent: 'var(--accent)',
  accentHover: 'var(--accent-hover)',
  accentActive: 'var(--accent-active)',
  accentSurface: 'var(--accent-surface)',
  accentOn: 'var(--accent-on)',
} as const;

export const signal = {
  critical: {
    fg: 'var(--critical-fg)',
    surface: 'var(--critical-surface)',
    line: 'var(--critical-line)',
    on: 'var(--critical-on)',
  },
  warning: {
    fg: 'var(--warning-fg)',
    surface: 'var(--warning-surface)',
    line: 'var(--warning-line)',
    on: 'var(--warning-on)',
  },
  positive: {
    fg: 'var(--positive-fg)',
    surface: 'var(--positive-surface)',
    line: 'var(--positive-line)',
    on: 'var(--positive-on)',
  },
  info: {
    fg: 'var(--info-fg)',
    surface: 'var(--info-surface)',
    line: 'var(--info-line)',
    on: 'var(--info-on)',
  },
} as const;

export type SignalTone = keyof typeof signal;

/**
 * Severity is encoded on four channels. Hue is the last of them, never the only
 * one — see docs/spec/06-views-interaction.md §12.
 */
export const severityEncoding = {
  INFO: { tone: 'info', glyph: '·', haloWidth: 0, labelKey: 'severity.info' },
  LOW: { tone: 'info', glyph: '▪', haloWidth: 1, labelKey: 'severity.low' },
  MEDIUM: { tone: 'warning', glyph: '▲', haloWidth: 2, labelKey: 'severity.medium' },
  HIGH: { tone: 'critical', glyph: '▲', haloWidth: 3, labelKey: 'severity.high' },
} as const satisfies Record<
  string,
  {
    tone: SignalTone;
    glyph: string;
    haloWidth: number;
    labelKey: string;
  }
>;

export const font = {
  ui: 'var(--font-ui)',
  mono: 'var(--font-mono)',
  display: 'var(--font-display)',
} as const;

export const text = {
  '2xs': { size: 'var(--text-2xs)', leading: 'var(--leading-2xs)' },
  xs: { size: 'var(--text-xs)', leading: 'var(--leading-xs)' },
  sm: { size: 'var(--text-sm)', leading: 'var(--leading-sm)' },
  base: { size: 'var(--text-base)', leading: 'var(--leading-base)' },
  md: { size: 'var(--text-md)', leading: 'var(--leading-md)' },
  lg: { size: 'var(--text-lg)', leading: 'var(--leading-lg)' },
  xl: { size: 'var(--text-xl)', leading: 'var(--leading-xl)' },
  '2xl': { size: 'var(--text-2xl)', leading: 'var(--leading-2xl)' },
} as const;

export const weight = {
  regular: 'var(--weight-regular)',
  medium: 'var(--weight-medium)',
  bold: 'var(--weight-bold)',
} as const;

export const space = {
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  7: 'var(--space-7)',
  8: 'var(--space-8)',
  9: 'var(--space-9)',
  10: 'var(--space-10)',
  11: 'var(--space-11)',
  12: 'var(--space-12)',
} as const;

export const radius = {
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  full: 'var(--radius-full)',
} as const;

export const shadow = {
  none: 'var(--shadow-none)',
  overlay: 'var(--shadow-overlay)',
  drag: 'var(--shadow-drag)',
} as const;

export const motion = {
  instant: 'var(--motion-instant)',
  fast: 'var(--motion-fast)',
  base: 'var(--motion-base)',
  slow: 'var(--motion-slow)',
  easeOut: 'var(--ease-out)',
  easeInOut: 'var(--ease-in-out)',
} as const;

export const layer = {
  canvas: 0,
  canvasOverlay: 10,
  panel: 20,
  sticky: 30,
  popover: 40,
  dialog: 50,
  toast: 60,
  presentation: 70,
} as const;

/* ── The capacity unit scale ─────────────────────────────────────────── */

/** Pixels per capacity unit at zoom 1.0. A 100-unit container is 200px tall. */
export const UNIT_PX = 2;
export const UNIT_TICK_MINOR = 10;
export const UNIT_TICK_MAJOR = 50;
export const VESSEL_MIN_BLOCK_HEIGHT = 6;

/** Minimum interactive target. Small drawings never mean small targets. */
export const HIT_TARGET_MIN = 24;
export const HIT_TARGET_PRIMARY = 44;

/** Height in CSS pixels for a footprint of `units` at a given zoom level. */
export function unitsToPx(units: number, zoom = 1): number {
  return Math.max(VESSEL_MIN_BLOCK_HEIGHT, units * UNIT_PX * zoom);
}

/** Inverse, used when a drag or keyboard resize is translated back to units. */
export function pxToUnits(px: number, zoom = 1): number {
  return Math.max(1, Math.round(px / (UNIT_PX * zoom)));
}

/* ── Density ─────────────────────────────────────────────────────────── */

export const density = {
  compact: 'var(--row-compact)',
  default: 'var(--row-default)',
  comfortable: 'var(--row-comfortable)',
} as const;

export type Density = keyof typeof density;
export type ThemeMode = 'light' | 'dark' | 'system';
export type ContrastMode = 'normal' | 'high';
export type MotionMode = 'system' | 'reduced';

export type ThemeState = {
  mode: ThemeMode;
  contrast: ContrastMode;
  motion: MotionMode;
  density: Density;
  presentation: boolean;
};

/** Applies theme state as data attributes on <html>. The cascade does the rest. */
export function applyTheme(root: HTMLElement, state: ThemeState): void {
  if (state.mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.mode);

  if (state.contrast === 'high') root.setAttribute('data-contrast', 'high');
  else root.removeAttribute('data-contrast');

  if (state.motion === 'reduced') root.setAttribute('data-motion', 'reduced');
  else root.removeAttribute('data-motion');

  if (state.presentation) root.setAttribute('data-presentation', 'on');
  else root.removeAttribute('data-presentation');

  root.style.setProperty('--row-height', density[state.density]);
}
