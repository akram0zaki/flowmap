# 05 — Scenarios, Demand Flow & Commit Gate

The differentiated workflow. Everything else in Flowmap exists so that this conversation can happen
in the tool instead of on a whiteboard.

## 1. Scenario model

A scenario is **not** a copy of the data. It is:

```ts
type Scenario = EntityEnvelope & {
  name: string;
  ownerUserId: EntityId;
  visibility: 'PRIVATE' | 'SHARED';
  baseRevision: number; // Workspace.revision when created or last rebased
  commands: ScenarioCommandRecord[]; // ordered, replayable
  status: 'DRAFT' | 'SHARED' | 'APPLIED' | 'DISCARDED';
  appliedAt?: IsoDateTime;
  appliedBy?: ActorId;
  appliedCommandIds?: EntityId[];
};

type ScenarioCommandRecord = {
  id: EntityId; // stable; used for selective apply and conflict reporting
  sequence: number;
  command: Command; // scenarioId set, actorId recorded
  recordedAt: IsoDateTime;
  label: string; // human summary rendered from the command, for the diff list
};
```

### 1.1 Projection

```ts
type BaselineProjection = { readonly __brand: 'baseline' /* entities */ };
type ScenarioProjection = { readonly __brand: 'scenario'; base: BaselineProjection /* overlaid */ };

function projectScenario(base: BaselineProjection, s: Scenario): ScenarioProjection;
```

The two projection types are **structurally incompatible by brand**. Every write path takes a
`BaselineProjection`; scenario command recording takes a `ScenarioProjection`. A scenario command
that reaches a baseline write path is a compile error, and — belt and braces — the command handler
rejects any command carrying `scenarioId` at the baseline boundary with
`SCENARIO_CANNOT_MUTATE_BASELINE`.

Property test: for any sequence of scenario commands, `baseline` bytes are unchanged.

### 1.2 What a scenario may contain

| Allowed in a scenario                               | Notes                                               |
| --------------------------------------------------- | --------------------------------------------------- |
| Assign / move / resize / remove capacity footprints | Including for `IDEA` commitments (ghost footprints) |
| Change target quarter or target date                |                                                     |
| Pass Commit Gate on an Idea                         | Recorded as intent; only realised on apply          |
| Hold, resume, drop a commitment                     |                                                     |
| Add / edit product impacts                          |                                                     |
| Add / edit dependencies and decisions               |                                                     |
| Adjust reserves and capacity adjustments            | Requires Planner even inside a scenario             |
| Create a new Idea                                   | Applies as a real Idea on apply                     |

Not allowed in a scenario: workspace settings changes, quarter close, snapshot restore, import,
role changes, hard deletes. These are barriers, not planning moves.

### 1.3 Ghost state

An `IDEA` given a footprint inside a scenario:

- keeps `lifecycle: IDEA` in the scenario projection — its baseline lifecycle is untouched;
- renders as a **translucent ghost block** with a dashed outline and a "Scenario" badge;
- contributes to a separate `scenarioLoad` alongside `committedLoad`, shown as a distinct band in
  the capacity container;
