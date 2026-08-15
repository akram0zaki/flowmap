# Flowmap — Implementation Backlog

Ticket-level breakdown of [`execution-plan.md`](execution-plan.md). Organised by **vertical
capability**, not by technical layer — each ticket should leave the product measurably more usable.

**ID scheme:** `<MILESTONE>-<EPIC>-<n>`. **Size:** S ≈ days · M ≈ 1–2 wk · L ≈ 2–4 wk.
**Dep:** tickets that must land first.

**Status:** ✅ done · 🔵 in progress · ⬜ not started · ⏸ blocked on something outside the codebase

> This file is kept current as work lands. A ticket is ✅ only when its acceptance criteria pass and
> the [`AGENTS.md`](../../AGENTS.md) definition of done is met — not when the code merely exists.

**Progress:** M0 2/14 · **M1 22/22 — complete** · M2 12/28 · M3–M9 not started

Every ticket inherits the definition of done from [`AGENTS.md`](../../AGENTS.md). The acceptance
criteria below are the _additional_, ticket-specific ones.

---

## M0 — Spikes and decisions

| St  | ID       | Title                                                          | Size | Dep      | Acceptance                                                                                                             |
| --- | -------- | -------------------------------------------------------------- | :--: | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| ⏸   | M0-SPK-1 | Portable Tauri on managed Windows                              |  M   | —        | Does a signed `.exe` run from a user folder under AppLocker/WDAC? Is WebView2 present? Which Windows build?            |
| ⏸   | M0-SPK-2 | Portable Tauri on managed macOS                                |  M   | —        | Signed + notarised `.app`, unzipped to a user folder, passes Gatekeeper and runs                                       |
| ⏸   | M0-SPK-3 | Shared-folder behaviour                                        |  L   | —        | Propagation delay, conflict-copy naming, placeholder and read-only behaviour for the actual chosen folder              |
| ⬜  | M0-SPK-4 | Dependency-graph library bake-off                              |  M   | M0-FIX-1 | 500 nodes / 600 edges: layout ms, interaction p95, DOM accessibility, bundle size. Written recommendation + ADR-0010   |
| ⬜  | M0-SPK-5 | Portfolio Map layout alternatives                              |  M   | M0-FIX-1 | Two clickable low-fi prototypes tested with both pilot leads; chosen layout + rejected alternative + evidence recorded |
| ⬜  | M0-SPK-6 | Keyboard interaction model                                     |  S   | M0-SPK-5 | A lead completes select → move → resize → inspect by keyboard alone; timings recorded                                  |
| ⬜  | M0-SPK-7 | Benchmark harness + reference hardware                         |  S   | M0-FIX-2 | `pnpm bench` runs; reference device named; naive-render baselines recorded                                             |
| ✅  | M0-FIX-1 | Validation fixture                                             |  M   | —        | Exactly the counts in spec 11 §5.1; deterministic ULIDs and dates; loads in under 200 ms                               |
| ⬜  | M0-FIX-2 | Scale fixtures 25/100/500                                      |  S   | M0-FIX-1 | Deterministic generation; proportional footprints/dependencies/history                                                 |
| ⬜  | M0-FIX-3 | Edge + import fixtures                                         |  S   | M0-FIX-1 | Every case in spec 11 §5.3–5.4, including the malicious ZIP                                                            |
| ⏸   | M0-DEC-1 | Glossary validation with a business lead and a technology lead |  S   | —        | Every glossary term either survives or is changed; changes propagated to the spec                                      |
| ⏸   | M0-DEC-2 | Current-state QBR observation                                  |  S   | —        | Baseline recorded: prep time, source artifact count, reconciliation time, missed attention items                       |
| ⬜  | M0-DEC-3 | ADRs 0001–0010                                                 |  S   | spikes   | Each ADR states context, decision, consequences, and the condition that would reverse it                               |
| ✅  | M0-DEC-4 | Threat model + data classification                             |  S   | —        | Table of threats → controls → owners; accepted risks explicitly signed off                                             |

---

## M1 — Walking skeleton

