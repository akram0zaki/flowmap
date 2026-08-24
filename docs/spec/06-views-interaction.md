# 06 — Views, Interaction & Accessibility

Visual grammar, every view's layout and behaviour, the keyboard model, and the accessibility
contract. Visual tokens themselves live in [`docs/design/design-system.md`](../design/design-system.md)
and `packages/ui/tokens`.

## 1. Visual grammar

One meaning per symbol, workspace-wide. No symbol is reused for a second meaning.

| Element                                     | Meaning                                    | Encoding (never colour alone)                       |
| ------------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| Block                                       | A commitment's footprint in a team-quarter | Rectangle; height ∝ units                           |
| Block height                                | Approximate relative capacity              | Proportional to `units / deliverableCapacity`       |
| Container                                   | Team × Quarter capacity                    | Bounded cell with a capacity axis                   |
| Hatched band (`--pattern-reserve`)          | Reserved capacity                          | Diagonal hatch at the container base + label        |
| Translucent dashed block                    | Scenario ghost / candidate                 | 55 % opacity, 2 px dashed outline, "Scenario" badge |
| Cross-hatched block (`--pattern-carryover`) | Carry-over                                 | Cross-hatch + "Carried from <Q>" label              |
| Line                                        | Dependency                                 | Solid = hard, dashed = soft                         |
| Arrowhead                                   | Direction (source → target)                | Always drawn at the target end                      |
| Double stroke + ⛔ glyph                    | Blocked / overdue dependency               | Pattern + icon + text                               |
| 🔒 Lock glyph                               | Mandatory / constrained                    | Icon + `aria-label="Mandatory"`                     |
| ▲ Warning glyph + halo                      | Attention or health signal                 | Glyph + severity halo pattern + count               |
| Spill above the container line              | Overflow                                   | Offset block + `+N units · P% ▲ Over capacity`      |
| ◆ Diamond marker                            | Milestone                                  | Filled = done, hollow = planned, ✕ = missed         |
| ● Node ring thickness                       | Dependency hub in-degree                   | Ring width + numeric badge                          |

Motion is functional only: drag response, flow through the pipe, focus transitions, dependency
highlight, scenario compare, capacity change. No confetti, no gamification, no decorative animation.
`prefers-reduced-motion` (and the in-app override) replaces all transitions with instant state
changes while preserving every state cue.

## 2. Application shell

```
┌─ Title bar (native) ────────────────────────────────────────────────────────┐
├─ Top bar: [Workspace ▾] [Portfolio Radar DemandFlow Timeline Dependencies    │
│            Products History] ······ [Scenario ▾] [⌘K] [Sync ●] [Present] [⚙] │
├─ Lens / filter strip: [chips…]                             [Horizon: 18M ▾]  │
├──────────────────────────────┬──────────────────────────────────────────────┤
│                              │                                              │
│         View canvas          │       Detail panel (collapsible, resizable)  │
│                              │                                              │
├──────────────────────────────┴──────────────────────────────────────────────┤
│ Status bar: offline/last sync · pending N · conflicts N · signals N · zoom   │
└─────────────────────────────────────────────────────────────────────────────┘
```

The window is fluid down to **1024 × 640** with no clipped content, no horizontal page scroll, and
no overlapping chrome. Below that width the detail panel becomes an overlay sheet and the lens strip
collapses into a menu. Canvas content scrolls within its own region; the shell never scrolls.

Sync status is always visible: `Offline` / `Synced HH:MM` / `Pending N` / `Conflicts N`, each with
an icon and text.

## 3. Portfolio Map (home)

### 3.1 Grammar

**Quarters run left to right as columns. Teams are rows.** Commitment blocks sit inside
team-quarter containers. Products/services are a linked **overlay** or the Product lens — never a
competing permanent layout.

