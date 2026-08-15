# Flowmap Design System

Direction: **measured drawing.**

Flowmap's job is to make a portfolio physically understandable. Its own vernacular is therefore the
vernacular of technical drawing — hatched section fills, hairline rules, tick scales, load lines,
schedules of figures in tabular columns. The interface is a set of drawings laid on a desk, not a
dashboard of cards.

Everything below derives from that one idea, and from three constraints the product cannot bend:
WCAG 2.2 AA, no state communicated by colour alone, and 500 commitments on screen without noise.

---

## 1. The governing rule

> **The map is monochrome until something needs attention.**

Commitment blocks, containers, reserves, and dependency lines are drawn in graphite. Hue is reserved
almost entirely for **signals** — attention, health, overflow, conflict. When a lead scans the
Portfolio Map, every colour they see is something the product is telling them, not decoration and
not a category legend.

This is what makes a dense board readable, and it is why lifecycle, class, and carry-over are encoded
with **pattern, opacity, and glyph** rather than a rainbow of category colours. It also means the
non-colour-encoding requirement stops being an accessibility tax and becomes the design.

---

## 2. Palette

Named for what they are in the drawing, not for their hue — so a token is never used for the wrong job.

### Light — _paper on a desk_

| Token                 | Value                                   | Use                                            | Contrast          |
| --------------------- | --------------------------------------- | ---------------------------------------------- | ----------------- |
| `--ground`            | `#F5F4F0`                               | App ground; the desk                           | —                 |
| `--surface`           | `#FFFFFF`                               | Drawings: canvas cells, panels, sheets         | —                 |
| `--surface-sunken`    | `#ECEAE4`                               | Wells, inactive lanes, table stripes           | —                 |
| `--surface-raised`    | `#FFFFFF` + shadow                      | Overlays, popovers, sheets                     | —                 |
| `--ink`               | `#16181C`                               | Primary text                                   | 17.2:1 on surface |
| `--ink-muted`         | `#565B63`                               | Secondary text, axis labels                    | 7.3:1             |
| `--ink-subtle`        | `#6E747D`                               | Tertiary, placeholder                          | 5.3:1             |
| `--rule`              | `#E3E0D9`                               | Hairline grid, decorative dividers             | decorative only   |
| `--border`            | `#C9C5BD`                               | Grouping boundaries                            | decorative only   |
| `--border-strong`     | `#8A8781`                               | **Interactive** component boundaries           | 3.1:1 ✓           |
| `--graphite-1` … `-4` | `#EFEDE8` `#DCD8D0` `#B9B4A9` `#8C877D` | Block fills, load bands                        | —                 |
| `--accent`            | `#24457C`                               | Drafting ink: primary action, selection, focus | 8.9:1             |
| `--accent-surface`    | `#E8EEF8`                               | Selected row/cell wash                         | —                 |

### Dark — _graphite desk, slate drawings_

| Token                 | Value                                   | Contrast on ground |
| --------------------- | --------------------------------------- | ------------------ |
| `--ground`            | `#101215`                               | —                  |
| `--surface`           | `#181B20`                               | —                  |
| `--surface-sunken`    | `#0C0E11`                               | —                  |
| `--ink`               | `#EDEEF0`                               | 15.1:1             |
| `--ink-muted`         | `#A2A8B2`                               | 7.6:1              |
| `--ink-subtle`        | `#848B96`                               | 5.4:1              |
| `--rule`              | `#262A31`                               | decorative         |
| `--border`            | `#333941`                               | decorative         |
| `--border-strong`     | `#6B7480`                               | 3.65:1 ✓           |
| `--graphite-1` … `-4` | `#22262C` `#2E333B` `#434A55` `#5E6774` | —                  |
| `--accent`            | `#8FB0E8`                               | 9.4:1              |
| `--accent-surface`    | `#1B2739`                               | —                  |

### Signals

Four hues, chosen to stay distinguishable under protanopia and deuteranopia, and **always** paired
with a glyph, a pattern, and text. Each has a text-safe `fg`, a fill `surface`, and a `line` for
strokes on the canvas.

