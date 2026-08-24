# 03 — Commands, Events & Permissions

One mutation model serves UI edits, undo/redo, scenarios, import, sync, and restore. Everything that
changes state is a **command**. Nothing writes to the repository directly.

## 1. Command contract

```ts
type Command<N extends string = string, P = unknown> = {
  id: EntityId; // ULID; also the idempotency key for sync
  name: N;
  workspaceId: WorkspaceId;
  payload: P;
  actorId: ActorId;
  issuedAt: IsoDateTime;
  batchId?: EntityId; // groups commands that must apply atomically
  scenarioId?: EntityId; // present => scenario overlay, MUST NOT touch baseline
  reason?: string; // optional user rationale, surfaced in history
};

type CommandResult = { ok: true; effects: CommandEffects } | { ok: false; error: DomainError };

type CommandEffects = {
  changes: EntityChange[]; // before/after with entityVersion transition
  events: DomainEvent[]; // meaningful management history only
  affectedProjections: ProjectionKey[]; // for localised rule + view recalculation
  inverse?: Command; // present when safely undoable
  consequences?: Consequence[]; // overflow, cascade, change-load shifts — advisory, non-blocking
  warnings?: RuleResult[]; // advisory guardrail violations that did not block
};

type EntityChange = {
  ref: EntityRef;
  op: 'CREATE' | 'UPDATE' | 'ARCHIVE' | 'RESTORE' | 'DELETE';
  fromVersion?: number;
  toVersion: number;
  before?: unknown; // omitted on CREATE
  after?: unknown; // omitted on DELETE
  changedFields: string[]; // drives field-level merge during sync
};

type ProjectionKey =
  | `capacity:${string}:${QuarterId}` // teamId:quarterId
  | `changeLoad:${string}:${QuarterId}` // productServiceId:quarterId
  | `commitment:${string}`
  | `dependencyGraph`
  | `radar`;
```

Rules:

- A command handler is a **pure function** `(state, command, ctx) => CommandResult`, where `ctx`
  supplies `Clock`, `IdGenerator`, `settings`, and `actorRole`. No I/O.
- Handlers validate in a fixed order: **authorisation → payload schema → referential existence →
  invariants → hard guardrails → apply**. Failing earlier stages never produce partial effects.
