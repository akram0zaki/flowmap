# 02 — Capacity & Planning Model

This is the arithmetic core of Flowmap. Every number in it is integer arithmetic, deterministic,
and reproducible from stored data plus workspace settings. Implemented in
`@flowmap/domain/capacity`, with no I/O and no clock access other than the injected `Clock`.

## 1. The planning unit

Capacity is modelled as **Team × Quarter**. A normal team quarter starts at **100 relative capacity
units**. Units are deliberately _not_ person-days, hours, story points, or money, and the UI states
this in the tooltip on every surface that shows a unit value.

## 2. Capacity arithmetic

For a `TeamQuarter tq`:

```
effectiveCapacity(tq)   = tq.capacityBaseline + tq.capacityAdjustment       // >= 0
reservedTotal(tq)       = Σ r.amount  for r in tq.reserves
deliverableCapacity(tq) = effectiveCapacity(tq) − reservedTotal(tq)         // >= 0 by invariant
```

For load, define the **counted** predicate on a footprint `f` belonging to commitment `c`, in a
workspace whose current quarter has ordinal `Qnow`:

```
counted(f, c) =
      c.archivedAt == null
  AND f.archivedAt == null
  AND (
        c.lifecycle ∈ { COMMITTED, IN_DELIVERY }
     OR (c.lifecycle == DONE AND ordinal(f.quarterId) <= Qnow)         // R3
      )
```

`ON_HOLD` and `DROPPED` footprints are never counted. Preserved hold capacity is modelled as a
reserve instead — see §2.1.

```
committedLoad(tq)   = Σ f.units  for all counted footprints f where f.teamId == tq.teamId
                                                              and f.quarterId == tq.quarterId
headroom(tq)        = deliverableCapacity(tq) − committedLoad(tq)          // may be negative
overflow(tq)        = max(0, −headroom(tq))
utilisation(tq)     = deliverableCapacity(tq) == 0 ? null
                                                   : committedLoad(tq) / deliverableCapacity(tq)
```

Presentation rules:

- `utilisation` is displayed as a whole percent, rounded half-up: `Math.round(u * 100)`.
- When `deliverableCapacity == 0`, the UI shows "No deliverable capacity" — never `∞` or `NaN`.
- Overflow is always shown as **units and percent together**, with a non-colour indicator:
  `+18 units · 123% ▲ Over capacity`.

### 2.1 On-hold capacity

`HoldCommitment` takes `preserveCapacity: boolean`.

| `preserveCapacity` | Effect                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `false` (default)  | Footprints stop being counted. Capacity is genuinely released and visible as headroom                                                                                                                              |
| `true`             | Footprints stop being counted **and** a system-managed `HOLD` reserve is created on each affected `TeamQuarter` with `amount = Σ` that commitment's units in that team-quarter, labelled `Held: <commitment name>` |

Held work is therefore never counted as _load_ in either case — the preserved variant moves the units
into _reserves_. This keeps exactly one place where held work consumes the pool, and makes "why is my
headroom lower than the blocks suggest?" answerable by pointing at a labelled reserve rather than at
an invisible block. `ResumeCommitment` removes the `HOLD` reserves and restores counting.

### 2.2 Worked example

Team _Payments_, 2026-Q4, with the workspace's **current quarter also 2026-Q4** (this matters: it is
what makes the `DONE` footprint below count — see R3).

This example is executable. `packages/domain/src/capacity.test.ts` asserts every figure in the table,
so the spec and the implementation cannot drift apart silently.

| Element                                              | Units    |
| ---------------------------------------------------- | -------- |
| `capacityBaseline`                                   | 100      |
| `capacityAdjustment` (one vacancy)                   | −10      |
| `effectiveCapacity`                                  | **90**   |
| Reserve — BAU & support                              | 15       |
| Reserve — Refinement                                 | 5        |
| Reserve — Held: _Card tokenisation_                  | 20       |
| `reservedTotal`                                      | **40**   |
| `deliverableCapacity`                                | **50**   |
| Footprint — _SEPA instant_ (COMMITTED, primary)      | 35       |
| Footprint — _Fraud rules uplift_ (IN_DELIVERY)       | 20       |
| Footprint — _Legacy decom_ (DONE, quarter ≤ current) | 5        |
| `committedLoad`                                      | **60**   |
| `headroom`                                           | **−10**  |
| `overflow`                                           | **10**   |
| `utilisation`                                        | **120%** |