| Signal                   | Light `fg` / `surface` / `line`   | Dark `fg` / `surface` / `line`    | Meaning                              |
| ------------------------ | --------------------------------- | --------------------------------- | ------------------------------------ |
| **Critical** — oxide red | `#A6301F` / `#FBEBE7` / `#C2442F` | `#F2947F` / `#3A1C16` / `#E07257` | Overflow, overdue, blocked, conflict |
| **Warning** — ochre      | `#8A5A00` / `#FBF1DC` / `#A87211` | `#DFAF5C` / `#332609` / `#C79A45` | Approaching, at risk, stale          |
| **Positive** — viridian  | `#1F5E45` / `#E6F2EC` / `#2E7A5B` | `#7CC7A5` / `#122B21` / `#5FA987` | Resolved, healthy, headroom          |
| **Info** — drafting ink  | `#24457C` / `#E8EEF8` / `#3A62A0` | `#9BBAEC` / `#182338` / `#7295D6` | Scenario, note, neutral advisory     |

All `fg` values clear 4.5:1 on their own `surface` and on the theme surface. All `line` values clear
3:1 for graphical objects. A token-level contrast test enforces this — a palette change that breaks
it fails CI.

**Severity is never hue alone.** `INFO` / `LOW` / `MEDIUM` / `HIGH` map to glyph
(`·` `▪` `▲` `▲` filled) + halo weight + a text label, with hue as the fourth channel.

---

## 3. Patterns

First-class tokens, not CSS afterthoughts. Each is an SVG `<pattern>` shipped in one defs sheet and
referenced by id. They are the primary encoding for capacity state; colour is secondary.

| Token                | Drawing                                          | Meaning                                |
| -------------------- | ------------------------------------------------ | -------------------------------------- |
| `pattern-reserve`    | 45° hatch, 1 px line, 6 px pitch                 | Reserved capacity (BAU, LCM, overhead) |
| `pattern-refinement` | 45° hatch, 1 px, 6 px pitch, dotted              | Refinement reserve                     |
| `pattern-hold`       | Dot grid, 1 px, 5 px pitch                       | Held capacity (system-managed)         |
| `pattern-carryover`  | Cross-hatch, 1 px, 7 px pitch                    | Carry-over footprint                   |
| `pattern-overflow`   | 90° dense hatch, 1.5 px, 4 px pitch              | Over-capacity spill                    |
| `pattern-ghost`      | No fill; 2 px dashed outline (4/3), 55 % opacity | Scenario ghost                         |
| `pattern-archived`   | 135° hatch, 0.5 px, 9 px pitch, `--ink-subtle`   | Archived entity                        |

Pitch scales with zoom level so hatching never turns into a moiré at L1 or a wall of stripes at L3:
`pitch × clamp(zoom, 0.75, 1.5)`.

Every pattern has a **text equivalent** in the list companion and in its `aria-label`, e.g.
`"Reserved — BAU & support, 15 units"`.

---

## 4. Typography

| Role               | Face                                              | Why this one                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI / body**      | **Atkinson Hyperlegible Next** (SIL OFL, bundled) | Designed by the Braille Institute for low vision: unmistakable `1 l I`, `0 O`, `rn` vs `m`. In a product where a misread `1` is a misread capacity figure and WCAG AA is a hard requirement, legibility is the brief, not a preference |
| **Figures / data** | **IBM Plex Mono** (SIL OFL, bundled)              | Every number — units, percentages, quarter ids, rule codes — sets in tabular mono so figures align down a column like a drawing schedule. This is the schedule half of "measured drawing"                                              |
| **Display**        | Atkinson Hyperlegible Next, 700, `-0.02em`        | Empty states, first run, presentation mode. Deliberately not a second display family: a dense tool does not need one, and adding one would be decoration                                                                               |

