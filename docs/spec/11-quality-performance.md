# 11 — Quality, Testing & Performance

## 1. Toolchain

| Concern                            | Tool                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| Unit / integration                 | Vitest                                                              |
| Property / invariant               | fast-check                                                          |
| Component behaviour                | React Testing Library                                               |
| Workflow / E2E / visual regression | Playwright (browser target + Tauri WebView smoke)                   |
| Accessibility (automated)          | `axe-core` via `@axe-core/playwright`                               |
| Accessibility (manual)             | NVDA + Narrator (Windows), VoiceOver (macOS)                        |
| Performance                        | Playwright tracing + a custom benchmark harness                     |
| Static analysis                    | TypeScript `strict`, ESLint (incl. custom boundary rules), Prettier |
| Supply chain                       | `npm audit`, `cargo audit`, license scanning                        |

## 2. Coverage expectations

| Package            | Requirement                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@flowmap/domain`  | 100 % of command handlers have positive + negative tests; every `DomainErrorCode` provoked at least once; every invariant property-tested |
| `@flowmap/rules`   | Every rule code has ≥ 1 firing and ≥ 1 non-firing fixture; golden-file test over the validation fixture                                   |
| `@flowmap/storage` | Contract test suite passes for every provider, including the fault-injecting fake                                                         |
| `@flowmap/ui`      | Every interactive component has a keyboard test and an axe test                                                                           |
| `apps/desktop`     | The nine workflow paths (§4) plus a restart-persistence smoke test                                                                        |

Coverage percentages are not a target. **Named behaviours** are. A PR that adds a command without its
negative-path test is incomplete.

## 3. Invariants (fast-check properties)

Capacity & planning

1. `deliverableCapacity(tq) >= 0` always.
2. `committedLoad(tq)` equals the sum of counted footprint units — no other input affects it.
3. Refinement-reserve links change no capacity total.
4. `Σ` cell loads over any horizon equals the aggregate for that horizon.
5. `DONE` work contributes 0 in future quarters and its units in current/past quarters.
6. `HoldCommitment(preserveCapacity: true)` leaves headroom unchanged.
7. Changing the size mapping never changes an existing footprint's `units`.
8. Carry-over preserves the origin footprint and creates exactly one receiving footprint per
   confirmed proposal.

Commands & history 9. Every accepted command increments `entityVersion` on every entity it changes. 10. `changedFields` exactly equals the set of fields whose value differs before/after. 11. Applying a command's `inverse` restores the prior projection (for undoable commands). 12. Every meaningful change produces a `DomainEvent` with actor, command, timestamp, and refs. 13. Any workspace state reachable by import is reachable by commands. 14. No non-archived entity references a tombstoned entity without producing an `INT_DANGLING_REF`.

Scenarios 15. No sequence of scenario commands mutates baseline bytes. 16. A stale scenario cannot apply without a rebase. 17. Selective apply either applies the full dependency closure or is rejected. 18. `ApplyScenario` increments `Workspace.revision` exactly once.

Rules 19. `evaluateAll` is referentially transparent for fixed state + clock. 20. `evaluateIncremental` ≡ `evaluateAll` after any command sequence. 21. `signalKey` is stable across restart, machine, and export/import round trip. 22. Suppression never hides a signal whose severity increased.

Sync & portability 23. Applying the same synchronised mutation twice is idempotent. 24. Non-overlapping field edits auto-merge; overlapping edits produce a conflict. 25. Tombstones win over concurrent updates, and the losing author is told. 26. Portable export → import round-trips without semantic loss (projection equality **and**
rule-result equality under a fixed clock). 27. Migrations are monotonic, idempotent, and recoverable from the pre-migration backup.

Cycles & graphs 28. Dependency cycles remain representable and produce `DEP_CYCLE` rather than a validation failure.

## 4. Workflow tests (Playwright)

Nine paths, each run in **both** pointer and keyboard-only modes, each asserted with `axe`:

1. Create an Idea by Quick Capture, then progressively add planning context.
2. Place an Idea into a team-quarter and explain the resulting overflow.
3. Trace a commitment through its teams, products, dependencies, and milestones.
4. Review and snooze a Radar signal, then worsen its condition and see it break through.
5. Create, compare, rebase, and selectively apply a scenario.
6. Import a workspace, resolve mapping errors, and verify capacity totals.
7. Close a quarter and create carry-over.
8. Export, clear local data, restore, and compare.
9. Make conflicting offline edits from two clients and resolve them.

Visual regression snapshots are taken for the Portfolio Map, Demand Flow, Timeline, and Dependency
Map at all three zoom levels, in light and dark themes, with and without reduced motion.

## 5. Fixtures

### 5.1 Validation fixture (`fixtures/validation/`)

The single stable fictional dataset used for design, tests, demos, benchmarks, and the sample
workspace. Deterministic: fixed ULIDs, fixed dates, fixed clock (`2026-08-15T09:00:00Z`,
`Europe/Amsterdam`).

| Element                          | Count                                         |
| -------------------------------- | --------------------------------------------- |
| Teams                            | 5                                             |
| Products/services                | 5                                             |
| Commitments                      | 25, across every lifecycle state              |
| Ideas under refinement           | 10                                            |
| Reserves                         | 10 across 6 quarters                          |
| Dependencies                     | 30, including a decision hub with in-degree 6 |
| Carry-over items                 | 3                                             |
| Overloaded team-quarters         | 2                                             |
| High product change-load periods | 1                                             |
| Radar signals                    | 12, spanning different reasons and severities |
| Scenarios                        | 2, one of which becomes stale                 |
| Milestones                       | 12                                            |
| External links                   | 10, one per type                              |
| People                           | 8, of whom 2 are archived                     |

The fixture also contains at least one instance of every hard guardrail violation _attempt_ and every
advisory warning, as test material.

### 5.2 Scale fixtures

`fixtures/scale/{25,100,500}/` — deterministically generated from the validation fixture's shape,
scaling commitments, footprints, and dependencies proportionally (500 commitments ⇒ ~900 footprints,
~600 dependencies, ~3,000 history events).

### 5.3 Adversarial fixtures

`fixtures/edge/` — dependency cycles (2-node, 5-node, self-adjacent), a commitment spanning 6
quarters and 4 teams, zero deliverable capacity, reserves equal to capacity, maximum-length notes,
6 milestones, unicode and RTL names, 140-character names, archived entities with live references,
tombstoned targets, and a workspace at the previous schema version.

### 5.4 Import fixtures

`fixtures/import/` — clean XLSX, CSV with a BOM and semicolon separators, JSON, a file with unmapped
enum values, a file with duplicate names and no external keys, a file with unresolved cross-sheet
references, and a malicious ZIP (path traversal, zip bomb) that must be refused safely.

## 6. Performance

### 6.1 Reference hardware

Benchmarks are meaningless without it. Reference: a standard managed enterprise laptop —
4-core / 8-thread CPU, 16 GB RAM, integrated graphics, 1920 × 1080, on battery with the standard
security agent running. CI runs on nominally similar runners and reports _trend_; the gate is the
reference device, measured per release.

### 6.2 Budgets (500-commitment workspace)

| Interaction                                           | Budget                 |
| ----------------------------------------------------- | ---------------------- |
| Cold start to interactive Portfolio Map (local cache) | **≤ 2,000 ms**         |
| Warm workspace switch                                 | ≤ 800 ms               |
| Zoom-level change (L1↔L2↔L3)                          | ≤ 250 ms               |
| Pan / zoom frame time                                 | ≤ 16.7 ms p95 (60 fps) |
| Drag feedback (pointer-down to first visual response) | **≤ 100 ms**           |
| Drop → capacity recalculated and rendered             | ≤ 250 ms               |
| Incremental rule re-evaluation after one command      | ≤ 150 ms               |
| Full rule evaluation                                  | ≤ 1,200 ms             |
| Search keystroke → results                            | ≤ 120 ms               |
| Dependency-map neighbourhood expand (1 hop)           | ≤ 400 ms               |
| Scenario diff computation                             | ≤ 500 ms               |
| Import preview of 1,000 rows                          | ≤ 3,000 ms             |
| Memory, steady state                                  | ≤ 500 MB RSS           |

### 6.3 Techniques

- **Semantic zoom and aggregation** — never render 500 commitments in detail simultaneously. This is
  the primary technique; the rest are secondary.
- **Viewport virtualisation** for the grid, timeline rows, and every list companion.
- **Memoised projections** keyed by `ProjectionKey`, invalidated by `affectedProjections`.
- **Incremental rule evaluation** driven by the same keys.
- **Web Worker** for graph layout (ELK) and full rule evaluation; the main thread never blocks on
  either.
- **SVG/DOM first.** Canvas/WebGL only after a measured failure of the budget above, and only with a
  written accessibility plan for the replacement.
- **Structural sharing** in the projection store so React reference equality prunes re-renders.

### 6.4 Benchmark harness

`pnpm bench` runs a scripted Playwright session over the scale fixtures, recording each budgeted
interaction 20 times and reporting p50/p95. Results are committed as `bench/results/<version>.json`
so regressions are visible as diffs. A PR that regresses a p95 budget by > 10 % fails CI.

## 7. CI matrix

| Job                              | Runs on               | Triggers                                                     |
| -------------------------------- | --------------------- | ------------------------------------------------------------ |
| Lint + typecheck                 | ubuntu                | every push                                                   |
| Unit + property tests            | ubuntu                | every push                                                   |
| Provider contract tests          | ubuntu                | every push                                                   |
| Playwright workflows + axe       | ubuntu                | every push                                                   |
| Visual regression                | ubuntu                | every push                                                   |
| Windows build + desktop smoke    | windows-latest        | every push to main, every PR touching `apps/desktop` or Rust |
| macOS build + desktop smoke      | macos-latest          | same                                                         |
| Benchmarks                       | self-hosted reference | nightly + release candidates                                 |
| Security scan (audit + licenses) | ubuntu                | every push + weekly                                          |

Windows and macOS CI produce runnable artifacts from the first runnable desktop skeleton — not at
packaging time. Cross-platform breakage discovered at the end is the most expensive kind.

## 8. Definition of done

A change is done when **all** of these hold:

- [ ] Behaviour matches the spec section it implements (linked in the PR)
- [ ] Command path, keyboard path, and list-companion path all work
- [ ] Positive and negative tests exist; invariants added where the change introduces one
- [ ] All new user-visible strings have i18n keys with entries in every supported locale
- [ ] `axe` clean; focus order verified; announcements verified for state changes
- [ ] Error, empty, loading, offline, and conflict states are designed and implemented
- [ ] Tooltips exist for any new domain concept, in the definition / _is not_ / example format
- [ ] Migration impact assessed and, if any, written idempotently with a test
- [ ] Performance budget checked for any change touching the map, timeline, graph, or rules
- [ ] Design tokens used — no hard-coded colours, spacing, or type sizes
- [ ] Open questions and judgement calls listed in the PR description for review