The Portfolio Map cell renders: reserve band (40 hatched), three blocks sized 35/20/5 stacked, and
an overflow spill of 10 above the container line with the label `+10 units · 120% ▲ Over capacity`.

## 3. Portfolio-level aggregates

Used by the Portfolio Map at zoom level 1 and by the Teams lens.

```
teamLoad(team, horizon)      = Σ committedLoad(tq)      for tq in team × horizon
teamCapacity(team, horizon)  = Σ deliverableCapacity(tq) for tq in team × horizon
quarterOverflowCount(q)      = count of tq in quarter q where overflow(tq) > 0
portfolioPressure(q)         = Σ committedLoad(tq) / Σ deliverableCapacity(tq) over all tq in q
```

Aggregates MUST be computed from the same `counted` predicate. A property test asserts that the sum
of cell-level loads equals the aggregate for every horizon window
(`capacity aggregates are associative`).

## 4. Size mapping and migration

Relative sizes are an **input affordance**, not a stored capacity value.

```
resolveUnits(size, settings):
  XS | S | M | L  →  settings.capacity.sizeMapping[size]
  XL              →  reject: XL_REQUIRES_EXPLICIT_UNITS
```

Default mapping: `XS = 5`, `S = 10`, `M = 20`, `L = 35`. `XL` has no mapping and MUST be entered as
explicit units.

When a footprint is created from a size, `units` is resolved **once** and frozen, with
`unitsSource: 'SIZE_MAPPING'` and `sizeAtCreation` recorded for display. After that:

- Changing `settings.capacity.sizeMapping` affects **new** footprints only. Existing plans never
  silently re-cost.
- A Planner may run `MigrateFootprintUnits` to re-resolve existing footprints. It is a two-step
  command: `preview` returns the full list of affected footprints with before/after units, per-team
  and per-quarter load deltas, and the set of team-quarters that would newly overflow. Only after an
  explicit confirm does it apply, setting `unitsSource: 'MIGRATED'` and emitting one
  `FOOTPRINT_UNITS_MIGRATED` event per footprint plus one summary event.
- Migration MUST NOT touch footprints in closed quarters.

