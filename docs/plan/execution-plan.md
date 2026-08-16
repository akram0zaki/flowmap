# Flowmap — Execution Plan

How the spec gets built, in what order, and what has to be true before each step is called done.

**No calendar estimates.** Sequencing and exit gates are fixed; dates are set once team size,
target-environment access, and decision turnaround are known. Sizes below are relative
(**S** ≈ a few days · **M** ≈ 1–2 weeks · **L** ≈ 2–4 weeks · **XL** ≈ over a month), for one
experienced full-stack engineer.

## Sequencing at a glance

```
 M0  Spikes & decisions          ──┐
 M1  Walking skeleton              │  Gate A: build & decide
 M2  Physical portfolio          ──┤
 M3  Radar & rules                 │  ► Product Validation Alpha
 M4  Scenario & QBR loop         ──┘
 M5  Lenses, history, quarter close ┐
 M6  Portability & workspaces        │  ► Pilot MVP
 M7  Desktop packaging            ──┘
 M8  Shared provider & sync       ──►  Shared Collaboration Beta
 M9  Enterprise readiness         ──►  Shared Production Release
```

M0 spikes run **in parallel** with M1 where they do not block it. M8 is the only milestone with a
hard external prerequisite (written approval of the identity and storage design).

---

## M0 — Spikes and decisions

**Objective:** retire the assumptions that can invalidate the product or the architecture. Nothing
in M0 produces production code.

