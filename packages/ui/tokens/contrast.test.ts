/**
 * The token contrast contract.
 *
 * WCAG 2.2 AA is a hard requirement, and a palette is the one place where a
 * one-character change can break it silently across the whole product. So every
 * documented foreground/background pair is asserted here, in light, dark, and
 * high-contrast — a palette edit that breaks a ratio fails CI rather than
 * reaching an accessibility audit six months later.
 *
 * Thresholds (docs/spec/06-views-interaction.md §12):
 *   · 4.5:1 text
 *   · 3:1   UI components and graphical objects
 *   · 7:1   high contrast
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/** Comments mention syntax we deliberately avoid, so checks run against code. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Parses the custom properties declared under a selector.
 *
 * Quote-agnostic, because formatters rewrite `[a="b"]` to `[a='b']` and a
 * contrast test that breaks on a reformat is worse than no test.
 */
function block(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/["']/g, `["']`);

  const matches = [...CSS.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  if (matches.length === 0) throw new Error(`No CSS block found for selector: ${selector}`);

  const out: Record<string, string> = {};
  for (const match of matches) {
    for (const line of match[1]!.split('\n')) {
      const declaration = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line);
      if (declaration) out[declaration[1]!] = declaration[2]!.trim();
    }
  }
  return out;
}

const light = block(':root');
const dark = block(':root[data-theme="dark"]');
const highContrastLight = block(':root[data-contrast="high"]');
const highContrastDark = block(':root[data-contrast="high"][data-theme="dark"]');

function theme(base: Record<string, string>, ...overrides: Array<Record<string, string>>) {
  return Object.assign({}, base, ...overrides) as Record<string, string>;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light_, dark_] = la > lb ? [la, lb] : [lb, la];
  return (light_ + 0.05) / (dark_ + 0.05);
}

function resolve(tokens: Record<string, string>, name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`Token ${name} is not declared`);
  if (!value.startsWith('#')) throw new Error(`Token ${name} is not a literal colour: ${value}`);
  return value;
}

/**
 * Foreground token, background token, minimum ratio.
 *
 * Every ink is checked against every background it can land on. Checking only
 * `--surface` is how `--ink-subtle` shipped at 4.28:1 on `--ground` and was
 * caught by axe in the browser rather than here.
 */
const BACKGROUNDS = ['--surface', '--ground', '--surface-sunken', '--surface-raised'] as const;
const INKS = ['--ink', '--ink-muted', '--ink-subtle'] as const;

const TEXT_PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ...INKS.flatMap((ink) => BACKGROUNDS.map((bg) => [ink, bg, 4.5] as const)),
  ['--accent', '--surface', 4.5],
  ['--critical-fg', '--surface', 4.5],
  ['--critical-fg', '--critical-surface', 4.5],
  ['--warning-fg', '--surface', 4.5],
  ['--warning-fg', '--warning-surface', 4.5],
  ['--positive-fg', '--surface', 4.5],
  ['--positive-fg', '--positive-surface', 4.5],
  ['--info-fg', '--surface', 4.5],
  ['--info-fg', '--info-surface', 4.5],
  ['--accent-on', '--accent', 4.5],

  // Block labels sit on the fill ramp, not on the surface. Missing these let a
  // fill be darkened for legibility without anyone checking what it did to the
  // text printed on it.
  // Full-strength ink only: --ink-muted lands at 3.31:1 on a mandatory block,
  // and those blocks carry the numbers that matter most.
  ['--ink', '--graphite-2', 4.5],
  ['--ink', '--graphite-3', 4.5],
  // The blocks moved onto the cyan ramp, so the same check follows them there.
  // Mandatory blocks fill with the border tone and are dark enough that the
  // label inverts, which is a second pair to hold rather than a way out of
  // holding the first.
  ['--ink', '--cyan-1', 4.5],
  ['--ink-inverse', '--cyan-2', 4.5],
  ['--ink-inverse', '--cyan-3', 4.5],
  // The over-capacity portion of a block is a tint the block's own name is
  // printed on, so it is a text background like any other.
  ['--ink', '--critical-surface', 4.5],

  // Every class fill is a surface a block's own name is printed on. Mandatory
  // fills with its hue and inverts; the other three stay pale and keep --ink.
  ['--ink-inverse', '--class-mandatory-fill', 4.5],
  ['--ink', '--class-mandatory-tint', 4.5],
  ['--ink', '--class-strategic-fill', 4.5],
  ['--ink', '--class-operational-fill', 4.5],
  ['--ink', '--class-discretionary-fill', 4.5],

  // The capacity washes replaced hatching, which means they are now solid
  // backgrounds for the reserve label rather than texture behind it.
  ['--ink', '--state-reserve', 4.5],
  ['--ink', '--state-refinement', 4.5],
  ['--ink', '--state-hold', 4.5],
  ['--ink', '--state-carryover', 4.5],

  // Every swatch a workspace can assign to a class. A block label is printed on
  // the fill, so each fill is a text background.
  ['--ink', '--swatch-plum-fill', 4.5],
  ['--ink', '--swatch-indigo-fill', 4.5],
  ['--ink', '--swatch-teal-fill', 4.5],
  ['--ink', '--swatch-slate-fill', 4.5],
  ['--ink', '--swatch-violet-fill', 4.5],
  ['--ink', '--swatch-moss-fill', 4.5],
  ['--ink', '--swatch-clay-fill', 4.5],
  ['--ink', '--swatch-stone-fill', 4.5],

  // ...and Mandatory fills solid with its line colour and inverts its label, so
  // whichever swatch lands there has to carry white text too. Asserting it for
  // all eight is what lets the setting be a free choice rather than a trap.
  ['--ink-inverse', '--swatch-plum-line', 4.5],
  ['--ink-inverse', '--swatch-indigo-line', 4.5],
  ['--ink-inverse', '--swatch-teal-line', 4.5],
  ['--ink-inverse', '--swatch-slate-line', 4.5],
  ['--ink-inverse', '--swatch-violet-line', 4.5],
  ['--ink-inverse', '--swatch-moss-line', 4.5],
  ['--ink-inverse', '--swatch-clay-line', 4.5],
  ['--ink-inverse', '--swatch-stone-line', 4.5],
];

