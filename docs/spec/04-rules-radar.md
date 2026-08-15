# 04 — Rules Engine & Radar

`@flowmap/rules` is a pure, deterministic, explainable evaluator. Same workspace state + same clock

- same settings ⇒ byte-identical results, always. This is asserted by a golden-file test over the
  validation fixture.

**There is no AI, no scoring model, and no learned weighting anywhere in this package.**

## 1. Evaluation contract

```ts
type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';

type RuleCategory =
  | 'CAPACITY'
  | 'DEPENDENCY'
  | 'TIMING'
  | 'HEALTH'
  | 'READINESS'
  | 'OWNERSHIP'
  | 'PRODUCT'
  | 'HISTORY'
  | 'INTEGRITY';

type RuleResult = {
  signalKey: string; // stable identity, §3
  ruleCode: RuleCode;
  entityRef: EntityRef;
  category: RuleCategory;
  severity: Severity;
  surfaces: Array<'RADAR' | 'HEALTH' | 'INLINE' | 'GATE'>;
  facts: Record<string, string | number | boolean>; // the inputs that fired the rule
  threshold?: Record<string, number>; // the settings that were compared against
  conditionFingerprint: string; // §3.2
  actions: SuggestedAction[];
  occurredOn: IsoDate; // workspace-local evaluation date
  dueOn?: IsoDate; // for time-ordered grouping in Radar
};

type SuggestedAction =
  | { kind: 'OPEN'; ref: EntityRef }
  | { kind: 'COMMAND'; command: CommandName; payload: unknown; label: string }
  | { kind: 'NAVIGATE'; lens: LensId; focus?: EntityRef; filters?: FilterState };

interface RulesEngine {
  evaluateAll(state: WorkspaceProjection, ctx: RuleContext): RuleResult[];
  evaluateIncremental(
    state: WorkspaceProjection,
    ctx: RuleContext,
    affected: ProjectionKey[],
  ): RuleDelta;
}
```

`RuleContext` provides `Clock`, workspace `timezone`, `RuleSettings`, and the current user's
`ActorId` + owned `EntityRef`s. Nothing else.

### 1.1 Message rendering

Rules do **not** produce prose. `facts` + `threshold` + `ruleCode` render through i18n keys:

```
rule.DEP_OVERDUE.title       = "Dependency overdue"
rule.DEP_OVERDUE.message     = "{dependencyName} was needed by {neededBy} ({daysOverdue} days ago)."
rule.DEP_OVERDUE.explanation = "{sourceName} is waiting on {targetName}. Status is {status}."
rule.DEP_OVERDUE.why         = "Overdue prerequisites are the most common cause of a missed target quarter."
```

This is what makes "explanations are data" real: every signal can show _what happened_, _why it
matters_, _which threshold it crossed_, and _what to do_, with no per-rule UI code.

### 1.2 Incremental evaluation

Every command returns `affectedProjections`. Each rule declares the projection key patterns it reads.
`evaluateIncremental` re-runs only rules whose declared patterns intersect the affected set, and
returns `{ added, updated, removed }` by `signalKey`. A property test asserts
`evaluateIncremental` after any command sequence equals `evaluateAll` on the resulting state.

## 2. Attention vs health

Two orthogonal projections, never merged into one number or one colour.

|                        | Attention                                  | Health                                                                                                                      |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Question               | "Does a human need to look **now**?"       | "Is this in trouble?"                                                                                                       |
| Driven by              | Dates, ownership, decisions pending, gates | Conditions: overdue prerequisites, missed milestones, overflow, staleness                                                   |
| Surfaces in            | Radar, block markers                       | Block halo/pattern, detail panel, list columns                                                                              |
| User can dispose of it | Yes — review / snooze                      | **No.** A user may add context or disagree, and that annotation is shown alongside, but the underlying signal stays visible |

A commitment can be healthy and need attention (a decision is due Friday), or unhealthy and need no
attention from _this_ user (someone else owns the blocked prerequisite).

`healthLevel(commitment)` = highest severity among its `HEALTH`-surfacing signals, mapped
`HIGH → AT_RISK`, `MEDIUM → WATCH`, `LOW|INFO|none → OK`. Rendered with an icon + label + pattern,
never colour alone.

## 3. Signal identity and disposition

### 3.1 Signal key