| #   | Spike                                    | Question it answers                                                                                                        | Size | Fallback if it fails                           |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------- |
| S-1 | Tauri on managed **Windows**             | Does an unsigned-then-signed Tauri app install and run without admin rights? WebView2 present? Proxy/TLS inspection?       | M    | Electron shell, same React app and IPC surface |
| S-2 | Tauri on managed **macOS**               | Same, plus notarisation and Gatekeeper                                                                                     | M    | As above                                       |
| S-3 | **SharePoint / Graph**                   | The ten questions in [spec 08 §4.6](../spec/08-providers.md#46-spike-questions-must-be-answered-before-implementation)     | L    | File provider ships as the shared provider     |
| S-4 | **Graph library** for the Dependency Map | React Flow + ELK vs Cytoscape at 500 nodes / 600 edges — layout time, interaction latency, accessibility of the DOM output | M    | Custom SVG layered renderer over ELK           |
| S-5 | **Portfolio Map layout**                 | Two low-fidelity alternatives tested with the validation fixture and both pilot leads                                      | M    | — (this one must produce an answer)            |
| S-6 | **Keyboard interaction model**           | Can a lead select, move, resize, and inspect blocks by keyboard alone at a usable speed?                                   | S    | —                                              |
| S-7 | **Benchmark protocol**                   | Reference hardware named; harness runs; budgets confirmed reachable at 500 commitments with a naive renderer               | S    | Revise budgets with evidence, not vibes        |

Also in M0:

- Observe and document one real QBR preparation and meeting; record the baseline (preparation time,
  number of source artifacts, reconciliation time, missed/late attention items).
- Validate the glossary with **both** a business lead and a technology lead: _commitment, footprint,
  reserve, health, attention, carry-over, Commit Gate, change load_. Terminology that does not
  survive this conversation gets changed now, not after it is in 200 files.
- Build the **validation fixture** ([spec 11 §5.1](../spec/11-quality-performance.md#51-validation-fixture-fixturesvalidation)).
- Write ADRs 0001–0010.
- Threat model and management-data classification.

**Gate A — exit criteria**

- [ ] Both pilot leads can explain the capacity vessel and complete the idea-placement task on paper
- [ ] The chosen Portfolio Map layout is recorded with the rejected alternative and the evidence
- [ ] Desktop feasibility has no unidentified policy blocker (or the Electron fallback is chosen)
- [ ] Shared storage has a credible approved path, **or** is explicitly removed from the pilot release
- [ ] Every resolved contradiction in [spec README](../spec/README.md#contradictions-resolved-against-the-concept-pack) is accepted or amended
- [ ] Benchmark reference hardware is named and the harness runs

---

## M1 — Walking skeleton ✅ **complete**

**Objective:** one tested path from a UI command, through the pure domain, into local persistence,
and back to a rendered projection. Thin, but complete and honest.

Deliverables:

- pnpm workspace, TypeScript project references, strict config, ESLint boundary + token rules,
  Prettier, Vitest, Playwright, Turborepo, CI on ubuntu **and** Windows **and** macOS from day one
- Tauri shell with a browser development mode (`pnpm dev` works without the shell)
- `@flowmap/domain`: ids, quarters, clock, envelope, versioning, error model, command contract
- Entities: Workspace, Team, TeamQuarter, Reserve (incl. refinement), Commitment, CapacityFootprint
- Commands: `CreateWorkspace`, `CreateTeam`, `EnsureTeamQuarter`, `CreateIdea`,
  `AssignCapacityFootprint`, `MoveCapacityFootprint`, `ResizeCapacityFootprint`
- Capacity projection with the full arithmetic from [spec 02 §2](../spec/02-capacity-model.md#2-capacity-arithmetic)
- `@flowmap/storage` contracts + migration framework; `@flowmap/storage-local` SQLite repository,
  outbox, and the **Local provider running the full sync path** (so sync is exercised from day one)
- Local profile for history attribution
- Design tokens wired; one accessible `CapacityVessel` rendering real data
- Error boundary, structured local diagnostics, clear-local-data
- Fixture loader for the validation fixture

**Gate B — exit criteria**

- [x] Restarting the app preserves the workspace with no semantic loss
      — SQLite round trip test + Playwright reload path
- [x] Invalid commands cannot bypass invariants through the UI or repository APIs
      — authorisation and invariants live in the domain; the store has no other write path
- [ ] **Export/import round-trip** — deferred to M6 with the `.flowmap` format (`M6-POR-2`).
      Nothing in M1 produces a portable package, so there was no format to round-trip
- [x] Windows and macOS CI produce runnable artifacts
- [x] The capacity worked example in [spec 02 §2.2](../spec/02-capacity-model.md#22-worked-example)
      reproduces exactly, in the app and in a test

**Delivered:** 251 unit and property tests, 7 end-to-end paths (each axe-checked, one keyboard-only),
4 Rust tests, a 4 MB signed-able macOS binary, and a working browser target.

> **Stop here and review.** Re-plan M2 with measured velocity and the M0 findings before continuing.

---

## M2 — Physical portfolio 🔵 **built; Gate C not yet passed**

**Objective:** a lead can model and understand a real portfolio visually.

Deliverables:

- Portfolio Map: quarter columns, team rows, capacity vessels, reserve plinths, overflow spill
- Three semantic zoom levels with the explicit level control
- Ideas/Demand lane + refinement-reserve links
- Commitment blocks; multi-team and multi-quarter footprints; carry-over rendering
- Visual quarter-strip target selection (**no target-quarter dropdown anywhere in a primary flow**)
- Product/service impacts and themes
- Focus mode with related teams, products, footprints, and dependencies
- Progressive commitment detail panel; inline Quick Capture; typed external links; milestones
- Lifecycle commands and Commit Gate with hard + advisory guardrails
- Fast "capture unplanned work" path (`CreateIdea → PassCommitGate → StartDelivery` as one batch)
- Keyboard model complete: move, resize, draw dependency, zoom, focus
- List companion with totals that provably match the visual
- Undo/redo with barrier semantics
- Tooltips for every domain concept, in the three-part format
- 25 / 100 / 500-commitment rendering tests

**Gate C — exit criteria**

- [ ] A pilot lead models the agreed real portfolio without any execution-task data
- [ ] A new user identifies the overloaded team, the affected product, and a commitment's footprints
      from the sample workspace **without documentation**
- [x] Capacity totals agree between the visual, the list companion, and the domain projection
- [ ] Cold start ≤ 2 s and drag feedback ≤ 100 ms at 500 commitments on reference hardware
- [x] Every board interaction has a working keyboard path; `axe` clean

> The three unchecked boxes need people and hardware, not code. Two are
> observation sessions with a lead; the third is a measurement on the reference
> device, which spec 11 §6.1 makes the gate and says CI cannot stand in for. The
> board itself is built — see the backlog for the eight items carried out of M2
> with their specific gaps.

**► Product Validation Alpha, part 1**

---

## M3 — Radar and explainable rules

**Objective:** the app can be trusted as management memory.

Deliverables:

- `@flowmap/rules`: evaluation API, incremental evaluation, rule clock abstraction
- The full rule catalogue from [spec 04 §4](../spec/04-rules-radar.md#4-rule-catalog) — capacity,
  dependency, timing, readiness, ownership, health, product, integrity (history rules land in M5)
- Separate health and attention projections
- Stable signal identity, condition fingerprints, persisted review/snooze dispositions
- My Radar and Team/Portfolio Radar with explicit owner resolution
- Explanation panel: facts, threshold, severity, what changed, actions
- Product change-load calculation with the contributor breakdown
- Workspace threshold configuration with validation, live signal counts, and reset-to-defaults
- Secret-pattern detection on note paste and save

**Gate D — exit criteria**

- [ ] Every signal in Radar has a deterministic explanation and a reproduction test
- [ ] Review and snooze never hide a changed or worsened condition (property-tested)
- [ ] The same workspace + clock always produces byte-identical rule results
- [ ] `evaluateIncremental` ≡ `evaluateAll` after any command sequence
- [ ] Pilot review finds no critical missing or false-positive default rule category

**► Product Validation Alpha, part 2**

---

## M4 — Scenario and QBR loop

**Objective:** validate the differentiated planning workflow.

Deliverables:

- Scenario base revision + ordered command overlay; branded baseline/scenario projections
- Create, name, save, discard, clone; private by default
- Ghost footprints for Ideas; tentative product and dependency signals; no baseline lifecycle change
- Demand Flow view: Ideas lane → pipe → Commit Gate → capacity containers
- Scenario vs baseline comparison, side by side plus a textual diff list
- Rebase with `CLEAN / REDUNDANT / OBSOLETE / CONFLICT` classification and resolution UI
- Apply-whole (default) and selective apply with dependency-closure validation
- Consequence preview with the ≥ 2-team-quarter trigger rule
- Trade-off panel for overflow: excess, constrained, movable, cross-team, product, dependency effects
- Presentation mode for Portfolio, Radar, and Demand Flow

**Gate E — exit criteria**

- [ ] A lead runs the agreed QBR exercise end to end: intake → place → compare → selectively apply
- [ ] Scenario edits cannot mutate baseline before apply (property-tested)
- [ ] A stale scenario cannot silently overwrite a newer baseline
- [ ] Capacity, product impacts, dependency effects, and attention changes all appear in the diff

**► Product Validation Alpha complete. Continue only if observed use validates the product thesis.**

---

## M5 — Lenses, history, and quarter close

**Objective:** the tool answers all seven questions, and improves planning over time.

Deliverables:

- Timeline (18-month, fragments per footprint, milestones, carry-over)
- Dependency Map: layered layout in a worker, hub emphasis, neighbourhood expansion, cycle badges,
  dependency table companion, per-node text descriptions
- Products view with the change-load strip and contributor breakdown
- Themes lens; composable filter chips; `Ctrl/Cmd + K` command palette; search over the local index
- Domain history view: quarter movement, capacity changes, lifecycle transitions, decisions
- Quarter close: review draft, judgement inputs, carry-over proposal + confirmation, close, reopen
- History rules and explainable planning recommendations
- Recurring commitments as metadata + manual duplication (no auto-creation)

**Gate F — exit criteria**

- [ ] The same workspace answers: can we deliver it · where does change land · what blocks what ·
      what is upcoming · what needs attention · what did we learn
- [ ] Closing a quarter produces carry-over only through explicit Planner confirmation
- [ ] Dependency Map stays usable at 600 dependencies (no permanent spaghetti; budgets met)

---

## M6 — Portability and workspaces

**Objective:** repeated real use by one person, safely.

Deliverables:

- Import: XLSX/CSV/JSON, guided mapping, external-key matching, duplicate preview, transactional apply
- Export: current view, workspace data, Radar, quarter review
- `.flowmap` portable package with `formatVersion`, content hash, and the sensitivity warning
- Snapshots: manual + automatic-before-barrier, restore with diff and typed confirmation
- Saved views
- Multiple workspaces, switcher, smart-default creation, resettable sample workspace
- Archive/restore and the full referential-integrity policy
- Pre-migration recovery backup, corrupted-cache recovery, rollback tests
- Notifications (foreground, coalesced, configurable)
- Command-level permission harness, ready for shared identity

**Gate G — exit criteria**

- [ ] A new pilot user starts from the sample, creates or imports a workspace, runs a meeting,
      closes a quarter, exports it, and recovers it on another device
- [ ] Import failures are atomic and explain record-level errors
- [ ] Migration and round-trip tests cover at least the previous schema version
- [ ] Accessibility acceptance criteria pass for every primary workflow

---

## M7 — Portable packaging

**Objective:** a folder you unzip and run, on both platforms.

Deliverables: signed `Flowmap.exe` in `Flowmap-<version>-win-x64.zip` · a second Windows ZIP
embedding the fixed-version WebView2 runtime · signed, notarised, stapled `Flowmap.app` in a macOS
ZIP · the three-step portable data-directory resolution (§10 3.1) with the resolved path shown in
Settings · verified run-from-user-folder on representative managed devices · native menus and
shortcuts · release notes format including migration impact and how to roll back by keeping the old
folder.

**Gate H — exit criteria**

- [ ] Identical feature set verified on Windows and macOS from the same commit
- [ ] Unzip-and-run verified on a managed device of each platform, with no installation step
- [ ] A `data/` folder beside the executable produces a fully portable instance that leaves nothing
      behind on the host
- [ ] Deleting the folder removes the application completely
- [ ] Rollback exercised: keep the previous folder, restore a pre-migration backup

**► Pilot MVP**

---

## M8 — Shared workspaces via the File provider

**Prerequisite:** S-3 has characterised the chosen shared folder's behaviour. No approval gate —
there is nothing to approve, because there is no service to integrate with.

Deliverables: capability-aware provider contract hardened · File provider against a versioned
`.flowmap` document (read → version check → atomic replace) · outbox, idempotent push, tombstones,
retries · field-level merge for non-overlapping edits and an explicit conflict UI for overlapping
ones · conflict-copy detection and recovery (`* (1).flowmap`, `*-<machine>.flowmap`) ·
files-on-demand placeholder materialisation · read-only-share handling · role authorisation enforced
in the domain, with the UI stating plainly that roles are advisory · shared baseline and shared
scenario publication · sync status showing last-known-remote time rather than implying live sync ·
multi-client deterministic sync and fault-injection harness.

**Gate I — exit criteria**

- [ ] Two clients edit independently and converge after the folder syncs
- [ ] Conflicting edits are never silently overwritten
- [ ] A conflict copy created by the sync client is detected, explained, and recoverable
- [ ] An interrupted or repeated write is idempotent; a half-written document is impossible
- [ ] A read-only or temporarily unreachable share preserves all local work and produces actionable
      status
- [ ] Killing the process mid-write leaves both the local database and the shared document intact

**► Shared Collaboration Beta**

---

## M9 — Enterprise production readiness

Deliverables: security review with evidence and named owners · dependency and license scanning ·
WCAG 2.2 AA evidence plus the desktop keyboard/screen-reader matrix · target-scale performance and
soak results · provider recovery, corrupted-cache, conflict, and disaster-recovery drills · data
lifecycle, workspace deletion, export handling, offboarding · user, admin, and support documentation ·
automatic update **only if** policy permits.

**Gate J — exit criteria**

- [ ] Every agreed security and operational control has evidence and an owner
- [ ] Packaging works on representative managed devices without unsupported privileges
- [ ] No severity-1 accessibility, data-loss, authorisation, or migration defect remains
- [ ] Pilot success measures meet the thresholds agreed in M0

**► Shared Production Release**

---

## Risk register

| Risk                                            | Impact                        | Mitigation                                                                                                      | Owner |
| ----------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| SharePoint approval blocked or slow             | No shared workspaces          | Provider abstraction from M1; File provider is a complete fallback; M8 is the only milestone that depends on it | TBD   |
| Tauri blocked on managed devices                | No distribution               | S-1/S-2 in M0; Electron fallback behind the same IPC boundary                                                   | TBD   |
| Product thesis not validated at Gate E          | Everything after is wasted    | Alpha gates are real stop points; M5+ starts only after observed use validates                                  | TBD   |
| Visual model too dense at 20 teams × 6 quarters | Core value lost               | Semantic zoom is built in M2, not retrofitted; 500-commitment tests are a gate, not a nice-to-have              | TBD   |
| Terminology rejected by business leads          | Adoption failure              | Glossary validated in M0 with both lead types, before it is in the code                                         | TBD   |
| Scope creep toward project management           | Becomes the thing it replaces | Anti-goals in AGENTS.md; every phase gate re-reads them                                                         | TBD   |
| Accessibility retrofitted late                  | Severity-1 defects at M9      | Keyboard path + list companion are part of every slice's definition of done                                     | TBD   |
| Rules produce false positives, losing trust     | Radar ignored                 | Every rule needs firing and non-firing fixtures; Gate D includes a pilot false-positive review                  | TBD   |

## Governance

- Keep a decision log; every resolved contradiction and every ADR is reviewable and reversible.
- Demonstrate a usable vertical slice at least every two weeks. Layer-only milestones are not
  accepted as progress.
- Test each phase with representative users before expanding scope.
- Track product risk, policy risk, data-loss risk, accessibility risk, and performance risk
  separately — they have different owners and different mitigations.
- A feature is not complete until its keyboard path, explanation and error states, i18n keys,
  migration impact, and tests are complete.
- Revisit the release cut at every gate. Deferred items stay deferred unless evidence shows the
  management loop needs them.

## What never gets traded away under scope pressure

Visual-first interaction · deterministic explainability · separation from project-management tooling ·
scenario vs baseline distinction · team capacity vs product change-load distinction · accessibility ·
undo/redo · smart defaults.