Fonts are **self-hosted and bundled** — the CSP forbids remote origins
([spec 10 §2](../spec/10-desktop-security.md#2-process-and-ipc-boundary)).

### Scale

Base 14 px. Dense, but Atkinson at 14 reads like most faces at 15.

| Token         | Size / line | Use                                                     |
| ------------- | ----------- | ------------------------------------------------------- |
| `--text-2xs`  | 11 / 14     | Axis ticks, dense table meta. Never for essential prose |
| `--text-xs`   | 12 / 16     | Chips, badges, block labels, table cells                |
| `--text-sm`   | 13 / 18     | Secondary UI, side panel fields                         |
| `--text-base` | 14 / 20     | Default UI and body                                     |
| `--text-md`   | 16 / 24     | Panel headings, emphasised body                         |
| `--text-lg`   | 20 / 28     | View titles                                             |
| `--text-xl`   | 26 / 32     | Empty states, first run                                 |
| `--text-2xl`  | 34 / 40     | Presentation mode headings                              |

Presentation mode shifts every token **up one step** and thickens focus rings, for projector
legibility, without any separate stylesheet.

Weights: 400 body · 500 UI emphasis · 700 headings and figures that carry a signal. Nothing else.

**Rule:** all figures use `font-variant-numeric: tabular-nums` and right-align in any column.

---

## 5. Space, grid, and the unit scale

- Space scale: `2 4 6 8 12 16 24 32 48 64` (`--space-1` … `--space-10`), 4 px base.
- Radius: `--radius-sm 2px` · `--radius-md 4px` · `--radius-full 999px`. Nearly square — drawn with
  a fine pen, not a marker. Blocks and containers use `2px`; only pills and avatars go round.
- Density: row heights `--row-compact 28px` / `--row-default 32px` / `--row-comfortable 40px`,
  user-selectable.

### The capacity unit scale — the one measurement that matters

```
1 capacity unit = 2 px at zoom 1.0        →  a 100-unit team-quarter container is 200 px tall
```

Block height is therefore _literally measurable_ against the container's tick scale, which is drawn
every 10 units with a labelled major tick every 50. This is the reason blocks can be trusted at a
glance, and it is why the container renders a scale at all instead of a bare percentage.

---

## 6. The signature: the capacity vessel

The one element Flowmap is remembered by. Every team-quarter container is drawn as a **measured
vessel**:

```
        units
    100 ┤                                    ← capacity rule (effective capacity)
        │ ╱╱╱╱╱╱ +10  ▲ Over capacity          ← overflow spill, above the rule, dense hatch
     90 ┼───────────────────────────────     ← deliverable capacity line (solid, 1.5 px)
        │ ┌───────────────────────────┐
        │ │  SEPA instant      35 u   │       ← blocks, graphite, stacked from the plinth up
     70 ┤ ├───────────────────────────┤
        │ │  Fraud rules       20 u 🔒│
     50 ┤ ├───────────────────────────┤
        │ │╳╳ Ledger migration  5 u   │       ← carry-over: cross-hatch
     40 ┤ ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
        │ ┊  Statement redesign 15 u  ┊       ← scenario ghost: dashed, 55 %
     25 ┤ ╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱
        │ ╱ Refinement 5 · BAU 15 · Held 20   ← reserve plinth, hatched, labelled
      0 ┴─────────────────────────────────
          Payments · 2026-Q4 · 120% ▲ · −10 u headroom
```

Three ideas make it work:

1. **Reserves are a plinth, not a slice.** They sit at the base and hold everything else up, which
   is what they actually do. You cannot mistake reserved capacity for available capacity.
2. **Overflow spills above the rule.** Over-capacity is not a red cell — it is work that visibly does
   not fit in the vessel, hatched, labelled with units _and_ percent _and_ a ▲.
3. **The scale is always drawn.** Numbers on the left, so a block's height means something specific
   rather than "big-ish".

The vessel is used identically in the Portfolio Map, Demand Flow, and the scenario comparison view.
Learn it once, read it everywhere.

---

## 7. Motion

Functional only. Six sanctioned uses: drag response, flow through the Demand Flow pipe, focus
transitions, dependency highlight, scenario compare cross-fade, capacity change.

| Token              | Value                            | Use                                            |
| ------------------ | -------------------------------- | ---------------------------------------------- |
| `--motion-instant` | 0 ms                             | Reduced motion; drag follow                    |
| `--motion-fast`    | 120 ms                           | Hover, focus, chip toggle                      |
| `--motion-base`    | 200 ms                           | Panel open, block settle, capacity bar change  |
| `--motion-slow`    | 320 ms                           | Zoom-level change, focus-mode dim, lens switch |
| `--ease-out`       | `cubic-bezier(0.16, 1, 0.3, 1)`  | Entrances, settles                             |
| `--ease-in-out`    | `cubic-bezier(0.65, 0, 0.35, 1)` | Position changes                               |

`prefers-reduced-motion` (and the in-app override) sets every duration to `0ms` and replaces
transitions with instant state changes. **No state cue is carried by motion alone**, so nothing is
lost — a block that would have animated into place simply appears there.

No confetti. No gamification. No ambient animation. A portfolio in trouble should not feel playful.

---

## 8. Elevation and focus

Data surfaces get **borders, not shadows** — a drawing does not float. Shadows are reserved for
things that genuinely sit above the desk.

| Token              | Use                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------- |
| `--shadow-none`    | Canvas cells, blocks, tables, panels                                                |
| `--shadow-overlay` | `0 2px 4px rgb(0 0 0 / .06), 0 8px 24px rgb(0 0 0 / .10)` — popovers, menus, sheets |
| `--shadow-drag`    | `0 4px 12px rgb(0 0 0 / .18)` — the one block currently being dragged               |

Focus:

```
--focus-ring:        0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
--focus-ring-canvas: 2px solid var(--accent) + 1px outline-offset;   /* SVG objects */
```

Always visible, never removed, never clipped by an ancestor's `overflow`. Presentation mode widens
it to 3 px. Focus contrast is ≥ 3:1 against both the object and its surroundings, in both themes.

---

## 9. Interactive targets

- Minimum interactive target **24 × 24 px** (WCAG 2.2 AA 2.5.8); **44 × 44 px** for primary actions
  and for anything on the canvas that is dragged.
- Blocks smaller than 24 px tall (an XS footprint at low zoom) keep a 24 px **hit area** extending
  beyond their drawn bounds, and are additionally reachable through the list companion. Small
  drawings never mean small targets.
- Hit areas never overlap ambiguously; when two blocks' expanded hit areas collide, the smaller one
  wins and the larger keeps its drawn bounds.

---

## 10. Writing

The interface's voice is a competent colleague pointing at a drawing: specific, unhurried, never
selling.

- **Name things as the user controls them.** "Capacity footprint", not "allocation record".
  "Reserved capacity", not "non-project overhead bucket".
- **Actions keep their name through the flow.** The button says _Commit_, the confirmation says
  _Committed_, the history entry says _Committed_.
- **Errors say what happened and what to do**, in the interface's voice. They do not apologise and
  are never vague.
  > _A commitment needs a primary team before it can be committed. Choose a primary team, then
  > commit._
- **Empty states are an invitation, not a mood.**
  > _No teams yet. Add the teams whose capacity you plan — usually 4 to 8 to start._
- **Every domain concept carries the three-part tooltip:** definition · what it is not · example.
  > **Size: Large** — Approximate relative capacity for this team and quarter.
  > _It is not_ a story-point or person-day estimate.
  > _For example:_ work that would occupy about a third of one team's quarter.
- Sentence case everywhere. No exclamation marks. No "Oops". No "just".

---

## 11. Component inventory

Built in `packages/ui`, each with a keyboard test and an axe test before it is considered done.

**Primitives** — Button, IconButton, Link, Input, NumberInput, Select, Combobox, Checkbox, Radio,
Switch, Textarea (with character counter), DatePicker, QuarterStrip (never a dropdown), Chip,
Badge, Tag, Tooltip (three-part), Popover, Menu, Dialog, Sheet, Toast, Banner, Tabs, Accordion,
Table (sortable, virtualised), Skeleton, EmptyState, ErrorState, ProgressRule, KeyHint.

**Domain** — CapacityVessel, CommitmentBlock, ReservePlinth, OverflowSpill, GhostBlock,
DependencyLine, DependencyArrow, MilestoneMarker, SignalGlyph, SeverityHalo, HealthPill,
ConfidenceMark, LifecyclePill, ClassLock, CarryOverMark, ChangeLoadStrip, QuarterAxis, TeamRowHeader,
IdeaCard, TradeOffPanel, ExplanationPanel, DiffList, ConflictRow, SyncStatus, ZoomControl,
LensStrip, FilterChipBar, ListCompanionToggle.

---

## 12. Theming

- Tokens are CSS custom properties on `:root`, with the dark set under both
  `[data-theme="dark"]` and `@media (prefers-color-scheme: dark)` guarded by
  `:root:not([data-theme="light"])`, so an explicit choice always wins in both directions.
- **No component ever hard-codes a colour, a spacing value, or a type size.** ESLint forbids raw hex,
  `rgb(`, and `px` literals in component styles outside `packages/ui/tokens`.
- A high-contrast variant raises `--border-strong`, `--ink-muted`, and every signal `fg` to ≥ 7:1 and
  thickens all pattern strokes. It is a token override, not a second stylesheet.
- Themes are validated by an automated contrast test over every documented foreground/background
  pair, in light, dark, and high-contrast.