```
signalKey = base32( sha256( ruleCode + '|' + entityRefKey + '|' + discriminator ) )[0..16]
```

`discriminator` is rule-specific and covers the _instance_ of the condition, not its magnitude —
e.g. `DEP_OVERDUE` uses the dependency id (already in `entityRef`) so `discriminator` is empty,
while `CAP_OVERFLOW` uses `teamId:quarterId`. The key MUST be stable across evaluations, restarts,
devices, and sync.

### 3.2 Condition fingerprint

```
conditionFingerprint = base32( sha256( canonicalJson(materialFacts) ) )[0..16]
```

`materialFacts` is a rule-declared subset of `facts` — the values whose change means "this is now a
different situation". Deliberately excludes values that drift continuously (e.g. `daysOverdue`),
because otherwise every day would resurrect every reviewed signal.

Example — `DEP_OVERDUE`: material facts are `{ dependencyId, neededBy, status, targetRef }`.
`daysOverdue` is a fact but not material.

### 3.3 Suppression

```
suppressed(signal, disposition) =
  disposition == null                         → false
  signal.severity > disposition.atSeverity    → false     // breakthrough
  disposition.disposition == 'REVIEWED'       → signal.conditionFingerprint == disposition.atFingerprint
  disposition.disposition == 'SNOOZED'        → today < disposition.snoozeUntil
                                                 AND signal.conditionFingerprint == disposition.atFingerprint
```

Consequences, which are exactly the intended behaviour:

- `Reviewed — no change` does **not** expire on a timer. It expires when the situation changes or
  gets worse.
- Snooze requires a return date or preset (`Tomorrow`, `Next week`, `Next Monday`, `Start of next
quarter`, `Custom`). It also breaks through on a severity increase or a material change.
- There is **no permanent dismissal** for system-generated signals. `ClearSignalDisposition` only
  un-suppresses.

`SignalDisposition` rows are per-user and synchronise like any other entity, so a Planner's review
does not silently hide a Contributor's signal in a shared workspace — dispositions are keyed by
`signalKey` **and** `actorId`.

Dispositions for signal keys that no longer evaluate are garbage-collected after 90 days.

## 4. Rule catalog

`ε` in Threshold means "workspace-configurable, default shown". All day comparisons use the
workspace timezone's calendar date.

### 4.1 Capacity rules

| Code                            | Fires when                                                           | Severity | Threshold | Surfaces              | Primary action                             |
| ------------------------------- | -------------------------------------------------------------------- | -------- | --------- | --------------------- | ------------------------------------------ |
| `CAP_OVERFLOW`                  | `overflow(tq) > 0`                                                   | HIGH     | —         | RADAR, HEALTH, INLINE | Open trade-off panel for that team-quarter |
| `CAP_NEAR_LIMIT`                | `utilisation(tq) >= ε` and no overflow                               | MEDIUM   | ε = 0.95  | RADAR, INLINE         | Open team-quarter                          |
| `CAP_NO_DELIVERABLE`            | `deliverableCapacity(tq) == 0` while footprints exist                | HIGH     | —         | INLINE                | Review reserves                            |
| `CAP_PRIMARY_FOOTPRINT_MISSING` | committed commitment whose primary team has no `isPrimary` footprint | HIGH     | —         | HEALTH, GATE          | `SetPrimaryFootprint`                      |
| `CAP_NO_FOOTPRINT`              | `COMMITTED`/`IN_DELIVERY` with zero counted footprints               | HIGH     | —         | HEALTH                | `AssignCapacityFootprint`                  |
| `CAP_SPAN_LONG`                 | commitment spans > ε quarters                                        | LOW      | ε = 3     | INLINE                | Consider splitting                         |
| `CAP_ADJUSTMENT_UNEXPLAINED`    | `capacityAdjustment != 0` with no `adjustmentNote`                   | INFO     | —         | INLINE                | Add note                                   |

### 4.2 Dependency rules

