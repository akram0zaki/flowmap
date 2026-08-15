/**
 * Pattern tokens — the primary non-colour encoding for capacity state.
 *
 * Colour is the LAST channel Flowmap uses, never the only one. Every pattern
 * below has a glyph and a text equivalent that travel with it into the list
 * companion and the aria-label. See docs/design/design-system.md §3.
 *
 * Patterns are emitted once into a single <defs> sheet at the root of each SVG
 * canvas and referenced by id, so 500 blocks cost one definition, not 500.
 */

export type PatternId =
  'reserve' | 'refinement' | 'hold' | 'carryover' | 'overflow' | 'ghost' | 'archived';

export type PatternSpec = {
  id: PatternId;
  /** Base pitch in px at zoom 1.0. Scaled by `patternPitch()`. */
  pitch: number;
  strokeVar: string;
  /** Token reference for the stroke colour. */
  colorVar: string;
  /** Rendered as an outline treatment rather than a fill. */
  outlineOnly?: boolean;
  opacity?: number;
  dashArray?: string;
  /** i18n key for the text equivalent shown in lists and read by screen readers. */
  labelKey: string;
  /** Glyph shown alongside the pattern in legends and compact rows. */
  glyph: string;
};

export const PATTERNS: Record<PatternId, PatternSpec> = {
  reserve: {
    id: 'reserve',
    pitch: 6,
    strokeVar: 'var(--pattern-stroke)',
    colorVar: 'var(--graphite-3)',
    labelKey: 'pattern.reserve',
    glyph: '╱',
  },
  refinement: {
    id: 'refinement',
    pitch: 6,
    strokeVar: 'var(--pattern-stroke)',
    colorVar: 'var(--graphite-3)',
    dashArray: '2 3',
    labelKey: 'pattern.refinement',
    glyph: '╱',
  },
  hold: {
    id: 'hold',
    pitch: 5,
    strokeVar: 'var(--pattern-stroke)',
    colorVar: 'var(--graphite-4)',
    labelKey: 'pattern.hold',
    glyph: '⁘',
  },
  carryover: {
    id: 'carryover',
    pitch: 5,
    strokeVar: 'var(--pattern-stroke)',
    colorVar: 'var(--graphite-4)',
    labelKey: 'pattern.carryover',
    glyph: '╳',
  },
  overflow: {
    id: 'overflow',
    // Pitch 4 at the heavy stroke is 38% ink, which reads as a filled slab
    // rather than a marked region — and on a dark ground the salmon took over
    // the whole board. The bracket beside it is what measures the excess; this
    // only has to say which blocks carry it.
    pitch: 7,
    strokeVar: 'var(--pattern-stroke)',
    colorVar: 'var(--critical-line)',
    labelKey: 'pattern.overflow',
    glyph: '▲',
  },
  ghost: {
    id: 'ghost',
    pitch: 0,
    strokeVar: '2px',
    colorVar: 'var(--info-line)',
    outlineOnly: true,
    opacity: 0.55,
    dashArray: '4 3',
    labelKey: 'pattern.ghost',
    glyph: '◌',
  },
  archived: {
    id: 'archived',
    pitch: 9,
    strokeVar: '0.5px',
    colorVar: 'var(--ink-subtle)',
    labelKey: 'pattern.archived',
    glyph: '⌫',
  },
};

/**
 * Pitch scales with zoom so hatching never becomes a moiré at L1 or a wall of
 * stripes at L3. Clamped deliberately tighter than the zoom range itself.
 */
export function patternPitch(spec: PatternSpec, zoom: number): number {
  const factor = Math.min(1.5, Math.max(0.75, zoom));
  return spec.pitch * factor;
}

/** Geometry for each pattern's tile, given a resolved pitch. */
export function patternGeometry(id: PatternId, pitch: number): string[] {
  switch (id) {
    case 'reserve':
    case 'refinement':
      // 45° hatch
      return [`M0,${pitch} L${pitch},0`];
    case 'archived':
      // 135° hatch
      return [`M0,0 L${pitch},${pitch}`];
    case 'carryover':
      // cross-hatch
      return [`M0,${pitch} L${pitch},0`, `M0,0 L${pitch},${pitch}`];
    case 'overflow':
      // vertical dense hatch
      return [`M${pitch / 2},0 L${pitch / 2},${pitch}`];
    case 'hold':
      // dot grid, drawn as a zero-length stroke with round linecap
      return [`M${pitch / 2},${pitch / 2} L${pitch / 2},${pitch / 2}`];
    case 'ghost':
      return [];
  }
}

/**
 * Every pattern MUST resolve to a text equivalent. A visual that cannot be read
 * aloud is not finished — see docs/spec/06-views-interaction.md §12.
 */
export function patternLabelKey(id: PatternId): string {
  return PATTERNS[id].labelKey;
}