/** Graphical objects and interactive boundaries need 3:1, not 4.5:1. */
const GRAPHICAL_PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ['--border-strong', '--surface', 3],
  ['--accent', '--surface', 3],
  ['--critical-line', '--surface', 3],
  ['--warning-line', '--surface', 3],
  ['--positive-line', '--surface', 3],
  ['--info-line', '--surface', 3],
  ['--graphite-4', '--surface', 3],
  ['--cyan-2', '--surface', 3],
  ['--cyan-3', '--surface', 3],

  // A class line is the whole encoding when the fill is pale, so it is a
  // graphical object that has to hold up on its own.
  ['--class-mandatory-line', '--surface', 3],
  ['--class-strategic-line', '--surface', 3],
  ['--class-operational-line', '--surface', 3],
  ['--class-discretionary-line', '--surface', 3],

  ['--swatch-plum-line', '--surface', 3],
  ['--swatch-indigo-line', '--surface', 3],
  ['--swatch-teal-line', '--surface', 3],
  ['--swatch-slate-line', '--surface', 3],
  ['--swatch-violet-line', '--surface', 3],
  ['--swatch-moss-line', '--surface', 3],
  ['--swatch-clay-line', '--surface', 3],
  ['--swatch-stone-line', '--surface', 3],
];

describe.each([
  ['light', theme(light)],
  ['dark', theme(light, dark)],
] as const)('%s theme', (_name, tokens) => {
  it.each(TEXT_PAIRS)('%s on %s clears %s:1 for text', (fg, bg, min) => {
    const value = ratio(resolve(tokens, fg), resolve(tokens, bg));
    expect(value, `${fg} on ${bg} is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });

  it.each(GRAPHICAL_PAIRS)('%s on %s clears %s:1 for graphical objects', (fg, bg, min) => {
    const value = ratio(resolve(tokens, fg), resolve(tokens, bg));
    expect(value, `${fg} on ${bg} is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

describe.each([
  ['light', theme(light, highContrastLight)],
  ['dark', theme(light, dark, highContrastLight, highContrastDark)],
] as const)('high contrast, %s', (_name, tokens) => {
  it.each(['--critical-fg', '--warning-fg', '--positive-fg', '--info-fg'])(
    '%s reaches 7:1 on the surface',
    (fg) => {
      const value = ratio(resolve(tokens, fg), resolve(tokens, '--surface'));
      expect(value, `${fg} is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(7);
    },
  );

  it('raises muted and subtle ink to full contrast', () => {
    expect(tokens['--ink-muted']).toBe('var(--ink)');
    expect(tokens['--ink-subtle']).toBe('var(--ink)');
  });
});

describe('palette hygiene', () => {
  it('declares the dark palette in both the attribute and the media query', () => {
    // An explicit choice must win in both directions — see design-system §12.
    expect(CSS).toMatch(/:root\[data-theme=["']dark["']\]/);
    expect(CSS).toMatch(/:root:not\(\[data-theme=["']light["']\]\)/);
  });

  it('gives every signal a fg, surface, line and on token', () => {
    for (const signal of ['critical', 'warning', 'positive', 'info']) {
      for (const role of ['fg', 'surface', 'line', 'on']) {
        expect(light[`--${signal}-${role}`], `--${signal}-${role} in light`).toBeDefined();
        expect(dark[`--${signal}-${role}`], `--${signal}-${role} in dark`).toBeDefined();
      }
    }
  });

  it('honours reduced motion by zeroing every duration', () => {
    expect(CSS).toContain('prefers-reduced-motion: reduce');
    expect(CSS).toMatch(/--motion-base:\s*0ms/);
  });

  it('does not rely on light-dark(), which older managed WebViews lack', () => {
    expect(CSS_CODE).not.toContain('light-dark(');
  });
});