| Code                         | Fires when                                                                      | Severity | Threshold | Surfaces          | Primary action                    |
| ---------------------------- | ------------------------------------------------------------------------------- | -------- | --------- | ----------------- | --------------------------------- |
| `DEP_OVERDUE`                | unresolved dependency, `neededBy < today`                                       | HIGH     | —         | RADAR, HEALTH     | Open dependency                   |
| `DEP_DUE_SOON`               | unresolved, `0 <= neededBy − today <= ε`                                        | MEDIUM   | ε = 14 d  | RADAR             | Open dependency                   |
| `DEP_AT_RISK`                | `status == AT_RISK`                                                             | MEDIUM   | —         | RADAR, HEALTH     | Open dependency                   |
| `DEP_NO_NEEDED_BY`           | hard dependency on a committed source with no `neededBy`                        | LOW      | —         | INLINE, GATE      | `SetDependencyNeededBy`           |
| `DEP_TARGET_MOVED_LATE`      | target commitment's target quarter is now ≥ source's target quarter             | HIGH     | —         | RADAR, HEALTH     | Review both targets               |
| `DEP_TARGET_AFTER_NEEDED_BY` | target's target date > dependency `neededBy`                                    | MEDIUM   | —         | RADAR             | Review dependency                 |
| `DEP_CYCLE`                  | commitment participates in a dependency cycle                                   | MEDIUM   | —         | RADAR, INLINE     | Open cycle in Dependency Map      |
| `DEP_HUB`                    | a target has ≥ ε unresolved incoming dependencies                               | MEDIUM   | ε = 5     | RADAR (portfolio) | Open bottleneck neighbourhood     |
| `DEP_HUB_CONSTRAINED`        | `DEP_HUB` target is a team that also has `CAP_OVERFLOW` in the relevant quarter | HIGH     | —         | RADAR             | Open team-quarter + neighbourhood |
| `DEP_DECISION_OVERDUE`       | `Decision` unresolved, `neededBy < today`                                       | HIGH     | —         | RADAR, HEALTH     | Open decision                     |
| `DEP_DECISION_UNOWNED`       | `Decision` with `neededBy` and no owner                                         | MEDIUM   | —         | RADAR             | `SetDecisionOwner`                |
| `DEP_TARGET_ARCHIVED`        | non-archived dependency pointing at an archived/deleted target                  | MEDIUM   | —         | INTEGRITY, INLINE | Retarget or remove                |
| `DEP_BLOCKED_IN_DELIVERY`    | `IN_DELIVERY` source with an overdue hard dependency                            | HIGH     | —         | RADAR, HEALTH     | Open dependency                   |

### 4.3 Timing rules

| Code                  | Fires when                                                                     | Severity | Threshold | Surfaces       | Primary action                      |
| --------------------- | ------------------------------------------------------------------------------ | -------- | --------- | -------------- | ----------------------------------- |
| `ATT_DATE_REACHED`    | `attentionDate <= today`, not `DONE`/`DROPPED`                                 | MEDIUM   | —         | RADAR          | Open commitment                     |
| `ACT_OVERDUE`         | `nextActionDueDate < today`                                                    | HIGH     | —         | RADAR          | Open, or `SetNextAction`            |
| `ACT_DUE_SOON`        | `0 <= nextActionDueDate − today <= ε`                                          | MEDIUM   | ε = 7 d   | RADAR          | Open                                |
| `ACT_MISSING`         | `IN_DELIVERY`, no `nextAction`, last meaningful update older than ε            | LOW      | ε = 14 d  | RADAR          | `SetNextAction`                     |
| `TGT_MISSED`          | `targetDate < today`, lifecycle not terminal                                   | HIGH     | —         | RADAR, HEALTH  | Review target                       |
| `TGT_APPROACHING`     | `0 <= targetDate − today <= ε`, not `DONE`                                     | MEDIUM   | ε = 30 d  | RADAR          | Open                                |
| `TGT_QUARTER_OVERRUN` | a counted footprint sits in a quarter later than `targetQuarterId`             | MEDIUM   | —         | HEALTH, INLINE | Review target quarter or footprints |
| `LSS_PASSED`          | `latestSafeStart < today` and lifecycle is `IDEA` or `COMMITTED` (not started) | HIGH     | —         | RADAR, HEALTH  | Commit / start / re-plan            |
| `LSS_APPROACHING`     | `0 <= latestSafeStart − today <= ε` and not started                            | MEDIUM   | ε = 14 d  | RADAR          | Open                                |
| `MS_OVERDUE`          | milestone `PLANNED` with `targetDate < today`                                  | HIGH     | —         | RADAR, HEALTH  | Set status or move date             |
| `MS_DUE_SOON`         | milestone `PLANNED`, `0 <= targetDate − today <= ε`                            | LOW      | ε = 14 d  | RADAR          | Open                                |
| `MS_MISSED_FLAGGED`   | milestone `status == MISSED`                                                   | MEDIUM   | —         | HEALTH         | Review plan                         |