`Commitment.sizeSummary` (derived, [01 §5.1](01-domain-model.md#51-derived-non-stored-fields)) bands
total counted units back to a label for display:

```
sizeSummary(totalUnits, mapping):
  totalUnits <= mapping.XS            → 'XS'
  totalUnits <= mapping.S             → 'S'
  totalUnits <= mapping.M             → 'M'
  totalUnits <= mapping.L             → 'L'
  otherwise                           → 'XL'
```

## 5. Reserves

Six reserve types, each with distinct meaning and UI treatment:

| Type          | Meaning                                                      | Default | Editable    |
| ------------- | ------------------------------------------------------------ | ------- | ----------- |
| `BAU_SUPPORT` | Routine production support and business-as-usual load        | 15      | Planner     |
| `REFINEMENT`  | Shaping Ideas before delivery; Ideas link here qualitatively | 5       | Planner     |
| `LCM`         | Lifecycle-management baseline (patching, upgrades, currency) | 0       | Planner     |
| `OVERHEAD`    | Ceremonies, onboarding, non-delivery team load               | 0       | Planner     |
| `HOLD`        | System-managed; preserved capacity for an on-hold commitment | —       | System only |
| `OTHER`       | Escape hatch with mandatory label                            | 0       | Planner     |

A new `TeamQuarter` is seeded from `team.defaultReserves` when the team has them, and from
`settings.capacity.defaultReserves` otherwise — giving **80 deliverable units** out of 100 by
default.

**Three levels, each the starting point for the next:**

```
workspace settings  →  team defaults  →  the team-quarter itself
   (all new teams)      (that team's       (what the board's
                         new quarters)      figures are computed from)
```

The lower two are optional overrides: a team with no defaults of its own follows the workspace, and
clearing a team's override is an absent field, not an empty list — "this team reserves nothing" is a
different statement from "this team follows the workspace".

**Seeding is a copy, taken once.** A default is what a _new_ container starts from, never a live
reference. Changing a default therefore cannot rewrite a quarter that already exists — someone has
planned against it, and last quarter's figures are history. Writing new defaults onto quarters that
already exist is a separate, explicit decision (`SetTeamQuarterReserves` per quarter, offered
alongside the team edit); it never touches a closed quarter, and the whole application is one undo
step.

Reserving more than the quarter has is refused (`RESERVES_EXCEED_CAPACITY`) at every level, checked
against the capacity being set in the same command rather than the one being replaced — otherwise
raising BAU and capacity together fails while doing it in two steps succeeds. A `HOLD` reserve is
system-managed: it survives an edit, counts against what is left to reserve, and cannot be created
or removed through the editor.

**Material deviation from routine operational load does not go in a reserve** — it becomes an
explicit commitment (usually `class: OPERATIONAL`) so it is visible, ownable, and attributable. The
reserve models the _routine_; the commitment models the _exception_. The quarter-close review
compares them ([§8](#8-quarter-close)).

### 5.1 Refinement reserve links

`LinkIdeaToRefinementReserve(reserveId, ideaId)` records that a refinement bucket supports a given
Idea. This link:

- MUST NOT allocate units to the Idea.
- MUST NOT create a footprint.
- MUST NOT change the Idea's lifecycle.
- Renders on the Portfolio Map as a thin connector marker between the Ideas lane and the reserve
  band of that team-quarter — the only way an uncommitted Idea appears on the map.
- Is included in the refinement reserve's tooltip: "Supports 4 Ideas: …".

## 6. Overflow policy

Overflow is **permitted and visible**, never blocked.

At Commit Gate or on any footprint command that pushes a team-quarter past its deliverable capacity:

1. The command still succeeds if the actor is a Planner.
2. The response carries an `OverflowConsequence` payload:

```ts
type OverflowConsequence = {
  teamQuarter: EntityRef;
  excessUnits: CapacityUnits;
  utilisationBefore: number;
  utilisationAfter: number;
  constrained: Array<{
    commitmentId: EntityId;
    reason: 'MANDATORY' | 'IN_DELIVERY' | 'HARD_DEPENDENCY';
  }>;
  movable: Array<{
    commitmentId: EntityId;
    units: CapacityUnits;
    earliestAlternativeQuarter?: QuarterId;
  }>;
  crossTeamEffects: Array<{ teamId: EntityId; quarterId: QuarterId; deltaUnits: number }>;
  productEffects: Array<{
    productServiceId: EntityId;
    quarterId: QuarterId;
    changeLoadBefore: ChangeLoadLevel;
    changeLoadAfter: ChangeLoadLevel;
  }>;
  dependencyEffects: Array<{
    dependencyId: EntityId;
    effect: 'AT_RISK' | 'NEEDED_BY_BEFORE_TARGET';
  }>;
};
```

3. The UI presents this as the **trade-off panel**: excess, what cannot move and why, what can move
   and where to, and the knock-on effects. It ranks nothing and computes no priority score.
4. A Planner MAY record an optional `reason` via `AcceptOverflow`, stored on the `TeamQuarter` as
   `overflowAccepted`. No justification form is required and none is enforced.

`movable` is derived, not judged: a commitment is movable when it is `COMMITTED` (not
`IN_DELIVERY`), not `MANDATORY`, and has no unresolved hard dependency whose `neededBy` falls inside
the quarter. `earliestAlternativeQuarter` is the first later quarter in the horizon where the team
has `headroom >= units`, or undefined if none.

## 7. Carry-over

Carry-over is a **derived condition**, not a lifecycle state.

It is created only at quarter close, only by a Planner, and never automatically:

1. `ProposeCarryOver(quarterId)` returns proposals for every commitment that is `COMMITTED` or
   `IN_DELIVERY` and holds a counted footprint in the closing quarter.
2. Each proposal defaults to: same team, next quarter by ordinal, **units equal to the closing
   footprint's final planned units**. Flowmap has no percent-complete concept and therefore does not
   attempt to compute remaining work.
3. The Planner reviews each proposal and may adjust units, change the receiving quarter, split
   across teams, or decline.
4. `ConfirmCarryOver` creates the receiving footprints with `carryOverFromQuarterId`,
   `carryOverFromFootprintId`, and `unitsSource: 'CARRY_OVER'`, and marks the origin footprints
   `closedAsUnfinished: true`.

The origin footprint is **preserved, not moved**. This is what makes "original plan vs what actually
happened" answerable later. Carry-over footprints render with a distinct hatch pattern and an
explicit "Carried over from 2026-Q4" label — never colour alone.

QBR views separate carry-over from new demand as a first-class grouping, because the two have
entirely different planning conversations attached to them.

## 8. Quarter close

Closing a quarter is an **explicit Planner action**. The calendar never rolls a workspace forward.

```
OpenQuarterReview(quarterId) → QuarterReviewDraft
RecordQuarterOutcome(quarterId, outcomes)
ProposeCarryOver(quarterId) → CarryOverProposal[]
ConfirmCarryOver(quarterId, decisions)
CloseQuarter(quarterId) → advances Workspace.currentQuarterId
```

`QuarterReviewDraft` presents, per team:

| Field                             | Source                                                                    |
| --------------------------------- | ------------------------------------------------------------------------- |
| Planned deliverable capacity      | `deliverableCapacity` at open of quarter (from the quarter-open snapshot) |
| Final deliverable capacity        | `deliverableCapacity` now                                                 |
| Committed load at open / at close | computed                                                                  |
| Completed commitments             | `DONE` with a counted footprint in the quarter                            |
| Unfinished commitments            | `COMMITTED` / `IN_DELIVERY` with a footprint in the quarter               |
| Dropped in quarter                | `DROPPED` with a footprint in the quarter                                 |
| Original vs current units         | first recorded footprint units vs final, per commitment                   |
| Original vs current target        | first recorded target quarter vs final                                    |

And per team, three explicit **judgement** inputs the Planner records (they cannot be derived
without timesheets, which are an anti-goal):

- Operational load vs expectation: `BELOW` / `ABOUT` / `ABOVE`
- Capacity vs expectation: `LOWER` / `ABOUT` / `HIGHER`
- Optional note (≤ 280)

`CloseQuarter`:

1. Requires that carry-over has been reviewed (confirmed or explicitly declined) for every unfinished
   commitment.
2. Writes a `Snapshot` named `Close of <quarterId>` automatically.
3. Sets `closedAt` on every `TeamQuarter` in that quarter, making them immutable.
4. Advances `Workspace.currentQuarterId` to the next ordinal.
5. Emits `QUARTER_CLOSED` with the full review payload as `facts`.

`ReopenQuarter` exists for Admins, requires confirmation, clears `closedAt`, and emits
`QUARTER_REOPENED`. It does not roll back the carry-over footprints — those are normal data that can
be edited or archived.

### 8.1 History-derived recommendations

After close, deterministic recommendations are produced from the recorded reviews
([04 §6](04-rules-radar.md#6-history-rules)). Example rendering:

> **Operational reserve was exceeded in 2 consecutive quarters** (2026-Q3, 2026-Q4 — both recorded
> `ABOVE`). Consider raising _Payments_' default BAU & support reserve from 15 to 20.
> _Based on: 2 of last 3 quarters recorded above expectation. Threshold: 2._

Recommendations are advisory, show their inputs and threshold, and offer a one-click command with a
preview. They are never applied automatically.

## 9. Invariants (property-tested)

1. `deliverableCapacity(tq) >= 0` for every team-quarter, always.
2. `committedLoad(tq) == Σ counted footprint units` — no other input affects load.
3. Refinement links change no capacity total anywhere.
4. A footprint references exactly one team and one explicit quarter that exists in the workspace's
   quarter space.
5. `Σ` cell-level loads over any horizon window equals the aggregate for that window.
6. `DONE` work in a future quarter contributes 0 to load; the same work with its quarter ≤ current
   contributes its units.
7. Holding a commitment with `preserveCapacity: true` leaves `deliverableCapacity − committedLoad`
   unchanged (units move from load to reserve).
8. Carry-over preserves the origin footprint and creates exactly one receiving footprint per
   confirmed proposal.
9. Closing a quarter is idempotent: closing an already-closed quarter is rejected, never partially
   applied.
10. Changing the size mapping never changes any existing footprint's `units`.