**Complete.** One tested path runs from a UI command, through the pure domain, into local
persistence, and back to a rendered projection — on both the browser and Tauri targets.
251 unit/property tests, 7 end-to-end paths with axe, 4 Rust tests.

### Epic: Repository & toolchain

| St  | ID       | Title                                               | Size | Dep      | Acceptance                                                                                                        |
| --- | -------- | --------------------------------------------------- | :--: | -------- | ----------------------------------------------------------------------------------------------------------------- |
| ✅  | M1-REP-1 | pnpm workspace + project references + strict TS     |  S   | —        | `pnpm typecheck` passes across all packages; `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on       |
| ✅  | M1-REP-2 | ESLint: boundary rules + purity rules + token rules |  S   | M1-REP-1 | Importing React into `domain` fails lint; `Date.now()` in `rules` fails lint; a raw hex in a component fails lint |
| ✅  | M1-REP-3 | Vitest + fast-check + RTL + Playwright wiring       |  S   | M1-REP-1 | `pnpm test` (251) and `pnpm test:e2e` (7, axe-checked) both run                                                   |
| ✅  | M1-REP-4 | CI matrix: ubuntu + windows + macOS                 |  M   | M1-REP-3 | All three run on every push; both desktop targets typecheck and test                                              |
| ✅  | M1-REP-5 | i18n scaffolding + missing-key CI check             |  S   | M1-REP-1 | A component with a literal string fails lint; a key missing from a declared locale fails CI                       |
| ✅  | M1-REP-6 | Design tokens wired into the app                    |  S   | M1-REP-1 | `tokens.css` loaded; theme/contrast/motion/density switching works via `applyTheme`                               |
| ✅  | M1-REP-7 | Token contrast test                                 |  S   | M1-REP-6 | Every documented fg/bg pair asserted ≥ 4.5:1 (text) / 3:1 (graphical), light + dark + high contrast               |

### Epic: Domain foundation

| St  | ID       | Title                                          | Size | Dep      | Acceptance                                                                                                 |
| --- | -------- | ---------------------------------------------- | :--: | -------- | ---------------------------------------------------------------------------------------------------------- |
| ✅  | M1-DOM-1 | Ids, clock, envelope, versioning, error model  |  S   | M1-REP-1 | ULID generator injected; `Clock` injected; every `DomainErrorCode` has an i18n key                         |
| ✅  | M1-DOM-2 | Quarter value type + arithmetic                |  S   | M1-DOM-1 | `ordinal`, next/prev, horizon windows, date↔quarter derivation; property-tested over ±50 years             |
| ✅  | M1-DOM-3 | Command contract + handler pipeline            |  M   | M1-DOM-1 | Fixed validation order; `CommandEffects` complete incl. `changedFields` and `affectedProjections`          |
| ✅  | M1-DOM-4 | Workspace, Team, TeamQuarter, Reserve entities |  M   | M1-DOM-3 | Schemas + Zod; reserve invariants enforced; refinement reserve seeded by default                           |
| ✅  | M1-DOM-5 | Commitment + lifecycle transition table        |  M   | M1-DOM-4 | Every legal transition tested; every illegal transition rejected with `ILLEGAL_LIFECYCLE_TRANSITION`       |
| ✅  | M1-DOM-6 | CapacityFootprint + footprint commands         |  M   | M1-DOM-5 | Assign/move/resize/remove/split; uniqueness and `units > 0` enforced                                       |
| ✅  | M1-DOM-7 | Capacity projection                            |  M   | M1-DOM-6 | Reproduces spec 02 §2.2 exactly; invariants 1–8 from spec 11 §3 property-tested                            |
| ✅  | M1-DOM-8 | Size mapping resolution                        |  S   | M1-DOM-7 | Units frozen at creation; `XL` rejected without explicit units; mapping change never alters existing units |

### Epic: Persistence

| St  | ID       | Title                                              | Size | Dep      | Acceptance                                                                                                |
| --- | -------- | -------------------------------------------------- | :--: | -------- | --------------------------------------------------------------------------------------------------------- |
| ✅  | M1-STO-1 | Repository + provider contracts                    |  M   | M1-DOM-3 | Contract test suite exists and is runnable against a fake                                                 |
| ✅  | M1-STO-2 | Migration framework                                |  M   | M1-STO-1 | Forward-only, idempotent, transactional, checksummed; re-running an applied migration is a no-op (tested) |
| ✅  | M1-STO-3 | SQLite schema + indexes + pragmas                  |  M   | M1-STO-2 | Every index in spec 07 §2 present; WAL + foreign keys on                                                  |
| ✅  | M1-STO-4 | Local repository with transactional `apply`        |  M   | M1-STO-3 | Changes, events, and outbox written in one transaction; kill-mid-apply leaves a consistent DB             |
| ✅  | M1-STO-5 | Outbox + Local provider running the full sync path |  M   | M1-STO-4 | Single-user local workspaces exercise pull/push/conflict code paths                                       |
| ✅  | M1-STO-6 | Pre-migration backup + restore path                |  S   | M1-STO-2 | Simulated migration failure offers and completes a restore                                                |
| ✅  | M1-STO-7 | Cloud-sync-folder guard                            |  S   | M1-STO-3 | Opening a DB inside OneDrive/iCloud/Dropbox refuses with an explanation and a logged override             |

### Epic: First vertical slice

| St  | ID      | Title                                                            | Size | Dep                | Acceptance                                                                                   |
| --- | ------- | ---------------------------------------------------------------- | :--: | ------------------ | -------------------------------------------------------------------------------------------- |
| ✅  | M1-VS-1 | Tauri shell + typed IPC bridge                                   |  M   | M1-REP-4           | Allowlisted `QueryId` only; Zod on the TS side, serde on the Rust side; CSP enforced         |
| ✅  | M1-VS-2 | Browser development mode                                         |  S   | M1-VS-1            | `pnpm dev` runs the full app against an in-memory repository without the shell               |
| ✅  | M1-VS-3 | `CapacityVessel` component                                       |  M   | M1-REP-6, M1-DOM-7 | Renders plinth, blocks, rule, tick scale, overflow spill; `axe` clean; keyboard focusable    |
| ✅  | M1-VS-4 | Create commitment → assign footprint → persist → reload → render |  M   | M1-STO-4, M1-VS-3  | The round trip works and is covered by a Playwright restart-persistence test                 |
| ✅  | M1-VS-5 | List companion with matching totals                              |  S   | M1-VS-4            | Totals provably equal the projection; asserted by test                                       |
| ✅  | M1-VS-6 | Undo for the implemented commands                                |  S   | M1-DOM-3           | Inverse commands re-validated on execution; illegal undo refused with an explanation         |
| ✅  | M1-VS-7 | Error boundary, diagnostics, clear-local-data                    |  S   | M1-VS-1            | Diagnostics export contains no secrets (asserted); clear-local-data confirmed and complete   |
| ✅  | M1-VS-8 | Local profile for history attribution                            |  S   | M1-DOM-1           | Profile id survives restart and can later be linked to an identity without rewriting history |

---

## M2 — Physical portfolio

### Epic: Portfolio Map

| St  | ID       | Title                                                  | Size | Dep      | Acceptance                                                                                              |
| --- | -------- | ------------------------------------------------------ | :--: | -------- | ------------------------------------------------------------------------------------------------------- |
| 🔵  | M2-MAP-1 | Canvas primitives: viewport, pan, zoom, hit-testing    |  M   | M1-VS-3  | 60 fps pan/zoom at 500 commitments; hit areas ≥ 24 px even for XS blocks                                |
| ✅  | M2-MAP-2 | Quarter columns + team rows + current-quarter centring |  M   | M2-MAP-1 | Alphabetical default order; Planner reorder persists; pressure never reorders rows                      |
| ✅  | M2-MAP-3 | Semantic zoom L1/L2/L3 + explicit level control        |  L   | M2-MAP-2 | Level thresholds per spec 06 §3.3; level changes announced; ≤ 250 ms                                    |
| ✅  | M2-MAP-4 | Reserve plinth with per-type segments and labels       |  S   | M2-MAP-2 | Each reserve type uses its own pattern token; tooltip lists linked Ideas for refinement                 |
| ✅  | M2-MAP-5 | Overflow spill + units/percent/glyph label             |  S   | M2-MAP-4 | Never colour alone; matches the projection exactly                                                      |
| ✅  | M2-MAP-6 | Focus mode                                             |  M   | M2-MAP-3 | Unrelated content to 25 %; related footprints, products, dependencies, milestones emphasised; announced |
| ✅  | M2-MAP-7 | Ideas/Demand lane + refinement links                   |  M   | M2-MAP-2 | Ideas never occupy capacity blocks; links render as connector markers; links change no total            |
| ✅  | M2-MAP-8 | Lens switcher + filter chips (fade, not remove)        |  M   | M2-MAP-3 | Filtering preserves spatial context; "hide filtered" toggle available                                   |
| ⬜  | M2-MAP-9 | Scale rendering tests 25/100/500                       |  S   | M2-MAP-3 | Budgets from spec 11 §6.2 met on reference hardware                                                     |

### Epic: Commitment model in the UI

| St  | ID        | Title                                               | Size | Dep       | Acceptance                                                                                                             |
| --- | --------- | --------------------------------------------------- | :--: | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| ✅  | M2-COM-1  | Quick Capture (inline, title only)                  |  S   | M2-MAP-7  | Idea created in < 5 s, keyboard only, no modal                                                                         |
| ⬜  | M2-COM-2  | Progressive detail panel                            |  L   | M2-COM-1  | All sections from spec 06 §8; empty sections show an "Add…" affordance                                                 |
| ⬜  | M2-COM-3  | Three-part tooltips for every domain concept        |  M   | M2-COM-2  | Definition · what it is not · example, on every capacity/lifecycle/impact/dependency/health/attention/confidence field |
| ⬜  | M2-COM-4  | Visual quarter strip for target selection           |  S   | M2-COM-2  | No target-quarter dropdown in any primary flow; direct date entry derives the quarter                                  |
| ⬜  | M2-COM-5  | Multi-team / multi-quarter footprint editing        |  M   | M2-MAP-1  | Drag between cells; split across quarters; primary-footprint invariant enforced                                        |
| ⬜  | M2-COM-6  | Product impacts + themes                            |  M   | M2-COM-2  | Single-`PRIMARY` invariant enforced with a clear error                                                                 |
| ⬜  | M2-COM-7  | Milestones (≤ 6)                                    |  S   | M2-COM-2  | Cap enforced; milestones render on blocks                                                                              |
| ⬜  | M2-COM-8  | Typed external links                                |  S   | M2-COM-2  | HTTPS only; opens in the system browser; never embedded                                                                |
| ⬜  | M2-COM-9  | Dependencies: draw, retype, retarget                |  M   | M2-MAP-6  | Visual creation defaults to `REQUIRES`; direction never flips; cycles allowed                                          |
| 🔵  | M2-COM-10 | Commit Gate: hard + advisory guardrails             |  M   | M2-COM-5  | Hard checks block with specific errors; advisory checks render as a dismissible checklist                              |
| ⬜  | M2-COM-11 | Capture unplanned work (batched three-command path) |  S   | M2-COM-10 | Single action; never creates directly in `IN_DELIVERY`                                                                 |
| ⬜  | M2-COM-12 | Carry-over rendering                                |  S   | M2-MAP-4  | Cross-hatch + "Carried from <Q>" label; origin footprint preserved                                                     |

### Epic: Interaction & accessibility

| St  | ID        | Title                                               | Size | Dep       | Acceptance                                                                          |
| --- | --------- | --------------------------------------------------- | :--: | --------- | ----------------------------------------------------------------------------------- |
| ✅  | M2-A11Y-1 | Canvas grid semantics + roving tabindex             |  M   | M2-MAP-1  | `role="grid"`, `gridcell` per block, labels carry name/units/lifecycle/signal count |
| ⬜  | M2-A11Y-2 | Move mode                                           |  M   | M2-A11Y-1 | Arrows choose target; live headroom announced; `Enter` commits; `Esc` restores      |
| ⬜  | M2-A11Y-3 | Resize mode + keyboard dependency drawing           |  S   | M2-A11Y-2 | Same command emitted as the pointer path                                            |
| ✅  | M2-A11Y-4 | Live-region announcements for capacity consequences |  S   | M2-A11Y-2 | Overflow, headroom change, and rule outcomes announced as they happen               |
| ✅  | M2-A11Y-5 | List companion for every M2 view                    |  M   | M2-MAP-8  | `Ctrl/Cmd + L`; totals match; sortable; exportable                                  |
| ⬜  | M2-A11Y-6 | Reduced motion + high contrast verified end to end  |  S   | M1-REP-6  | No state cue lost with motion at 0 ms; high contrast raises every signal fg ≥ 7:1   |
| ✅  | M2-A11Y-7 | `axe` in CI across every view and modal state       |  S   | M1-REP-3  | Zero violations; failures block merge                                               |

---

## M3 — Radar and rules

| St  | ID        | Title                                                      | Size | Dep                | Acceptance                                                                                  |
| --- | --------- | ---------------------------------------------------------- | :--: | ------------------ | ------------------------------------------------------------------------------------------- |
| ⬜  | M3-RUL-1  | Rules engine core + rule clock + declared projection reads |  M   | M1-DOM-7           | Pure; referentially transparent; golden-file test over the validation fixture               |
| ⬜  | M3-RUL-2  | Incremental evaluation                                     |  M   | M3-RUL-1           | `evaluateIncremental` ≡ `evaluateAll` (property-tested); ≤ 150 ms after one command         |
| ⬜  | M3-RUL-3  | Capacity rules                                             |  S   | M3-RUL-1           | All seven codes; firing + non-firing fixtures each                                          |
| ⬜  | M3-RUL-4  | Dependency rules incl. cycle and hub detection             |  M   | M3-RUL-1, M2-COM-9 | All thirteen codes; cycle detection ≤ 100 ms at 600 dependencies                            |
| ⬜  | M3-RUL-5  | Timing rules                                               |  S   | M3-RUL-1           | All twelve codes; all comparisons in workspace timezone                                     |
| ⬜  | M3-RUL-6  | Readiness, ownership, health rules                         |  M   | M3-RUL-1           | `OWN_MISSING` provably does not fire on a newly captured Idea                               |
| ⬜  | M3-RUL-7  | Product change-load calculation                            |  M   | M2-COM-6           | Formula exactly as spec 04 §5; contributor breakdown rendered                               |
| ⬜  | M3-RUL-8  | Signal identity + condition fingerprints                   |  M   | M3-RUL-1           | Keys stable across restart, machine, and export/import round trip                           |
| ⬜  | M3-RUL-9  | Dispositions: review, snooze, breakthrough                 |  M   | M3-RUL-8           | Severity increase always breaks through (property-tested); no permanent dismissal exists    |
| ⬜  | M3-RUL-10 | Radar view: modes, grouping, rows, quick actions           |  L   | M3-RUL-9           | Grouping order fixed per spec 04 §6.2; My Radar contains only explicit individual ownership |
| ⬜  | M3-RUL-11 | Explanation panel                                          |  M   | M3-RUL-10          | Facts, threshold, why it matters, what changed, actions — all rendered from data            |
| ⬜  | M3-RUL-12 | Threshold settings with live signal counts                 |  M   | M3-RUL-1           | Ranges validated; reset-to-defaults per rule and globally                                   |
| ⬜  | M3-RUL-13 | Secret-pattern detection                                   |  S   | M2-COM-2           | Every pattern in spec 04 §4.8 detected; matched text never transmitted                      |
| ⬜  | M3-RUL-14 | Health vs attention projections                            |  S   | M3-RUL-6           | Separate; health cannot be dismissed by a user                                              |

---

## M4 — Scenario and QBR loop

| St  | ID       | Title                                                      | Size | Dep                | Acceptance                                                                                    |
| --- | -------- | ---------------------------------------------------------- | :--: | ------------------ | --------------------------------------------------------------------------------------------- |
| ⬜  | M4-SCN-1 | Branded baseline/scenario projections                      |  M   | M1-DOM-3           | A scenario command at a baseline write path is a compile error **and** a runtime rejection    |
| ⬜  | M4-SCN-2 | Scenario entity + command overlay + replay                 |  M   | M4-SCN-1           | Property test: no scenario command mutates baseline bytes                                     |
| ⬜  | M4-SCN-3 | Scenario lifecycle: create, clone, share, discard          |  S   | M4-SCN-2           | Private by default; sharing always explicit                                                   |
| ⬜  | M4-SCN-4 | Ghost footprints for Ideas                                 |  M   | M4-SCN-2, M2-MAP-7 | Baseline lifecycle unchanged; separate `scenarioLoad` band; tentative signals never notified  |
| ⬜  | M4-SCN-5 | Scenario diff                                              |  L   | M4-SCN-2           | All groups in spec 05 §4; ≤ 500 ms at target scale                                            |
| ⬜  | M4-SCN-6 | Side-by-side comparison view + textual diff list           |  M   | M4-SCN-5           | Both keyboard-navigable; the list is the accessible companion                                 |
| ⬜  | M4-SCN-7 | Rebase + conflict classification and resolution            |  L   | M4-SCN-5           | `CLEAN/REDUNDANT/OBSOLETE/CONFLICT`; stale scenario cannot apply (property-tested)            |
| ⬜  | M4-SCN-8 | Apply: whole (default) + selective with closure validation |  L   | M4-SCN-7           | Transactional; `revision` increments exactly once; missing prerequisites offered in one click |
| ⬜  | M4-QBR-1 | Demand Flow view: lane → pipe → gate → containers          |  L   | M2-MAP-7, M4-SCN-4 | Drop feedback ≤ 100 ms; carry-over and new demand grouped separately                          |
| ⬜  | M4-QBR-2 | Trade-off panel for overflow                               |  M   | M3-RUL-3           | Excess, constrained, movable, cross-team, product, dependency effects; ranks nothing          |
| ⬜  | M4-QBR-3 | Consequence preview                                        |  M   | M4-SCN-5           | Fires only on the measured triggers; summary with drill-down; fixed action position           |
| ⬜  | M4-QBR-4 | Presentation mode                                          |  M   | M2-MAP-3           | Editing blocked with an explanation; type up one step; focus rings thickened                  |
| ⬜  | M4-QBR-5 | Undo barriers + auto-snapshot before barrier commands      |  S   | M1-VS-6            | Every barrier command snapshots first and states that it cannot be undone                     |

---

## M5 — Lenses, history, quarter close

| St  | ID       | Title                                                   | Size | Dep      |
| --- | -------- | ------------------------------------------------------- | :--: | -------- |
| ⬜  | M5-TML-1 | Timeline: axis, presets, fragments per footprint        |  L   | M2-MAP-3 |
| ⬜  | M5-TML-2 | Milestones and carry-over on the timeline               |  S   | M5-TML-1 |
| ⬜  | M5-DEP-1 | Dependency Map: layered layout in a worker              |  L   | M0-SPK-4 |
| ⬜  | M5-DEP-2 | Hub emphasis, neighbourhood expansion, cycle badges     |  M   | M5-DEP-1 |
| ⬜  | M5-DEP-3 | Dependency table + per-node text descriptions           |  M   | M5-DEP-1 |
| ⬜  | M5-PRD-1 | Products view + change-load strip + breakdown           |  M   | M3-RUL-7 |
| ⬜  | M5-SRC-1 | Local search index (FTS) + `Ctrl/Cmd + K` palette       |  M   | M1-STO-3 |
| ⬜  | M5-SRC-2 | Composable filter chips across all views                |  M   | M2-MAP-8 |
| ⬜  | M5-HIS-1 | Domain history view                                     |  M   | M1-DOM-3 |
| ⬜  | M5-HIS-2 | Quarter review draft + judgement inputs                 |  M   | M5-HIS-1 |
| ⬜  | M5-HIS-3 | Carry-over proposal + Planner confirmation              |  M   | M5-HIS-2 |
| ⬜  | M5-HIS-4 | Close quarter (auto-snapshot, freeze, advance) + reopen |  M   | M5-HIS-3 |
| ⬜  | M5-HIS-5 | History rules + explainable recommendations             |  M   | M5-HIS-4 |
| ⬜  | M5-HIS-6 | Recurrence metadata + manual duplication                |  S   | M2-COM-2 |

## M6 — Portability and workspaces

| St  | ID       | Title                                                 | Size | Dep       |
| --- | -------- | ----------------------------------------------------- | :--: | --------- |
| ⬜  | M6-IMP-1 | Parsers: XLSX, CSV, JSON                              |  M   | M1-DOM-3  |
| ⬜  | M6-IMP-2 | Guided mapping + saved mappings + enum value tables   |  L   | M6-IMP-1  |
| ⬜  | M6-IMP-3 | External-key matching + duplicate preview             |  M   | M6-IMP-2  |
| ⬜  | M6-IMP-4 | Validation + transactional apply + error CSV          |  M   | M6-IMP-3  |
| ⬜  | M6-EXP-1 | Exports: view, workspace, Radar, quarter review       |  M   | M2-A11Y-5 |
| ⬜  | M6-POR-1 | `.flowmap` package + hash + sensitivity warning       |  M   | M6-EXP-1  |
| ⬜  | M6-POR-2 | Round-trip property test (projection + rule equality) |  S   | M6-POR-1  |
| ⬜  | M6-SNP-1 | Snapshots: manual + automatic-before-barrier          |  M   | M6-POR-1  |
| ⬜  | M6-SNP-2 | Restore with `RestoreReport` and typed confirmation   |  M   | M6-SNP-1  |
| ⬜  | M6-WSP-1 | Multiple workspaces + switcher + smart defaults       |  M   | M1-DOM-4  |
| ⬜  | M6-WSP-2 | Sample workspace, marked and resettable               |  S   | M6-WSP-1  |
| ⬜  | M6-WSP-3 | Archive/restore + referential-integrity policy        |  M   | M1-DOM-5  |
| ⬜  | M6-WSP-4 | Saved views                                           |  S   | M2-MAP-8  |
| ⬜  | M6-WSP-5 | First-run guidance tooltips                           |  M   | M6-WSP-2  |
| ⬜  | M6-OPS-1 | Corrupted-cache recovery + rollback tests             |  M   | M1-STO-6  |
| ⬜  | M6-NOT-1 | Foreground notifications, coalesced and configurable  |  M   | M3-RUL-10 |
| ⬜  | M6-SEC-1 | Command-level permission harness                      |  M   | M1-DOM-3  |

## M7 — Desktop packaging

| St  | ID       | Title                                                                                   | Size | Dep                |
| --- | -------- | --------------------------------------------------------------------------------------- | :--: | ------------------ |
| ⬜  | M7-PKG-1 | Portable Windows ZIP + Authenticode-signed `Flowmap.exe`                                |  M   | M0-SPK-1           |
| ⬜  | M7-PKG-2 | Second Windows ZIP embedding the fixed-version WebView2 runtime                         |  S   | M7-PKG-1           |
| ⬜  | M7-PKG-3 | macOS ZIP: signed `.app` + notarisation + stapling                                      |  M   | M0-SPK-2           |
| ⬜  | M7-PKG-4 | Portable data-directory resolution (env → `./data/` → app-data), path shown in Settings |  M   | M1-VS-1            |
| ⬜  | M7-PKG-5 | Startup check: missing WebView2 explains itself and names the standalone build          |  S   | M7-PKG-1           |
| ⬜  | M7-PKG-6 | Unzip-and-run verification on managed devices, both platforms                           |  M   | M7-PKG-1, M7-PKG-3 |
| ⬜  | M7-PKG-7 | Native menus, shortcuts, clear-local-data                                               |  S   | M1-VS-1            |
| ⬜  | M7-PKG-8 | Distribution + rollback runbook, release-note format                                    |  S   | M7-PKG-6           |

## M8 — Shared provider and sync

| St  | ID       | Title                                                                                       | Size | Dep      |
| --- | -------- | ------------------------------------------------------------------------------------------- | :--: | -------- |
| ⬜  | M8-PRV-1 | Capability-aware provider contract hardened + contract suite                                |  M   | M1-STO-1 |
| ⬜  | M8-PRV-2 | File provider: versioned `.flowmap` document, read → version check → atomic replace         |  L   | M8-PRV-1 |
| ⬜  | M8-PRV-3 | Conflict-copy detection and recovery (`* (1).flowmap`, `*-<machine>.flowmap`)               |  M   | M8-PRV-2 |
| ⬜  | M8-PRV-4 | Files-on-demand placeholder materialisation; read-only-share handling                       |  M   | M8-PRV-2 |
| ⬜  | M8-SYN-1 | Pull cursor, pagination, resumable apply                                                    |  M   | M8-PRV-1 |
| ⬜  | M8-SYN-2 | Idempotent write, retries, backoff                                                          |  M   | M8-SYN-1 |
| ⬜  | M8-SYN-3 | Field-level merge + conflict rows                                                           |  L   | M8-SYN-2 |
| ⬜  | M8-SYN-4 | Conflict resolution UI                                                                      |  M   | M8-SYN-3 |
| ⬜  | M8-SYN-5 | Sync status showing last-known-remote time, pending and conflict counts                     |  S   | M8-SYN-2 |
| ⬜  | M8-SYN-6 | Multi-client + fault-injection harness (kill mid-write, concurrent writers, share vanishes) |  L   | M8-SYN-3 |
| ⬜  | M8-SYN-7 | Read-only-share and vanished-share recovery paths                                           |  M   | M8-PRV-4 |
| ⬜  | M8-COL-1 | Role authorisation enforced in the domain                                                   |  M   | M6-SEC-1 |
| ⬜  | M8-COL-2 | UI copy stating plainly that roles are advisory and folder permissions are the boundary     |  S   | M8-COL-1 |
| ⬜  | M8-COL-3 | Shared baseline + shared scenario publication                                               |  M   | M4-SCN-3 |

## M9 — Enterprise readiness

| St  | ID        | Title                                            | Size | Dep         |
| --- | --------- | ------------------------------------------------ | :--: | ----------- |
| ⬜  | M9-SEC-1  | Security review with evidence and owners         |  L   | M8 complete |
| ⬜  | M9-SEC-2  | Dependency + license scanning in CI              |  S   | M1-REP-4    |
| ⬜  | M9-A11Y-1 | WCAG 2.2 AA evidence pack                        |  M   | M6 complete |
| ⬜  | M9-A11Y-2 | Desktop keyboard/screen-reader matrix executed   |  M   | M7-PKG-3    |
| ⬜  | M9-PRF-1  | Target-scale performance + soak results          |  M   | M0-SPK-7    |
| ⬜  | M9-OPS-1  | Recovery, corrupted-cache, conflict, DR drills   |  M   | M8-SYN-7    |
| ⬜  | M9-OPS-2  | Data lifecycle, deletion, offboarding procedures |  S   | M6-WSP-3    |
| ⬜  | M9-DOC-1  | User, admin, and support documentation           |  M   | —           |
| ⬜  | M9-OPS-3  | Automatic update — only if policy permits        |  M   | M7-PKG-5    |

---

## Cross-cutting, every milestone

These are not tickets to schedule; they are conditions on every ticket.

- Keyboard path and list companion for every visual interaction
- i18n keys for every user-visible string, in every declared locale
- Positive and negative tests; a property test whenever an invariant is touched
- `axe` clean; focus order and announcements verified
- Idempotent migrations with a re-run test
- Performance budget checked for anything touching map, timeline, graph, or rules
- Design tokens only — no raw values
- `## Open questions` and `## Decisions taken` on every PR