### 4.4 Readiness & governance rules

| Code                           | Fires when                                                                | Severity | Threshold       | Surfaces     |
| ------------------------------ | ------------------------------------------------------------------------- | -------- | --------------- | ------------ |
| `RDY_NO_PRIMARY_TEAM`          | `IDEA` with a footprint but no primary team                               | MEDIUM   | —               | GATE         |
| `RDY_NO_FOOTPRINT`             | `IDEA` targeted at a quarter with no footprint                            | LOW      | —               | GATE         |
| `RDY_NO_OUTCOME`               | `IDEA` with no outcome statement                                          | INFO     | —               | GATE         |
| `RDY_NO_PRODUCT_IMPACT`        | `IDEA`/committed with zero product impacts                                | LOW      | —               | GATE, INLINE |
| `RDY_NO_DEPENDENCIES_REVIEWED` | Commit Gate with zero dependencies and no explicit "none" acknowledgement | INFO     | —               | GATE         |
| `RDY_LOW_CONFIDENCE_LARGE`     | committed, total units ≥ ε, `sizeConfidence == LOW`                       | MEDIUM   | ε = `mapping.L` | GATE, HEALTH |
| `RDY_IDEA_UNREFINED`           | `IDEA` older than ε days with no refinement-reserve link and no footprint | LOW      | ε = 60 d        | RADAR        |
| `RDY_MANDATORY_NO_TARGET`      | `MANDATORY` without `targetDate` (blocking at gate, advisory before)      | HIGH     | —               | GATE, RADAR  |
| `OWN_MISSING`                  | `COMMITTED`/`IN_DELIVERY` with no `ownerRef`                              | HIGH     | —               | RADAR        |
| `OWN_TEAM_ONLY_ACTION_DUE`     | next action due within ε and owner is a `TEAM`, not a `PERSON`            | MEDIUM   | ε = 7 d         | RADAR        |
| `OWN_DEPENDENCY_MISSING`       | dependency with a `neededBy` and no owner                                 | MEDIUM   | —               | RADAR        |
| `OWN_ARCHIVED`                 | owner references an archived person                                       | LOW      | —               | INLINE       |

**`OWN_MISSING` deliberately does not fire on newly captured Ideas.** Quick Capture must stay
frictionless; ownership is demanded at the point it matters — commitment.

### 4.5 Health rules

| Code                   | Fires when                                                               | Severity | Threshold | Surfaces      |
| ---------------------- | ------------------------------------------------------------------------ | -------- | --------- | ------------- |
| `HLT_STALE_DELIVERY`   | `IN_DELIVERY`, `max(lastMeaningfulUpdateAt, lastReviewedAt) < today − ε` | MEDIUM   | ε = 21 d  | RADAR, HEALTH |
| `HLT_STALE_COMMITTED`  | `COMMITTED`, same measure older than ε                                   | LOW      | ε = 45 d  | RADAR         |
| `HLT_STALE_HELD`       | `ON_HOLD` longer than ε with capacity preserved                          | MEDIUM   | ε = 60 d  | RADAR         |
| `HLT_MOVED_REPEATEDLY` | target quarter moved later ≥ ε times                                     | MEDIUM   | ε = 2     | HEALTH        |
| `HLT_GROWN`            | total footprint units grew ≥ ε% since Commit Gate                        | MEDIUM   | ε = 50 %  | HEALTH        |

### 4.6 Product rules

| Code                   | Fires when                                                       | Severity | Threshold | Surfaces      |
| ---------------------- | ---------------------------------------------------------------- | -------- | --------- | ------------- |
| `PRD_CHANGE_LOAD_HIGH` | `changeLoad(product, quarter) == HIGH`                           | MEDIUM   | §5        | RADAR, INLINE |
| `PRD_CONCENTRATION`    | ≥ ε `PRIMARY`/`MAJOR` impacts on one product in one quarter      | MEDIUM   | ε = 4     | RADAR         |
| `PRD_MANDATORY_STACK`  | ≥ ε `MANDATORY` commitments impacting one product in one quarter | HIGH     | ε = 2     | RADAR         |
| `PRD_NO_OWNER`         | product/service with change load ≥ MEDIUM and no owner           | LOW      | —         | INLINE        |