- `changedFields` is mandatory and drives sync's non-overlapping field merge
  ([07 §5](07-persistence-sync.md#5-conflict-resolution)). Getting it wrong causes false conflicts,
  so it is asserted in tests for every handler.
- A command batch (`batchId`) applies atomically: all effects or none.

## 2. Error model

```ts
type DomainError = {
  code: DomainErrorCode; // SCREAMING_SNAKE, stable, translatable key
  message: string; // rendered from i18n key `error.<code>` with params
  entityRef?: EntityRef;
  field?: string;
  params?: Record<string, string | number>;
  recovery?: SuggestedAction[];
};
```

Error codes are a closed enum in `@flowmap/domain`. Every code has an i18n entry and at least one
test that provokes it. Selected codes:

`UNAUTHORISED` · `WORKSPACE_NOT_FOUND` · `ENTITY_NOT_FOUND` · `ENTITY_ARCHIVED` ·
`STALE_VERSION` · `ILLEGAL_LIFECYCLE_TRANSITION` · `COMMIT_GATE_PRIMARY_TEAM_REQUIRED` ·
`COMMIT_GATE_FOOTPRINT_REQUIRED` · `COMMIT_GATE_PRIMARY_FOOTPRINT_MISMATCH` ·
`MANDATORY_TARGET_DATE_REQUIRED` · `RESERVES_EXCEED_CAPACITY` · `XL_REQUIRES_EXPLICIT_UNITS` ·
`FOOTPRINT_UNITS_MUST_BE_POSITIVE` · `DUPLICATE_FOOTPRINT` · `MULTIPLE_PRIMARY_IMPACTS` ·
`TOO_MANY_MILESTONES` · `NOTE_TOO_LONG` · `INSECURE_URL` · `SELF_DEPENDENCY` ·
`TEAM_HAS_ACTIVE_FOOTPRINTS` · `QUARTER_CLOSED` · `QUARTER_ALREADY_CLOSED` ·
`CARRY_OVER_NOT_REVIEWED` · `SCENARIO_STALE` · `SCENARIO_CONFLICT_UNRESOLVED` ·
`SCENARIO_CANNOT_MUTATE_BASELINE` · `IMPORT_MISSING_EXTERNAL_KEY` · `SCHEMA_VERSION_TOO_NEW`

## 3. Command catalog

Legend for **Role**: V = Viewer, C = Contributor, P = Planner, A = Admin (each implies the ones
before it). **Undo** marks commands with a safe inverse; the rest require snapshot restore or an
explicit compensating action.

### 3.1 Workspace & settings

| Command                                | Role | Notes                                                                     | Undo |
| -------------------------------------- | ---- | ------------------------------------------------------------------------- | ---- |
| `CreateWorkspace`                      | —    | Name + timezone only; seeds defaults, opens the map                       | —    |
| `RenameWorkspace`                      | P    |                                                                           | ✓    |
| `SetWorkspaceTimezone`                 | A    | Warns: changes date-boundary evaluation for all rules                     | ✓    |
| `SetSizeMapping`                       | P    | Affects new footprints only                                               | ✓    |
| `MigrateFootprintUnits`                | P    | Two-step: `preview` then `apply`; skips closed quarters                   | —    |
| `SetDefaultReserves`                   | P    | Reserves and the default quarter capacity; affects new team-quarters only | ✓    |
| `SetRuleThresholds`                    | P    | Per-rule; `ResetRuleThresholds` restores defaults                         | ✓    |
| `SetChangeLoadSettings`                | P    | Weights and thresholds                                                    | ✓    |
| `SetGuardrails`                        | P    | Enable/disable the configurable guardrail subset                          | ✓    |
| `SetValueDrivers`                      | P    | Rejects removal of a driver still in use unless `force`                   | ✓    |
| `ResetSampleWorkspace`                 | P    | Sample workspaces only                                                    | —    |
| `ArchiveWorkspace` / `DeleteWorkspace` | A    | Delete requires typing the workspace name                                 | —    |

### 3.2 Teams & capacity

| Command                                       | Role | Notes                                                                                       | Undo |
| --------------------------------------------- | ---- | ------------------------------------------------------------------------------------------- | ---- |
| `CreateTeam`                                  | P    | Name only; `displayOrder` appended                                                          | ✓    |
| `RenameTeam` / `SetTeamDescription`           | P    |                                                                                             | ✓    |
| `SetTeamDefaultCapacity`                      | P    | Seeds future team-quarters only                                                             | ✓    |
| `ReorderTeams`                                | P    | Explicit order; pressure never auto-reshuffles rows                                         | ✓    |
| `ArchiveTeam` / `RestoreTeam`                 | P    | Blocked while active footprints exist                                                       | ✓    |
| `EnsureTeamQuarter`                           | P    | Idempotent; creates with seeded defaults                                                    | —    |
| `SetCapacityAdjustment`                       | P    | Signed; optional note                                                                       | ✓    |
| `SetTeamDefaults`                             | P    | Capacity and reserves; seeds future team-quarters only                                      | ✓    |
| `SetTeamQuarterReserves`                      | P    | Replaces the list; rejects `HOLD`, closed quarters, and breaking `RESERVES_EXCEED_CAPACITY` | ✓    |
| `LinkIdeaToRefinementReserve` / `UnlinkIdea…` | C    | Qualitative only                                                                            | ✓    |
| `AcceptOverflow`                              | P    | Optional reason                                                                             | ✓    |

### 3.3 Commitments

| Command                                   | Role                             | Notes                                                                                 | Undo                   |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| `CreateIdea`                              | C                                | **Title only.** Lifecycle `IDEA`, class `DISCRETIONARY`, importance `MEDIUM`          | ✓                      |
| `RenameCommitment`                        | C                                |                                                                                       | ✓                      |
| `SetCommitmentClass` / `SetImportance`    | C                                |                                                                                       | ✓                      |
| `SetOwner`                                | C                                | Person or Team                                                                        | ✓                      |
| `SetPrimaryTeam`                          | P once committed, C while `IDEA` | Must match primary footprint once committed                                           | ✓                      |
| `SetTargetQuarter`                        | C                                | Chosen on the visual quarter strip, never a dropdown                                  | ✓                      |
| `SetTargetDate`                           | C                                | Any date; **derives** and overwrites `targetQuarterId`                                | ✓                      |
| `SetLatestSafeStart` / `SetAttentionDate` | C                                |                                                                                       | ✓                      |
| `SetNextAction`                           | C                                | Text + owner + due date, all optional individually                                    | ✓                      |
| `SetOutcome` / `SetValueDrivers`          | C                                |                                                                                       | ✓                      |
| `SetConfidence`                           | C                                | `{ size?, timing?, scope? }`                                                          | ✓                      |
| `SetManagementNote`                       | C                                | ≤ 2000; secret-pattern scan on paste                                                  | ✓                      |
| `SetCommitmentThemes`                     | C                                | Full set replace                                                                      | ✓                      |
| `PassCommitGate`                          | P                                | See §6                                                                                | ✓ (`RevertCommitGate`) |
| `RevertCommitGate`                        | P                                | Only if never `IN_DELIVERY`                                                           | ✓                      |
| `StartDelivery` / `CorrectToCommitted`    | P                                |                                                                                       | ✓                      |
| `HoldCommitment`                          | P                                | `{ preserveCapacity, reason? }`                                                       | ✓                      |
| `ResumeCommitment`                        | P                                | Restores `priorActiveLifecycle`                                                       | ✓                      |
| `CompleteCommitment`                      | P                                |                                                                                       | ✓                      |
| `DropCommitment`                          | P (C from `IDEA`)                | `{ reason? }`                                                                         | ✓                      |
| `RenewCommitment`                         | C                                | Creates a new commitment with `renewedFromCommitmentId`, copies configurable defaults | ✓                      |
| `SetRecurrence`                           | C                                | Metadata only through Pilot MVP; no auto-creation (R14)                               | ✓                      |
| `ArchiveCommitment` / `RestoreCommitment` | P                                | Cascade per [01 §12](01-domain-model.md#12-referential-integrity-policy)              | ✓                      |
| `DeleteCommitment`                        | A                                | Tombstone + cascade                                                                   | —                      |

### 3.4 Footprints

| Command                   | Role                             | Notes                                                     | Undo |
| ------------------------- | -------------------------------- | --------------------------------------------------------- | ---- |
| `AssignCapacityFootprint` | P (C while `IDEA` in a scenario) | `{ teamId, quarterId, size? \| units?, isPrimary? }`      | ✓    |
| `MoveCapacityFootprint`   | P                                | Changes team and/or quarter; preserves units              | ✓    |
| `ResizeCapacityFootprint` | P                                | `{ size? \| units }`                                      | ✓    |
| `SetFootprintConfidence`  | C                                |                                                           | ✓    |
| `SetPrimaryFootprint`     | P                                | Moves the `isPrimary` flag; may imply `SetPrimaryTeam`    | ✓    |
| `RemoveCapacityFootprint` | P                                | Archive, not delete                                       | ✓    |
| `SplitCapacityFootprint`  | P                                | `{ into: [{quarterId, units}] }`; sum must equal original | ✓    |

### 3.5 Products, dependencies, decisions, milestones

| Command                                                                                                                                    | Role                      | Notes                                                                                  | Undo |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------- | ---- |
| `CreateProductService` / `RenameProductService` / `ArchiveProductService`                                                                  | P                         |                                                                                        | ✓    |
| `SetProductImpact`                                                                                                                         | C                         | Upsert; enforces single `PRIMARY`                                                      | ✓    |
| `RemoveProductImpact`                                                                                                                      | C                         |                                                                                        | ✓    |
| `AddDependency`                                                                                                                            | C                         | Defaults: `type: REQUIRES`, `status: OPEN`, owner/needed-by optional                   | ✓    |
| `SetDependencyType` / `SetDependencyTarget` / `SetDependencyOwner` / `SetDependencyNeededBy` / `SetDependencyStatus` / `SetDependencyNote` | C                         |                                                                                        | ✓    |
| `RemoveDependency`                                                                                                                         | C                         |                                                                                        | ✓    |
| `CreateDecision`                                                                                                                           | C                         | Name only; `kind` defaults to `DECISION`                                               | ✓    |
| `SetDecisionOwner` / `SetDecisionNeededBy` / `ResolveDecision` / `ArchiveDecision`                                                         | C                         | Resolving a decision resolves nothing else automatically; dependent items get a signal | ✓    |
| `AddMilestone` / `UpdateMilestone` / `SetMilestoneStatus` / `RemoveMilestone`                                                              | C                         | Max 6                                                                                  | ✓    |
| `CreateTheme` / `RenameTheme` / `ArchiveTheme`                                                                                             | P                         |                                                                                        | ✓    |
| `CreatePerson` / `UpdatePerson` / `ArchivePerson` / `LinkPersonToUser`                                                                     | C (`LinkPersonToUser`: A) |                                                                                        | ✓    |
| `AddExternalLink` / `UpdateExternalLink` / `RemoveExternalLink`                                                                            | C                         | HTTPS only                                                                             | ✓    |

### 3.6 Radar, scenarios, quarter close, snapshots, views

| Command                                                                                | Role | Notes                                                           | Undo    |
| -------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------- | ------- |
| `ReviewSignal`                                                                         | V    | `Reviewed — no change`; records fingerprint + severity          | ✓       |
| `SnoozeSignal`                                                                         | V    | Requires return date or preset                                  | ✓       |
| `ClearSignalDisposition`                                                               | V    | Un-suppresses                                                   | ✓       |
| `CreateScenario` / `RenameScenario` / `CloneScenario` / `DiscardScenario`              | C    | Private by default                                              | —       |
| `RecordScenarioCommand`                                                                | C    | Appends to the overlay; never touches baseline                  | ✓ (pop) |
| `ShareScenario`                                                                        | C    | Explicit action; `PRIVATE → SHARED`                             | ✓       |
| `RebaseScenario`                                                                       | C    | Replays overlay onto current baseline revision                  | —       |
| `ApplyScenario`                                                                        | P    | Whole (default) or selective; transactional                     | —       |
| `OpenQuarterReview` / `RecordQuarterOutcome` / `ProposeCarryOver` / `ConfirmCarryOver` | P    |                                                                 | partial |
| `CloseQuarter`                                                                         | P    | Auto-snapshots, freezes team-quarters, advances current quarter | —       |
| `ReopenQuarter`                                                                        | A    | Confirmation required                                           | —       |
| `CreateSnapshot` / `DeleteSnapshot`                                                    | P    |                                                                 | —       |
| `RestoreSnapshot`                                                                      | P    | Diff + explicit confirmation required                           | —       |
| `SaveView` / `UpdateView` / `DeleteView`                                               | V    | Never changes data                                              | ✓       |
| `ApplyImport`                                                                          | P    | Single transaction over a previewed, validated mapping          | —       |
| `ClearLocalData`                                                                       | —    | Local-only; requires confirmation; does not touch shared store  | —       |

## 4. Domain events and "meaningful update"

Not every command produces an event. History records **management-meaningful** changes only.

Event-producing changes:

| Category      | Examples                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Lifecycle     | commit gate passed/reverted, delivery started, held/resumed, completed, dropped, renewed                              |
| Capacity      | footprint assigned/moved/resized/removed/split, reserve changed, capacity adjusted, overflow accepted, units migrated |
| Timing        | target quarter/date, latest safe start, attention date, milestone dates/status                                        |
| Ownership     | commitment owner, next-action owner, dependency owner, decision owner                                                 |
| Relationships | dependency added/removed/retargeted/status, product impact added/removed/retyped, theme set                           |
| Judgement     | management note added/changed, next action changed, scenario applied, quarter closed, snapshot restored               |

Non-event changes: cosmetic renames of the actor's own saved views, filter/zoom state, confidence
tweaks below the workspace threshold (configurable, default: all confidence changes **do** emit),
and reordering teams.

`lastMeaningfulUpdateAt` is set to the command's `issuedAt` whenever an event in the table above is
emitted for that commitment. `lastReviewedAt` is set only by `ReviewSignal` with disposition
`REVIEWED` on a signal whose entity is that commitment. Staleness rules use
`max(lastMeaningfulUpdateAt, lastReviewedAt)`.

`Reviewed — no change` therefore genuinely satisfies the staleness rule without inventing a status
report.

## 5. Undo / redo

- Scope: the **workspace session**. Undo stack is in-memory, capped at 100 entries, cleared on
  workspace switch and on sync-applied remote changes that touch the same entities.
- `Ctrl/Cmd + Z` undoes; `Ctrl/Cmd + Shift + Z` redoes.
- Undo executes the recorded `inverse` command as a normal command — it goes through
  authorisation and invariants, so an undo that would now be illegal is refused with an explanation
  rather than silently corrupting state.
- Commands without an inverse (`ApplyScenario`, `CloseQuarter`, `RestoreSnapshot`,
  `MigrateFootprintUnits`, `ApplyImport`, hard deletes) are **barriers**: performing one clears the
  undo stack, and the UI states this before the action ("This cannot be undone. A snapshot will be
  created first.").
- Every barrier command auto-creates a `Snapshot` immediately before applying.
- Routine drag/drop is immediate and reversible with **no confirmation modal**. Only materially
  cascading baseline changes show a consequence preview first
  ([05 §7](05-scenarios-qbr.md#7-consequence-preview)).

## 6. Guardrails

Two kinds, and the distinction is load-bearing:

- **Hard guardrails** reject the command. They protect model integrity. The set is small and mostly
  fixed.
- **Advisory guardrails** return `warnings` and let the command through. They protect quality of
  thinking, and the user is allowed to disagree.

### 6.1 Hard guardrails (fixed)

| Rule                                                          | Error                                    |
| ------------------------------------------------------------- | ---------------------------------------- |
| Commit Gate requires exactly one `primaryTeamId`              | `COMMIT_GATE_PRIMARY_TEAM_REQUIRED`      |
| Commit Gate requires ≥ 1 capacity footprint                   | `COMMIT_GATE_FOOTPRINT_REQUIRED`         |
| The primary team must have a footprint flagged `isPrimary`    | `COMMIT_GATE_PRIMARY_FOOTPRINT_MISMATCH` |
| `MANDATORY` commitments require a `targetDate` at Commit Gate | `MANDATORY_TARGET_DATE_REQUIRED`         |
| A footprint requires team + quarter + `units > 0`             | `FOOTPRINT_UNITS_MUST_BE_POSITIVE`       |
| At most one `PRIMARY` product impact                          | `MULTIPLE_PRIMARY_IMPACTS`               |
| Reserves may not exceed effective capacity                    | `RESERVES_EXCEED_CAPACITY`               |
| Notes ≤ 2000 characters                                       | `NOTE_TOO_LONG`                          |
| External links must be `https:`                               | `INSECURE_URL`                           |
| ≤ 6 milestones per commitment                                 | `TOO_MANY_MILESTONES`                    |
| No mutation of a closed team-quarter                          | `QUARTER_CLOSED`                         |
| A scenario command may not write baseline state               | `SCENARIO_CANNOT_MUTATE_BASELINE`        |

**Overflow is explicitly not a hard guardrail.** A Planner may commit into overflow; the product
explains, it does not block.

### 6.2 Advisory guardrails (workspace-configurable)

Missing owner · missing product impact · no dependencies reviewed · no target date on non-mandatory
work · `LOW` size confidence on large committed work · no outcome statement · no external link ·
commitment spanning more than 3 quarters · idea older than N days with no refinement link.

Each appears at Commit Gate as a dismissible checklist showing what is missing and why it matters,
and each has a rule code so it can also surface in Radar
([04 §4](04-rules-radar.md#4-readiness--governance-rules)).

## 7. Permission matrix

Authorisation is checked **in the domain layer**, not only in the UI. The same matrix is used by the
UI to disable/hide affordances, so the two can never diverge.

```ts
type Role = 'VIEWER' | 'CONTRIBUTOR' | 'PLANNER' | 'ADMIN';
const REQUIRED_ROLE: Record<CommandName, Role> = {/* generated from the catalog tables */};
function authorise(cmd: Command, role: Role): boolean; // ordinal comparison
```

| Capability                                                        |  V  |  C  |  P  |         A         |
| ----------------------------------------------------------------- | :-: | :-: | :-: | :---------------: |
| Read everything, explore, filter, focus                           |  ✓  |  ✓  |  ✓  |         ✓         |
| Save personal views, export a view                                |  ✓  |  ✓  |  ✓  |         ✓         |
| Review / snooze Radar signals                                     |  ✓  |  ✓  |  ✓  |         ✓         |
| Create & edit Ideas, notes, links, milestones                     |     |  ✓  |  ✓  |         ✓         |
| Create dependencies, decisions, product impacts, themes*          |     |  ✓  |  ✓  |         ✓         |
| Create private scenarios, share for review                        |     |  ✓  |  ✓  |         ✓         |
| Pass / revert Commit Gate                                         |     |     |  ✓  |         ✓         |
| Move or resize committed capacity                                 |     |     |  ✓  |         ✓         |
| Change team capacity, adjustments, reserves                       |     |     |  ✓  |         ✓         |
| Apply a scenario to baseline                                      |     |     |  ✓  |         ✓         |
| Close / reopen a quarter                                          |     |     |  ✓  | A only for reopen |
| Import, restore snapshot, migrate units                           |     |     |  ✓  |         ✓         |
| Workspace settings, thresholds, guardrails                        |     |     |  ✓  |         ✓         |
| Hard delete, delete workspace, assign roles, run schema migration |     |     |     |         ✓         |

\* `CreateTheme` is Planner (themes are a workspace taxonomy); assigning themes to a commitment is
Contributor.

**Stated in the UI:** application roles are behavioural controls. The security boundary is the
underlying store's permissions. A Viewer with write access to the SharePoint list can still write
to the store outside Flowmap; the product says so in workspace settings rather than implying a
guarantee it cannot make.