- contributes to scenario change-load with `lifecycleFactor = 1.0`
  ([04 §5](04-rules-radar.md#5-product-change-load));
- produces **tentative** signals, marked as such and never delivered as notifications.

Applying a scenario that contains ghost footprints on an Idea passes that Idea through Commit Gate
(with all its guardrails re-checked against live baseline state).

## 2. Lifecycle of a scenario

```
CreateScenario ──► DRAFT ──RecordScenarioCommand*──► DRAFT
                     │                                  │
                     ├── ShareScenario ──► SHARED ───────┤
                     │                                  │
                     ├── RebaseScenario ◄── SCN_STALE ───┤
                     │                                  │
                     ├── ApplyScenario (Planner) ──► APPLIED
                     └── DiscardScenario ──────────► DISCARDED
```

- New scenarios are **private by default**, auto-named `Scenario — <date> — <user>` and renameable.
- Sharing is always an explicit action. Contributors may share for review; only Planners may apply.
- `CloneScenario` produces an independent private copy at the current baseline revision.
- Discarding is reversible for 30 days (soft), then garbage-collected.

## 3. Staleness and rebase

`SCN_STALE` fires when `scenario.baseRevision < workspace.revision`.

`RebaseScenario`:

1. Reads the current baseline.
2. Replays `commands` in order against it.
3. Classifies each command:

```ts
type RebaseOutcome =
  | { commandId: EntityId; status: 'CLEAN' }
  | { commandId: EntityId; status: 'REDUNDANT'; reason: string } // baseline already did it
  | { commandId: EntityId; status: 'OBSOLETE'; reason: string } // target gone/archived/closed
  | {
      commandId: EntityId;
      status: 'CONFLICT'; // overlapping field change
      field: string;
      scenarioValue: unknown;
      baselineValue: unknown;
      baselineChangedBy: ActorId;
      baselineChangedAt: IsoDateTime;
    };
```

4. Presents the outcomes for resolution. `CLEAN` and `REDUNDANT` need no input; `OBSOLETE` commands
   are dropped with an explanation; each `CONFLICT` requires an explicit **keep mine / take theirs /
   edit** choice.
5. On confirmation, updates `baseRevision` and rewrites `commands` to the resolved set.

`ApplyScenario` refuses to run while unresolved conflicts exist (`SCENARIO_CONFLICT_UNRESOLVED`),
and refuses to run on a stale scenario without a rebase (`SCENARIO_STALE`). **A stale scenario can
never silently overwrite a newer baseline** — this is a property test, not a UI convention.

## 4. Diff and comparison

`compareScenario(scenario, baseline)` returns a structured diff, grouped for a management
conversation rather than by table:

```ts
type ScenarioDiff = {
  capacity: Array<{
    teamId;
    quarterId;
    loadBefore;
    loadAfter;
    headroomBefore;
    headroomAfter;
    overflowBefore;
    overflowAfter;
  }>;
  commitments: Array<{
    commitmentId;
    changes: FieldDiff[];
    movedFrom?: QuarterId;
    movedTo?: QuarterId;
  }>;
  newCommitments: EntityId[];
  gatePassages: EntityId[]; // ideas that would be committed
  productImpact: Array<{
    productServiceId;
    quarterId;
    changeLoadBefore: ChangeLoadLevel;
    changeLoadAfter: ChangeLoadLevel;
    scoreBefore: number;
    scoreAfter: number;
  }>;
  dependencies: Array<{
    dependencyId;
    effect: 'ADDED' | 'REMOVED' | 'AT_RISK' | 'RESOLVED_EARLIER' | 'TARGET_MOVED';
  }>;
  milestones: Array<{ milestoneId; conflict: 'AFTER_TARGET' | 'BEFORE_DEPENDENCY' }>;
  attention: { added: RuleResult[]; removed: RuleResult[]; worsened: RuleResult[] };
  summary: {
    teamsAffected: number;
    quartersAffected: number;
    netUnitsMoved: number;
    newOverflows: number;
    resolvedOverflows: number;
  };
};
```

The comparison view renders baseline and scenario **side by side on the same layout** with change
markers, plus a textual diff list. Both are keyboard-navigable; the textual list is the accessible
companion.

## 5. Selective apply

```ts
ApplyScenario({ scenarioId, mode: 'ALL' | 'SELECTED', commandIds?: EntityId[], reason?: string })
```

- **Default is apply-all.** Selective apply is available but never required.
- Selective apply validates **dependency closure**: if command _B_ depends on command _A_
  (e.g. _A_ creates the Idea, _B_ gives it a footprint), selecting _B_ without _A_ is rejected with
  the missing prerequisites listed and a one-click "include prerequisites".
- The whole apply runs as one command batch: all selected commands or none.
- Before applying, the UI shows the consequence preview (§7) and states that this clears the undo
  stack and auto-creates a snapshot.
- Unresolved dependency consequences are **shown but do not hard-block** — the Planner decides. An
  optional `reason` is recorded on the `SCENARIO_APPLIED` event.
- On success: `Workspace.revision` increments once, one `SCENARIO_APPLIED` event carries the full
  diff as `facts`, and each underlying command emits its own event with `scenarioId` set so History
  can group them.

## 6. Demand Flow / QBR view

Layout, left to right:

```
┌────────────┐   ┌──────────────────────────┐   ┌──────────────┐   ┌───────────────────────────┐
│ Ideas /    │──►│   Commitment Flow Pipe   │──►│  COMMIT GATE │──►│ Team × Quarter Containers │
│ Demand lane│   │  (staging, sizing,       │   │              │   │  (baseline + ghost bands) │
│            │   │   target quarter pick)   │   │              │   │                           │
└────────────┘   └──────────────────────────┘   └──────────────┘   └───────────────────────────┘
```

- The Ideas/Demand lane is the **only** home of uncommitted Ideas. They never occupy a team-quarter
  block before the gate.
- Dragging an Idea into the pipe opens inline sizing and a **visual quarter strip** (never a
  dropdown) for target selection.
- Dropping an Idea onto a team-quarter container inside a scenario creates a ghost footprint and
  updates capacity, change-load, and tentative signals immediately (≤ 100 ms feedback).
- Carry-over and new demand are **separate groups** in the container and in the QBR summary, because
  they are different conversations.
- The pipe metaphor appears **only** in this view. The Portfolio Map never shows it.

### 6.1 Keyboard equivalent

| Key       | Action                                                                            |
| --------- | --------------------------------------------------------------------------------- |
| `↑ ↓`     | Move between Ideas in the lane                                                    |
| `Enter`   | Open the Idea                                                                     |
| `m`       | Enter move mode (announces "Move mode. Arrow keys to choose team and quarter.")   |
| `← → ↑ ↓` | In move mode: choose target team-quarter; live announcement of resulting headroom |
| `Enter`   | Place, creating the ghost footprint                                               |
| `Esc`     | Cancel move, restore original position                                            |
| `g`       | Open Commit Gate for the focused item                                             |

## 7. Consequence preview

Shown before: `ApplyScenario`, Commit Gate that causes overflow or moves ≥ 2 team-quarters,
`MoveCapacityFootprint` that changes 3+ downstream signals, `MigrateFootprintUnits`,
`RestoreSnapshot`, `CloseQuarter`.

```ts
type Consequence =
  | { kind: 'CAPACITY'; teamId; quarterId; loadDelta: number; newOverflow?: CapacityUnits }
  | { kind: 'CHANGE_LOAD'; productServiceId; quarterId; from: ChangeLoadLevel; to: ChangeLoadLevel }
  | {
      kind: 'DEPENDENCY';
      dependencyId;
      effect: 'BECOMES_AT_RISK' | 'NEEDED_BY_BEFORE_TARGET' | 'RESOLVED_EARLIER';
    }
  | { kind: 'MILESTONE'; milestoneId; effect: 'AFTER_TARGET' | 'ORPHANED' }
  | { kind: 'ATTENTION'; added: number; removed: number; worsened: number }
  | { kind: 'IRREVERSIBLE'; note: string };
```

The preview is a **summary with drill-down**, never a wall of rows: counts by kind, expandable to
the individual consequences, with a fixed "Continue / Cancel" affordance that is reachable by
keyboard and does not move as content expands.

Routine drag/drop never shows this. The distinction is measured, not aesthetic: a preview appears
only when the change touches ≥ 2 team-quarters, changes a change-load level, or crosses an
irreversibility barrier.

## 8. Commit Gate

Crossing the gate means: **the organisation is accepting capacity consumption into the baseline.**
It is not an approval workflow, has no routing, no sign-off, and no queue.

`PassCommitGate(commitmentId, { acceptOverflow?: boolean, reason?: string })`:

1. Requires Planner.
2. Hard checks ([03 §6.1](03-commands-permissions.md#61-hard-guardrails-fixed)): exactly one primary
   team, ≥ 1 footprint, primary footprint on the primary team, target date if `MANDATORY`.
3. Advisory checks run and are shown as a dismissible readiness checklist. They never block.
4. If the resulting load overflows any team-quarter, the trade-off panel
   ([02 §6](02-capacity-model.md#6-overflow-policy)) is shown; the Planner may proceed, optionally
   with a reason.
5. On success: `lifecycle → COMMITTED`, `committedAt`/`committedBy` set, unit baseline recorded for
   `HLT_GROWN`, `COMMITMENT_COMMITTED` event emitted, rules re-evaluated for the affected
   projections.

`RevertCommitGate` returns a commitment to `IDEA` provided it has never been `IN_DELIVERY`. Its
footprints are **archived, not deleted**, so re-committing restores the same plan.

## 9. Presentation mode

Presentation mode is a display state, not a separate view stack.

Hides: editing chrome, toolbars, side panels, admin affordances, unsaved-state indicators.
Preserves: zoom, focus, lens switching, scenario exploration, dependency highlighting, capacity
exploration, keyboard navigation.

- Entered with `Ctrl/Cmd + Shift + P`, exited with `Esc`.
- Available for Portfolio, Radar, Demand Flow, Timeline, Dependencies, Products.
- Increases minimum type size by one step and thickens focus rings for projector legibility.
- Editing commands are blocked while active, with a toast explaining how to exit — so nobody
  accidentally re-plans the portfolio in front of a room.
- Saved views restore lens + filters + horizon + focus, which is how a QBR agenda is built: a saved
  view per agenda item, walked in order.