### 4.7 History rules

Evaluated against closed-quarter reviews only.

| Code                      | Fires when                                                                | Severity | Threshold      | Recommendation                                                                     |
| ------------------------- | ------------------------------------------------------------------------- | -------- | -------------- | ---------------------------------------------------------------------------------- |
| `HST_RESERVE_EXCEEDED`    | team recorded operational load `ABOVE` in ε of the last δ closed quarters | MEDIUM   | ε = 2, δ = 3   | Raise default `BAU_SUPPORT` reserve by the median observed shortfall, rounded to 5 |
| `HST_RESERVE_UNUSED`      | team recorded `BELOW` in ε of last δ                                      | LOW      | ε = 3, δ = 3   | Consider lowering the reserve                                                      |
| `HST_CARRYOVER_PATTERN`   | team produced carry-over in ε of the last δ closed quarters               | MEDIUM   | ε = 2, δ = 3   | Review planning assumptions; show carried units per quarter                        |
| `HST_CAPACITY_OPTIMISTIC` | team recorded capacity `LOWER` than expected in ε of last δ               | MEDIUM   | ε = 2, δ = 3   | Lower `defaultQuarterCapacity` or record adjustments earlier                       |
| `HST_SIZE_DRIFT`          | median `finalUnits / unitsAtCommit` over the last δ closed quarters ≥ ε   | LOW      | ε = 1.3, δ = 3 | Sizing runs light; show the distribution                                           |

Every recommendation renders its inputs, its threshold, and a one-click command with a preview.
None is applied automatically.

### 4.8 Integrity rules

| Code                   | Fires when                                                   | Severity |
| ---------------------- | ------------------------------------------------------------ | -------- |
| `INT_DANGLING_REF`     | a non-archived entity references a tombstoned entity         | HIGH     |
| `INT_SCHEMA_AHEAD`     | a synced row carries a `schemaVersion` newer than this build | HIGH     |
| `SEC_SECRET_SUSPECTED` | deterministic secret pattern matched in a note or link label | HIGH     |
| `SCN_STALE`            | scenario `baseRevision < workspace.revision`                 | INFO     |
| `SCN_CONFLICT`         | rebase produced unresolved overlapping field conflicts       | MEDIUM   |

`SEC_SECRET_SUSPECTED` patterns (deterministic, no semantic classification):
PEM headers (`-----BEGIN * PRIVATE KEY-----`), `Bearer ey[A-Za-z0-9._-]{20,}`, JWT triples,
`AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{35}`, `xox[baprs]-[0-9A-Za-z-]{10,}`,
`gh[pousr]_[A-Za-z0-9]{36}`, `(password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*\S{8,}`,
and connection strings containing `password=`. On match: warn inline before save, offer to remove the
matched span, and never transmit the matched text to any external service.

## 5. Product change load

Deterministic, explainable, configurable. Computed per `(productService, quarter)`.

```
impactBase       = { PRIMARY: 3.0, MAJOR: 2.0, MINOR: 0.5, DEPENDENCY: 0.25 }   // ε
sizeFactor(c,q)  = clamp( unitsOf(c, q) / referenceUnits , 0.5 , 3.0 )          // referenceUnits ε = mapping.M = 20
classFactor(c)   = c.class == 'MANDATORY' ? 1.5 : 1.0                            // ε
lifecycleFactor  = c.lifecycle ∈ {COMMITTED, IN_DELIVERY} ? 1.0 : 0.0            // ideas contribute only in scenarios

contribution(c, q) = impactBase[impact.type] × sizeFactor(c,q) × classFactor(c) × lifecycleFactor(c)
changeLoadScore(p, q) = Σ contribution(c, q)  over commitments c that
                          (a) have a non-archived impact on p, and
                          (b) have a counted footprint in q
                          (falling back to targetQuarterId == q when they have no footprints)

changeLoadLevel(score) = score < ε_low   → 'LOW'          // ε_low  = 6
                         score < ε_high  → 'MEDIUM'       // ε_high = 12
                         otherwise       → 'HIGH'
```