```
            2026-Q3      2026-Q4      2027-Q1      2027-Q2      2027-Q3      2027-Q4
          ┌──────────┬────────────┬────────────┬────────────┬────────────┬────────────┐
 Ideas /  │ ○ ○ ○    │  (lane spans the full height on the left, pinned, scrollable)  │
 Demand   │          │            │            │            │            │            │
          ├──────────┼────────────┼────────────┼────────────┼────────────┼────────────┤
 Payments │ ▓▓▓ 92%  │ ███ 120% ▲ │ ██  70%    │ █   40%    │            │            │
          ├──────────┼────────────┼────────────┼────────────┼────────────┼────────────┤
 Platform │ ▓▓  75%  │ ▓▓  80%    │ ███ 98%    │ ██  65%    │            │            │
          └──────────┴────────────┴────────────┴────────────┴────────────┴────────────┘
                        ▲ current quarter, visually centred by default
```

- Team rows default to **alphabetical**; a Planner may reorder manually. Capacity pressure never
  auto-reshuffles rows — a map that rearranges itself cannot be learned.
- The current quarter is visually centred on load and marked with a persistent "now" rule.
- The Ideas/Demand lane is pinned left, outside the capacity grid. Ideas appear on the grid only as
  thin connector markers from a refinement reserve ([02 §5.1](02-capacity-model.md#51-refinement-reserve-links)).
- **The lane carries a search field, directly under its title.** Case-insensitive substring on the
  Idea's name, narrowing as you type. Ordering by preparation is right for a queue you read and
  wrong for one you scan; past a dozen Ideas, finding the one you mean by eye is the slowest part of
  placing it. The header count stays the size of the queue, not of the search.
- **The lane scrolls independently of the grid, and the grid scrolls in both axes inside its own
  region.** The page itself does not scroll on this lens. A shared scroll couples the two — reaching
  an Idea near the bottom of the lane carries the team row you meant to drop it on off the screen —
  and a pointer drag cannot scroll a page under itself, which puts every row past the fold out of
  reach. A drag held near an edge of the grid scrolls it towards that edge, horizontally and
  vertically.

#### 3.1.1 A commitment across several teams

One commitment routinely consumes capacity on more than one team: an epic worked by three squads is
the ordinary case, not the exception. Footprint uniqueness is `(commitmentId, teamId, quarterId)`
([01 §6](01-domain-model.md)), so this has always been legal; what the board owes it is a gesture.

- **Dragging a block onto another team's row adds a placement there.** The row it came from keeps
  what it had, and the new footprint is `isPrimary: false` — this is `AssignCapacityFootprint`, not
  a move, and no gate is passed and no lifecycle changes.
- **Holding `Alt` during the drag moves the placement instead** (`MoveCapacityFootprint`), which is
  the reschedule and the correction.
- The modifier is read live: pressing or releasing `Alt` mid-drag re-states what the drop would do,
  without the pointer moving.
- **Ownership never changes either way.** The lead team is `commitment.primaryTeamId` and is set by
  dropping an _Idea_ on a row. A second team taking work on is not that decision — accountability
  stays where it was put, which is the whole distinction between leading work and doing some of it.
- An addition arrives at the same default size an Idea lands at, because how much of the work the
  second team takes is a new question and not one the first team's number answers.

#### 3.1.2 Taking a placement off the board

Dragging a block onto the Ideas/Demand lane, or pressing `Delete` on it, removes that placement.
What happens to the commitment depends on how many it had left:

- **More than one** — the footprint is archived and nothing else changes. The work is still
  committed, elsewhere.
- **The last one, `COMMITTED`** — `RevertCommitGate` runs first and the work returns to the lane as
  demand.
- **The last one, `DROPPED`** — the footprint is archived and the commitment keeps its record. It is
  **not** returned to the lane: the lane is for demand, and a decision not to do something is not
  demand. Refusing this stranded dropped work, because `DROPPED` has no transition out of it and no
  other gesture removes a last footprint.
- **The last one, `IN_DELIVERY`, `ON_HOLD` or `DONE`** — refused. That work has a history unplacing
  would quietly rewrite. `DONE` is terminal like `DROPPED`, but completed work on the board is the
  record of what a team delivered that quarter; removing it changes what the quarter says it shipped.

A settled quarter is refused throughout: it is history, and the domain declines to edit it.

### 3.2 Container anatomy

Bottom-up within each cell: reserve band (hatched, one segment per reserve type, labelled on hover
and in the list companion) → carry-over blocks (cross-hatched) → committed blocks (sorted by class
`MANDATORY` first, then units descending, then name) → ghost blocks in scenario mode → overflow
spill above the container line.

Header shows: `utilisation%` · `headroom` in units · attention count. Over capacity always shows
units _and_ percent _and_ the ▲ glyph.

### 3.3 Semantic zoom

| Level            | Trigger                                               | Shows                                                                                                                             | Hides                                              |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **L1 Portfolio** | zoom < 0.6, or `Level 1` control                      | Team rows as aggregate bars per quarter, counts, pressure indicator, attention totals, product overlay heat strip                 | Individual blocks, dependency lines, milestones    |
| **L2 Area**      | 0.6 ≤ zoom < 1.4, or selecting a team/product/quarter | Blocks within the selected area, reserve bands, capacity numbers, dependencies **within** the area, product-impact markers        | Cross-area dependencies unless the area is focused |
| **L3 Detail**    | zoom ≥ 1.4, or selecting a commitment                 | Block labels, all footprints of focused commitments, upstream/downstream dependencies, milestones, next action, attention markers | Nothing — this is the fully expanded state         |

Zoom is controlled by `Ctrl/Cmd + scroll`, pinch, the `+`/`−` controls, **and an explicit
`Level 1 / 2 / 3` segmented control** so zoom is reachable without a precise pointer. Level changes
are announced to screen readers.

Aggregate before cluttering: at L1 a cell renders one bar, not 12 blocks.

### 3.4 Focus mode

Selecting a commitment: unrelated elements drop to 25 % opacity and lose their labels; the selected
commitment, all of its footprints across teams and quarters, its impacted products, its up/downstream
dependencies (one hop by default, expandable), its milestones, and its attention markers stay at
full emphasis. `Esc` clears focus. Focus state is announced: _"Focused: SEPA instant payments.
3 footprints across 2 teams, 2 quarters. 4 dependencies, 1 overdue."_

### 3.5 Lenses

`Portfolio` · `Teams` · `Products` · `Themes` · `Attention` · `Dependencies` · `QBR` · `Timeline`.

Lenses change emphasis, never data. Switching lenses preserves selection and horizon where the
lens can express them. Lens is part of a saved view.

## 4. Radar view

Two-pane: grouped signal list (left, primary) + explanation panel (right). Mode toggle
`My Radar / Team & Portfolio`. Groups per [04 §6.2](04-rules-radar.md#62-grouping), collapsible,
with counts. Row anatomy and quick actions per [04 §6.3–6.4](04-rules-radar.md#63-item-anatomy).

Radar is a **list-first view** — it is already its own accessible companion. `j/k` or `↑/↓` move,
`Enter` opens, `r` reviews, `s` snoozes, `o` opens the entity in the Portfolio Map with focus set.

## 5. Timeline

- Horizontal quarter axis with the current quarter centred; presets `Now` / `QBR` / `18 Months`.
- One row per commitment (grouped by team, product, or theme — user's choice).
- A commitment renders as **fragments**, one per capacity footprint. Fragments of the same
  commitment share an identity band and are announced as one item with N fragments — they are not
  duplicate commitments.
- Milestones render as ◆ markers on the row; dependencies may target them.
- Carry-over fragments use the cross-hatch pattern and a "carried" label.
- No Gantt semantics: no bars-with-progress, no critical path, no dependency-driven scheduling, no
  resource levelling. Anything that looks like a task schedule is out of scope by construction.

## 6. Dependency Map

- Nodes: commitments, teams, products/services, decisions, milestones. Node shape encodes kind;
  node ring thickness + numeric badge encode unresolved in-degree.
- Layout: layered (ELK `layered`) with the waiting work on the left and prerequisites on the right,
  so direction reads consistently. Layout runs in a worker; results are cached per filter set.
- **Nothing is rendered as a permanent spaghetti graph.** Default state shows only hubs and the
  focused neighbourhood. Expanding is explicit: select a node → show N-hop neighbourhood (default 1,
  expandable to 3).
- Bottleneck emphasis: high in-degree hubs, capacity-constrained teams that are also hubs
  (`DEP_HUB_CONSTRAINED`), overdue decision hubs, cross-product concentration.
- Cycles render with a distinct cycle badge and a "Show cycle" action that highlights the ring.
- Accessible companion: a dependency **table** (source, type, target, owner, needed by, status) plus
  a per-node text description: _"Security review — required by 6 commitments, 2 overdue. Owned by
  A. Zaki. Needed by 2026-11-15."_

## 7. Products / Services view

- Products grouped with their commitments by impact type (`PRIMARY`, `MAJOR`, `MINOR`, `DEPENDENCY`).
- Change-load strip per product across the horizon, showing `LOW/MEDIUM/HIGH` with the score and an
  expandable contributor breakdown ([04 §5](04-rules-radar.md#5-product-change-load)).
- Explicit contrast copy in the view header: _"Team capacity answers 'can we deliver it'. Change
  load answers 'where does the change land'."_

## 8. Commitment detail panel

Progressive disclosure. Creating an Idea needs **a title only**. The panel reveals sections as they
gain content, with an "Add…" affordance for empty ones.

Sections, in order: **Identity** (name, lifecycle, class, importance, owner, primary team) ·
**Planning** (target quarter on a visual strip, target date, footprints, confidence, carry-over) ·
**Outcome** (statement, value drivers, themes) · **Impact** (products with typed impacts) ·
**Attention** (attention date, next action + owner + due, latest safe start) · **Dependencies**
(typed, owner, needed-by, status) · **Milestones** (≤ 6) · **Links** (typed, HTTPS) ·
**Management context** (note ≤ 2000, change history).

Every field label carries a tooltip in the fixed format:

> **Size: Large** — Approximate relative capacity consumption for this team and quarter.
> _It is not_ a story-point or person-day estimate.
> _Example:_ a change that would occupy about a third of one team's quarter.

Definition, what it is not, example where useful. This is what prevents teams inventing local
meanings, so it is a hard requirement on every capacity, lifecycle, impact, dependency, health,
attention, and confidence field.

## 9. Quick capture and command palette

- **Quick Capture** (`n`): inline title entry directly on the board — no modal, no form. Creates an
  `IDEA` in the Ideas/Demand lane with defaults. Under 5 seconds, keyboard-only.
- **Command palette** (`Ctrl/Cmd + K`): deterministic, explicit parsing only. Searches commitments,
  teams, products, people, themes, milestones, external-link labels. Offers navigation
  (`> go to team Payments`), creation (`+ idea <title>`), filters (`filter: quarter 2027-Q1`), and
  lens switching. It does **not** attempt natural-language understanding, and says so in its
  placeholder.

## 10. Search and filters

- Filters are composable chips shown in the lens strip: quarter, lifecycle, class, importance, team,
  product, theme, owner, health, attention reason, carry-over, has-dependency, scenario.
- Default visual response to a filter is **fade, not remove** — spatial context is preserved so the
  user does not lose the map they just learned. A "hide filtered" toggle exists for density.
- Every graphical view has a **list/table companion** (`Ctrl/Cmd + L`) with the same data, sortable
  and exportable. Capacity totals in the list MUST equal the totals in the visual — asserted by test.

> Visual for understanding; structured lists for precision.

## 11. Keyboard model

Global:

| Key                                     | Action                                        |
| --------------------------------------- | --------------------------------------------- |
| `Ctrl/Cmd + K`                          | Command palette                               |
| `Ctrl/Cmd + L`                          | Toggle list companion                         |
| `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` | Undo / redo                                   |
| `Ctrl/Cmd + Shift + P`                  | Presentation mode                             |
| `1`…`8`                                 | Switch lens                                   |
| `n`                                     | Quick capture                                 |
| `/`                                     | Focus search                                  |
| `?`                                     | Keyboard shortcut reference                   |
| `Esc`                                   | Clear focus / cancel mode / exit presentation |

Canvas (roving tabindex — the canvas is a single tab stop, arrows move within it):

| Key                 | Action                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `← → ↑ ↓`           | Move selection between cells / blocks                                                                                 |
| `Tab` / `Shift+Tab` | Move between regions (lane, grid, panel)                                                                              |
| `Enter`             | Open focused object                                                                                                   |
| `Space`             | Toggle focus mode on the object                                                                                       |
| `m`                 | **Move mode** — arrows choose target team-quarter, live headroom announced, `Enter` commits, `Esc` cancels            |
| `Alt + Enter`       | Commit the carried placement as a **move** rather than an addition ([§3.1.1](#311-a-commitment-across-several-teams)) |
| `r`                 | Resize mode — `←/→` step through sizes or ±1 unit with `Shift`                                                        |
| `d`                 | Draw dependency — arrows choose a target, `Enter` creates a `REQUIRES` dependency                                     |
| `f`                 | Expand dependency neighbourhood by one hop                                                                            |
| `+` / `−`           | Zoom level                                                                                                            |
| `g`                 | Commit Gate for the focused Idea                                                                                      |

**Every drag/drop interaction has a keyboard equivalent, and every keyboard equivalent produces the
same command.** A visual affordance without its keyboard path does not ship.

## 12. Accessibility contract

Target: **WCAG 2.2 AA** for the web content surface, plus a desktop keyboard/screen-reader matrix.

Requirements:

1. **Never colour alone.** Every state carries an icon, a pattern, and text.
   Over capacity → `+10 units · 120% ▲ Over capacity`, not a red cell.
   Blocked dependency → double stroke + ⛔ + "Blocked", not a red line.
2. **Contrast** ≥ 4.5:1 for text, ≥ 3:1 for UI components and graphical objects, in both themes.
   Enforced by a token-level contrast test.
3. **Focus visible** — 2 px focus ring with 3:1 contrast against both the object and its background;
   never removed, never clipped by an ancestor's `overflow`.
4. **Target size** ≥ 24 × 24 px for every interactive element (WCAG 2.2 AA 2.5.8); 44 × 44 px for
   primary actions.
5. **Canvas semantics** — the map is a `role="application"` region containing a `role="grid"` of
   team-quarter cells; each block is a `gridcell` child with an `aria-label` carrying name, units,
   lifecycle, and signal count. Selection changes announce through a polite live region.
6. **Dependency descriptions** are text, not shapes: _"SEPA instant payments requires Security
   review. Hard dependency. Needed by 15 November 2026. Status: at risk."_
7. **List companion** for every visual view, with identical data and totals.
8. **Reduced motion** honoured from the OS and overridable in settings.
9. **Zoom / reflow** — content usable at 200 % zoom without loss of function or horizontal scroll of
   the page.
10. **No keyboard trap** anywhere, including move mode, dependency drawing, and presentation mode.
11. **Announce consequences** — capacity changes, overflow, and rule outcomes announce through a
    live region as they happen, so a non-sighted user gets the same immediate feedback a sighted
    user gets from the block moving.

Verification: `axe-core` in CI on every view and every modal state; manual matrix of NVDA + Windows
narrator on Windows and VoiceOver on macOS, run per release gate; a keyboard-only pass of all nine
Playwright workflow paths.

## 13. First run and empty states

- First launch offers exactly two options: **Explore sample workspace** · **Create new workspace**.
- New workspace asks **name only**; timezone defaults to the user's local zone, current quarter to
  the calendar quarter. It then opens directly into the map.
- Progressive prompts (non-blocking, dismissible, reopenable) suggest: add a team, add a
  product/service, capture an Idea, import data. **No mandatory wizard.**
- First-run guidance is contextual tooltips pointing at real parts of the product, dismissible
  individually and reopenable from `?`. It is part of the product, not separate documentation.
- The sample workspace is visually marked, resettable, and never mistaken for real data.