`unitsOf(c, q)` is the sum of that commitment's counted footprint units in quarter `q` across all
teams — a commitment that is large for the _delivery_ organisation lands proportionally more change.

The explanation payload lists every contributor with its computed factors, sorted descending, so the
UI can render:

> **Account & Cash Management — 2027-Q1: HIGH (14.5)**
> Threshold for HIGH is 12.0.
> · _SEPA instant payments_ — PRIMARY × size 1.75 × mandatory 1.5 = **7.9**
> · _Statement redesign_ — MAJOR × size 1.0 = **2.0**
> · _Core ledger migration_ — MAJOR × size 2.25 = **4.5**
> · _Fraud rules uplift_ — MINOR × size 0.2… (clamped 0.5) = **0.25**

In Scenario Mode, `lifecycleFactor` is 1.0 for Ideas that the scenario has given ghost footprints,
and the panel shows baseline vs scenario side by side.

## 6. Radar

### 6.1 Modes

| Mode                       | Contents                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **My Radar**               | Signals whose entity has **explicit individual ownership** by the current user: commitment `ownerRef.kind == PERSON` linked to me, `nextActionOwnerRef` me, dependency owner me, or decision owner me |
| **Team / Portfolio Radar** | All non-suppressed signals in the workspace, including team-owned and unowned items                                                                                                                   |

Team-owned items appear on Team/Portfolio Radar, never on My Radar. This is what makes My Radar
trustworthy as a personal to-do surface rather than a second inbox.

### 6.2 Grouping

Radar groups by **reason**, not by commitment name. Group order is fixed:

1. **Action needed now** — severity HIGH with `dueOn <= today`
2. **This week** — `dueOn` within 7 days
3. **Emerging** — `dueOn` within 30 days
4. **Capacity** — `CAPACITY` category
5. **Dependencies & decisions** — `DEPENDENCY` category without a date
6. **Missing ownership** — `OWNERSHIP` category
7. **Idea decisions** — `READINESS` on `IDEA` entities
8. **Stale / review** — `HEALTH` staleness rules
9. **Portfolio patterns** — `PRODUCT`, `HISTORY`
10. **Integrity** — `INTEGRITY`

Within a group: severity descending, then `dueOn` ascending, then entity name.

### 6.3 Item anatomy

Each row shows: entity name · rule title · one-line message rendered from facts · required timing ·
owner · importance/class markers · quick actions.

Expanding shows the **explanation panel**: facts table, the threshold compared against, why it
matters, what changed since the last evaluation, and the suggested actions as buttons.

### 6.4 Quick actions

`Open` · `Reviewed — no change` · `Defer…` · plus up to two rule-specific `COMMAND` actions
(e.g. `Set owner`, `Resolve dependency`, `Open trade-off panel`).

Every quick action is reachable by keyboard from the list, and the list is the accessible companion
of every attention marker drawn on the map.

## 7. Rule settings

```ts
type RuleSettings = {
  enabled: Partial<Record<RuleCode, boolean>>; // advisory rules only; HIGH-severity integrity
  // and capacity rules cannot be disabled
  thresholds: Partial<Record<RuleCode, Record<string, number>>>;
  severityOverrides: Partial<Record<RuleCode, Severity>>; // may lower, never raise above HIGH
};
```

- Every threshold has a validated range; out-of-range values are rejected with the permitted range
  in the error.
- `Reset to defaults` is available per rule and for the whole set.
- The settings screen shows, for each rule, its plain-language definition, its current threshold,
  and **how many signals it is producing right now** — so tuning is evidence-based.
- Rules are **code-defined**. There is no scripting, no expression language, and no user-authored
  rule logic in the MVP. This is a security decision as much as a product one.

## 8. Determinism guarantees (property-tested)

1. `evaluateAll(state, clock)` is referentially transparent.
2. `signalKey` is stable across process restarts, machines, and export/import round trips.
3. `evaluateIncremental` ≡ `evaluateAll` for any command sequence.
4. No rule reads `Date.now()`, `Math.random()`, locale-dependent formatting, or object key order.
5. Suppression never hides a signal whose severity has increased.
6. Every `RuleResult` has an i18n key for title, message, explanation, and each action label.
7. Every rule code in the catalog has at least one positive and one negative fixture test.
