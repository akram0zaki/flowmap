# Delivery Radar - Implementation Plan

## 1. Purpose

This plan turns the PRD, UX specification, technical architecture, and phased build plan into an executable delivery sequence.

It separates the delivery into three confirmed release gates rather than treating all of them as one MVP:

1. **Product validation alpha** - proves that the visual model, capacity semantics, Radar, and scenario interaction solve the lead's planning problem.
2. **Pilot MVP** - supports repeated use by a small group with local persistence, portability, desktop packaging, and recovery.
3. **Shared production release** - adds approved identity, shared storage, synchronization, permissions, conflict handling, and enterprise hardening.

The plan assumes an empty implementation repository and treats the existing documents as product inputs, not as finalized engineering contracts.

---

## 1.1 Confirmed Decisions

| Date       | Decision                                  | Outcome                                                                                                                                                                                                                                                                                                           |
| ---------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-14 | Release boundary                          | Delivery Radar will use three release gates: Product validation alpha, Pilot MVP, and Shared production release.                                                                                                                                                                                                  |
| 2026-08-14 | Lifecycle capacity inclusion              | `COMMITTED` and `IN_DELIVERY` consume delivery baseline capacity. `DONE` and `DROPPED` do not. `ON_HOLD` releases capacity unless a Planner explicitly preserves it as a reserve. Pre-delivery refinement consumes the separate, linkable team-quarter refinement reserve.                                        |
| 2026-08-14 | Capacity sizing                           | Capacity is calculated from explicit units on each team-quarter footprint. XS through L resolve to workspace mapping values when a footprint is created; XL requires explicit units. Commitment size is a summary, and mapping changes affect future footprints only unless a Planner runs a previewed migration. |
| 2026-08-14 | Planning calendar                         | Planning always uses calendar quarters: Q1 January-March, Q2 April-June, Q3 July-September, and Q4 October-December. Fiscal or custom quarter calendars are out of scope.                                                                                                                                         |
| 2026-08-14 | Unplanned work                            | Material unplanned work is captured during an active quarter through the streamlined `IDEA` -> Commit Gate -> `COMMITTED` -> `IN_DELIVERY` path and may consume that active quarter's capacity.                                                                                                                   |
| 2026-08-14 | Refinement capacity                       | Refinement of a topic can begin before delivery. It consumes a small amount of capacity through a team-quarter refinement reserve/bucket, which can be linked to an Idea. It is separate from the full delivery commitment.                                                                                       |
| 2026-08-14 | Pre-delivery lifecycle                    | `IDEA` is the single pre-delivery lifecycle state. `CANDIDATE` is removed. Commit Gate promotes an Idea directly to `COMMITTED`.                                                                                                                                                                                  |
| 2026-08-14 | Refinement links                          | Links from a team-quarter refinement bucket to Ideas are qualitative. They explain what the aggregate bucket supports and do not allocate additional capacity units to individual Ideas.                                                                                                                          |
| 2026-08-14 | Unplanned-work entry                      | Material unplanned work is captured through a streamlined `IDEA` -> Commit Gate -> `COMMITTED` -> `IN_DELIVERY` path, even during an active quarter. It must not be created directly in `IN_DELIVERY`.                                                                                                            |
| 2026-08-14 | Hold and terminal states                  | `ON_HOLD` resumes the previously recorded active lifecycle state. `DONE` and `DROPPED` are terminal; renewed work creates a new commitment linked to the original.                                                                                                                                                |
| 2026-08-14 | Scenario rebase                           | Each scenario records its baseline version. When baseline changes, its commands replay against the latest baseline; overlapping field changes become explicit conflicts that must be resolved before apply.                                                                                                       |
| 2026-08-14 | Dependency direction                      | Every dependency points from the work waiting (`source`) to its prerequisite (`target`), including dependencies that need a decision or approval.                                                                                                                                                                 |
| 2026-08-14 | Progressive capture                       | Across all boards, creation uses the absolute minimum required input plus smart defaults. Users can create visual relationships by drag and refine optional data later; creation must not require a multi-field form.                                                                                             |
| 2026-08-14 | Decision and approval targets             | Decisions and approvals are first-class dependency targets, visible in Radar and the Dependency Map. Owner, needed-by date, and status use defaults or remain optional when the target is created.                                                                                                                |
| 2026-08-14 | Dependency creation default               | A dependency created visually defaults to type `REQUIRES`; users can refine its type later.                                                                                                                                                                                                                       |
| 2026-08-14 | Radar review disposition                  | `Reviewed — no change` suppresses the current signal until its condition changes or its severity increases; it does not reappear merely because a fixed time elapsed.                                                                                                                                             |
| 2026-08-14 | Product change load                       | Product/service change load starts as an explainable low/medium/high signal based on overlapping Primary and Major impacts, with extra weight for large or mandatory work and workspace-configurable thresholds.                                                                                                  |
| 2026-08-14 | Workspace timezone                        | Each workspace has one timezone for date and Radar-rule evaluation. It is selected at workspace creation and defaults to the creating user's local timezone.                                                                                                                                                      |
| 2026-08-14 | Portfolio Map grammar                     | Quarters run left to right. Teams are the primary capacity rows. Commitment blocks sit inside team-quarter containers. Products/services are shown through a linked overlay or Product lens rather than a competing permanent layout.                                                                             |
| 2026-08-14 | Initial pilot persona                     | Initial validation targets a portfolio lead coordinating roughly 4-5 teams during quarterly planning. Other lead roles will not drive the first workflow.                                                                                                                                                         |
| 2026-08-14 | Workspace roles                           | Viewers read and explore. Contributors create/edit Ideas, dependencies, impacts, and private scenarios. Planners change baseline capacity, pass Commit Gate, move committed work, apply scenarios, and manage workspace settings.                                                                                 |
| 2026-08-14 | Removal and history                       | User-facing removal archives an item, preserving its links and history. Hard deletion is administrator-only and synchronizes as a tombstone.                                                                                                                                                                      |
| 2026-08-14 | Snapshots and saved views                 | Restorable workspace snapshots capture data and require a diff plus confirmation to restore. Saved views capture lens, filters, horizon, and focus only; they never change data.                                                                                                                                  |
| 2026-08-14 | Radar snooze                              | Snooze requires a return date or quick preset. A material severity increase can surface the signal before that date.                                                                                                                                                                                              |
| 2026-08-14 | My Radar ownership                        | My Radar includes signals tied to the current user's explicit individual ownership: commitment owner, next-action owner, dependency owner, or decision/approval owner. Team-owned items appear on Team/Portfolio Radar.                                                                                           |
| 2026-08-14 | Import matching                           | Updating an existing record through import requires a stable external key. Rows without one create new records; potential duplicates are shown in the preview and never silently merged.                                                                                                                          |
| 2026-08-14 | Accessibility                             | WCAG 2.2 AA is the conformance target. Every primary drag/map interaction requires a keyboard equivalent and a list/table companion.                                                                                                                                                                              |
| 2026-08-14 | Performance acceptance                    | A 500-commitment workspace is the required scale. Local load should complete in about two seconds and drag/placement feedback should arrive within 100 ms on a normal enterprise laptop.                                                                                                                          |
| 2026-08-14 | Local cache encryption                    | Cache encryption at rest is deferred. Reassess it during enterprise production readiness with the security review; do not treat deferral as an exemption from data classification, secure token storage, or clear-local-data behavior.                                                                            |
| 2026-08-14 | Portable workspace handling               | Portable workspace exports remain unencrypted files and display a clear sensitivity warning before both export and import.                                                                                                                                                                                        |
| 2026-08-14 | Technical baseline and shared persistence | Alpha and Pilot MVP use React, TypeScript, Tauri 2, and local SQLite. SQLite is not shared storage. The final product requires a shared persistence provider: SharePoint Lists or a safely versioned shared document, selected through the provider spike.                                                        |
| 2026-08-14 | Shared-document format                    | Excel is limited to import/export. Shared persistence will evaluate SharePoint Lists against a safely versioned JSON workspace document.                                                                                                                                                                          |
| 2026-08-14 | Management notes                          | Management notes are capped at 2,000 characters. Deterministic secret-pattern detection warns on paste, reinforcing that the product is not a document or incident-data store.                                                                                                                                    |
| 2026-08-14 | Recurring commitments                     | Automatic recurrence creation is deferred beyond the Pilot MVP. Pilot users create or duplicate each recurring instance manually so each keeps independent history.                                                                                                                                               |
| 2026-08-14 | Native notifications                      | Native desktop notifications are included in the Pilot MVP. Radar remains the source of truth, but timely system notifications are part of the pilot experience.                                                                                                                                                  |
| 2026-08-14 | Notification eligibility                  | Pilot notifications cover attention dates, owned actions due, overdue dependencies, material health deterioration, and material baseline changes affecting the user. Settings include urgent-only, my actions, portfolio warnings, and stale items.                                                               |
| 2026-08-14 | Local identity                            | Alpha and Pilot MVP use a simple local profile for history attribution. It can later be linked to a Microsoft identity without rewriting existing history.                                                                                                                                                        |
| 2026-08-14 | Workspace isolation                       | Workspaces remain independent through the Pilot MVP. Cross-workspace dependencies and executive roll-ups are deferred.                                                                                                                                                                                            |
| 2026-08-14 | First-run setup                           | A new workspace asks only for its name, defaults to the current calendar quarter and user-local timezone, then opens directly into the map with progressive prompts for teams, products, and Ideas.                                                                                                               |
| 2026-08-14 | Commit Gate guardrails                    | Commit Gate requires only a primary team and at least one team-quarter footprint. Missing owner, product impact, dependencies, and target date remain visible warnings; mandatory work additionally requires a target date.                                                                                       |
| 2026-08-14 | Idea placement                            | Uncommitted Ideas live in a separate Ideas/Demand lane. They appear on the Portfolio Map only as linked markers from a refinement reserve and do not occupy team-quarter capacity blocks before Commit Gate.                                                                                                      |
| 2026-08-14 | Dependency cycles                         | Dependency cycles are allowed so the model can represent reality. They generate a clear explanatory warning in Radar and the Dependency Map rather than blocking entry.                                                                                                                                           |
| 2026-08-14 | Team row order                            | Team rows default to alphabetical order. Planners may reorder them manually; capacity pressure never automatically reshuffles the map.                                                                                                                                                                            |
| 2026-08-14 | Ideas in scenarios                        | A private scenario can assign tentative team-quarter footprints to an Idea as ghost blocks without changing its baseline lifecycle. Applying that scenario passes the Idea through Commit Gate.                                                                                                                   |
| 2026-08-14 | Dependency defaults                       | Newly created dependencies and Decision/Approval targets default to `OPEN`; owner and needed-by date are optional until supplied later.                                                                                                                                                                           |
| 2026-08-14 | Missing-owner Radar rule                  | Radar flags a missing owner only for committed commitments, or dependencies/decisions that have a needed-by date. It does not flag a newly captured item immediately.                                                                                                                                             |
| 2026-08-14 | Management history                        | Activity history records only meaningful management changes: lifecycle, capacity, dates, dependencies, milestones, actions, and notes. It does not record every field edit.                                                                                                                                       |
| 2026-08-14 | Target timing                             | Target quarter is the primary planning selection and is chosen directly on a visual quarter timeline, not from a dropdown. A target date is optional precision added later. When the user enters a date directly, it may be any date and automatically updates the target calendar quarter.                       |
| 2026-08-14 | Quarter close                             | Closing a quarter is an explicit Planner action after review; the calendar never rolls a workspace forward automatically.                                                                                                                                                                                         |
| 2026-08-14 | Carry-over proposal                       | At quarter close, Delivery Radar proposes a best-effort receiving-quarter footprint equal to the unfinished commitment's final planned footprint in the closing quarter. A Planner must review and confirm or adjust it; it is never created automatically.                                                       |
| 2026-08-14 | Default size mapping                      | New workspaces use a 100-unit team-quarter baseline with `XS=5`, `S=10`, `M=20`, `L=35`, and explicit units required for `XL`.                                                                                                                                                                                    |
| 2026-08-14 | Default reserves                          | Each new team-quarter starts with 15 units of BAU/support reserve and 5 units of refinement reserve, leaving 80 units for committed delivery.                                                                                                                                                                     |
| 2026-08-14 | Capacity overflow                         | Commit Gate permits a Planner to accept work that overflows a team-quarter. The product shows the exact excess and consequences rather than blocking the decision.                                                                                                                                                |
| 2026-08-14 | Overflow rationale                        | A Planner may add an optional reason when accepting overflow, but no additional justification form is required.                                                                                                                                                                                                   |
| 2026-08-14 | Product impact focal point                | A commitment may have at most one `PRIMARY` product/service impact. Additional impacts use `MAJOR`, `MINOR`, or `DEPENDENCY`.                                                                                                                                                                                     |
| 2026-08-14 | Primary delivery team                     | Commit Gate requires exactly one primary team. All additional team work is represented by secondary capacity footprints.                                                                                                                                                                                          |
| 2026-08-14 | Primary footprint                         | The primary team must have a matching primary capacity footprint; it cannot be only an accountability label.                                                                                                                                                                                                      |
| 2026-08-14 | Desktop updates                           | Pilot MVP uses manually distributed, signed installers. Automatic update is deferred until enterprise policy permits it.                                                                                                                                                                                          |
| 2026-08-14 | Diagnostics and telemetry                 | Pilot MVP has no automatic telemetry. Users may generate an opt-in, redacted diagnostic export to attach to a support request.                                                                                                                                                                                    |
| 2026-08-14 | Notification runtime                      | Pilot notifications run while Delivery Radar is open. Conditions missed while closed appear in Radar on the next launch; background notification support is deferred.                                                                                                                                             |
| 2026-08-14 | Quick Capture                             | Quick Capture requires only a title and creates an Idea in the Ideas/Demand lane. Name entry happens inline on the graphical board; team, quarter, owner, size, and other data remain optional additions.                                                                                                         |
| 2026-08-14 | External links                            | External links accept HTTPS URLs only and open in the system browser. Enterprise systems are referenced, never embedded.                                                                                                                                                                                          |
| 2026-08-14 | Shared-edit conflicts                     | Non-overlapping field changes merge automatically. Overlapping field changes require an explicit user choice and are never silently overwritten.                                                                                                                                                                  |
| 2026-08-14 | Schema migration recovery                 | Before any workspace schema migration, Delivery Radar creates a local recovery backup and provides a restore path if migration fails.                                                                                                                                                                             |
| 2026-08-14 | Language scope                            | Pilot MVP is English-only. UI copy remains structured to permit future localization.                                                                                                                                                                                                                              |
| 2026-08-14 | Supported environments                    | Pilot MVP supports only the Windows and macOS versions currently approved in the enterprise environment. The exact version matrix is established through the managed-device feasibility spike.                                                                                                                    |
| 2026-08-14 | Shared scenarios                          | Contributors may share scenarios for review. Only Planners may apply scenario changes to the shared baseline.                                                                                                                                                                                                     |
| 2026-08-14 | Scenario visibility                       | New scenarios are private by default. Sharing is always an explicit action.                                                                                                                                                                                                                                       |
| 2026-08-14 | Scenario application                      | A Planner may selectively apply individual scenario changes; accepting or rejecting the whole scenario is never required.                                                                                                                                                                                         |
| 2026-08-14 | Scenario apply default                    | Applying the complete scenario is the default Planner action. Selective apply is available; unresolved dependency consequences are shown but do not hard-block the decision, and an optional reason may be recorded.                                                                                              |
| 2026-08-14 | Validation group                          | Product Validation Alpha uses two target portfolio leads, not a larger study group.                                                                                                                                                                                                                               |
| 2026-08-14 | First-run guidance                        | First-run guidance uses contextual tooltips that point users to important parts of the product. It is part of the product experience, not separate documentation.                                                                                                                                                 |
| 2026-08-14 | Tooltip behavior                          | First-run tooltips are non-blocking, dismissible, and reopenable. They never force the user through a mandatory walkthrough.                                                                                                                                                                                      |
| 2026-08-14 | Pilot support ownership                   | The user who first runs the application becomes the initial workspace owner and default recipient for locally generated diagnostic exports.                                                                                                                                                                       |
| 2026-08-14 | Shared provider preference                | SharePoint Lists is the preferred shared provider for multi-user workspaces. A safely versioned JSON workspace document is retained as the fallback.                                                                                                                                                              |
| 2026-08-14 | Installation policy                       | No-admin installation is a hard product requirement. Managed enterprise distribution is the fallback only when policy blocks a user-installed package.                                                                                                                                                            |
| 2026-08-14 | Offline access expiry                     | A locally cached shared workspace remains usable for 30 days after the last successful authentication, subject to enterprise security policy.                                                                                                                                                                     |
| 2026-08-14 | Shared identity                           | Shared collaboration uses Microsoft Entra identity only. Delivery Radar does not provide separate usernames or passwords.                                                                                                                                                                                         |

---

## 2. Gaps to Close

### 2.1 Blocking product and domain decisions

These decisions affect the data model and should be resolved before Phase 2.

| Area                   | Current gap                                                                                                                                                                                                            | Proposed working decision                                                                                                                                                                                                                                                                                                                                                                                                         | Required by |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| MVP boundary           | The PRD's MVP contains almost the entire product, desktop runtime, offline sync, collaboration, and enterprise distribution. It cannot function as a useful validation cut.                                            | **Confirmed:** use the three release gates in this plan. Validate the management loop locally before shared storage.                                                                                                                                                                                                                                                                                                              | Phase 0     |
| Initial user           | "Lead" covers several roles with different planning authority and meeting cadence.                                                                                                                                     | **Confirmed:** initial validation targets a portfolio lead coordinating roughly 4-5 teams through quarterly planning. Other roles remain secondary until this workflow is validated.                                                                                                                                                                                                                                              | Phase 0     |
| Capacity inclusion     | The PRD says only `COMMITTED` consumes baseline, but `IN_DELIVERY` work must normally consume capacity too. `ON_HOLD` behavior is unspecified. Refinement can also consume a small amount of capacity before delivery. | **Confirmed:** `COMMITTED` and `IN_DELIVERY` consume delivery baseline. `ON_HOLD` releases capacity unless explicitly preserved as a reserve. Refinement consumes the separate, linkable team-quarter refinement reserve; Idea links are qualitative and do not allocate additional units.                                                                                                                                        | Phase 1     |
| Size semantics         | A commitment has a size while each team-quarter footprint also has a size and capacity units. XL is open-ended. It is unclear which value drives capacity.                                                             | **Confirmed:** capacity is calculated only from footprint units. Commitment size is an optional summary. Each relative-size mapping resolves to explicit units when a footprint is created; XL requires an explicit unit value.                                                                                                                                                                                                   | Phase 1     |
| Size mapping changes   | It is unclear whether changing workspace XS-XL mappings recalculates existing plans.                                                                                                                                   | **Confirmed:** existing footprint units remain stable. Mapping changes affect new footprints unless a Planner runs an explicit, previewed migration.                                                                                                                                                                                                                                                                              | Phase 1     |
| Quarter model          | Calendar versus fiscal quarters, quarter boundaries, locale, and timezone are not defined.                                                                                                                             | **Confirmed:** use fixed calendar quarters: Q1 January-March, Q2 April-June, Q3 July-September, and Q4 October-December. Fiscal/custom quarter calendars are out of scope. Quarter IDs remain structured rather than label-derived. Each workspace uses a timezone selected at creation, defaulting to the creator's local timezone, for dates and Radar-rule evaluation.                                                         | Phase 1     |
| Lifecycle transitions  | Allowed transitions and required fields are not specified. Commit Gate is described, but direct edits are not.                                                                                                         | **Confirmed:** `IDEA` is the only pre-delivery state; Commit Gate promotes it directly to `COMMITTED`. Material unplanned work uses a streamlined `IDEA` -> Commit Gate -> `COMMITTED` -> `IN_DELIVERY` path, including during an active quarter. `ON_HOLD` resumes its recorded prior active state. `DONE` and `DROPPED` are terminal; renewed work becomes a linked new commitment.                                             | Phase 1     |
| Scenario staleness     | The baseline may change after a scenario is created. Rebase, selective apply, and apply conflicts are undefined.                                                                                                       | **Confirmed:** a scenario stores a base workspace revision plus an ordered command overlay. Compare/apply replays it against the current baseline, reports overlapping field changes as conflicts, and blocks apply until they are resolved.                                                                                                                                                                                      | Phase 3     |
| Dependency direction   | Labels such as "blocked by" can invert source/target meaning. The `DECISION` target exists without a Decision entity.                                                                                                  | **Confirmed:** source is the work waiting and target is its prerequisite for every type. Decisions and approvals are first-class targets, but their additional metadata is optional at creation.                                                                                                                                                                                                                                  | Phase 1     |
| Product change load    | Low/medium/high has inputs but no deterministic formula, overlap window, or configurable defaults.                                                                                                                     | **Confirmed:** use a simple explainable weighted-overlap rule. Primary/Major impacts drive the signal; large or mandatory work adds weight; workspace thresholds are configurable and contributing impacts are shown.                                                                                                                                                                                                             | Phase 4     |
| Radar signal state     | Stable signal identity, deduplication, snooze breakthrough, review expiry, and My Radar ownership rules are not defined.                                                                                               | **Confirmed:** computed signals get a deterministic key from rule, entity, and condition. Persist user disposition separately. `Reviewed — no change` remains suppressed until severity rises or the condition fingerprint changes. Snooze requires a return date/preset and can be overridden by material severity increase. My Radar includes only explicit individual ownership; team-owned items are in Team/Portfolio Radar. | Phase 2     |
| History and snapshots  | Audit history, recovery snapshots, and saved visual/presentation states are conflated.                                                                                                                                 | **Confirmed:** use three concepts: domain change events, restorable workspace snapshots with diff/confirmation, and non-restorable saved views for lens, filters, horizon, and focus.                                                                                                                                                                                                                                             | Phase 1     |
| Deletion and retention | Archive/delete behavior, cascades, tombstones, workspace deletion, and retention are absent.                                                                                                                           | **Confirmed:** archive is the normal user-facing removal action; hard deletion is administrator-only and uses synchronized tombstones. Define referential-integrity behavior per entity before import and sync.                                                                                                                                                                                                                   | Phase 1     |
| Local identity         | History requires "who" before Entra identity exists.                                                                                                                                                                   | **Confirmed:** local mode creates a simple profile ID for history attribution that can later be linked to an authenticated Microsoft workspace user without rewriting history.                                                                                                                                                                                                                                                    | Phase 1     |
| Authorization          | Roles are described broadly but there is no command-level permission matrix.                                                                                                                                           | **Confirmed role boundary:** Viewers read/explore; Contributors create/edit Ideas, dependencies, impacts, private scenarios, and share scenarios for review; Planners change baseline capacity, pass Commit Gate, move committed work, apply scenarios, and manage settings. Specify each command under this boundary, including reserve changes, imports, restore, and workspace administration.                                 | Phase 5     |

### 2.2 Blocking technical decisions

These should be tested rather than settled only on paper.

| Area                            | Current gap                                                                                                                                      | Action                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual layout                   | The Portfolio Map's spatial structure, zoom thresholds, and simultaneous team/product representation are not concrete enough to implement.       | **Confirmed foundation:** quarters run left to right; teams are capacity rows; commitment blocks occupy team-quarter containers; products/services are a linked overlay or Product lens. Prototype semantic zoom and product-overlay interaction with representative data before committing to detailed behavior.    |
| Tauri in the target environment | System WebView, no-admin installation, signing, proxy, endpoint controls, and macOS notarization are external constraints.                       | Produce an empty signed-or-signable Tauri spike on managed Windows and macOS during Phase 0.                                                                                                                                                                                                                         |
| Shared provider viability       | SharePoint list topology, delegated Graph permissions, ETags, batching, throttling, transactions, and provisioning are unresolved.               | **Confirmed preference:** SharePoint Lists for multi-user workspaces; a safely versioned JSON workspace document is fallback only. Run a narrow Phase 0 provider spike to validate that preference. Excel is import/export only. Do not build the provider fully until the local product loop is validated.          |
| Provider contract               | The proposed interface omits transactions, idempotency, pagination, deletions, schema versions, migrations, and provider capability differences. | Define a capability-aware repository/sync contract around versioned entity changes, not whole-workspace reads alone.                                                                                                                                                                                                 |
| Event model                     | Scenario overlays, undo/redo, history, restore, sync, and conflict handling all require compatible mutation semantics.                           | Adopt command-based domain mutations that emit versioned entity changes and domain events. This is not full event sourcing.                                                                                                                                                                                          |
| Local database security         | "Encrypt where practical" is not an acceptance criterion.                                                                                        | **Deferred:** cache encryption at rest. Complete data classification and threat-model decisions for key storage, logs, exports, crash data, clear-data behavior, and offline expiry. Reassess cache encryption during enterprise production readiness.                                                               |
| Import identity                 | Update matching, duplicate handling, cross-sheet references, and partial failure behavior are unspecified.                                       | **Confirmed:** updating an existing record requires a stable external key. Otherwise the row creates a new record and possible duplicates are shown in preview, never silently merged. Require previewed mappings and apply imports as a validated transaction.                                                      |
| Accessibility target            | Requirements are directional but no conformance target or supported assistive technology is named.                                               | **Confirmed:** target WCAG 2.2 AA for the web content surface. Every primary visual interaction needs keyboard and list/table alternatives; define a manual desktop test matrix for keyboard and screen readers.                                                                                                     |
| Performance target              | No reference hardware, fixture, memory budget, or worst-case interaction is defined.                                                             | **Confirmed:** test deterministic 25-, 100-, and 500-commitment fixtures. At target scale, local load should complete in about two seconds and drag/placement feedback within 100 ms on a normal enterprise laptop. Name the representative hardware and benchmark interactions in Phase 0.                          |
| Operations                      | Update mechanism, diagnostics, rollback, migration recovery, support ownership, and telemetry policy are not defined.                            | **Confirmed:** Pilot uses manual signed installers, no automatic telemetry, opt-in redacted diagnostic exports, and migration recovery backups. The user who first runs the application is the initial workspace owner and diagnostic recipient. Complete retention and operating procedures before pilot packaging. |

### 2.3 Product validation gaps

The success statement is clear, but measurement needs more definition.

- Establish a baseline for the current QBR workflow: preparation time, number of source artifacts, reconciliation time, and missed/late attention items.
- Define task-based usability measures for portfolio comprehension, idea placement, overload explanation, dependency tracing, and scenario comparison.
- Define trust measures: incorrect signals, unexplained capacity results, stale records, and silent data-loss incidents.
- Decide how learning will be collected if product telemetry is not allowed. A structured pilot diary and observed sessions are sufficient for alpha.
- Validate terminology with both a business lead and a technology lead. In particular: commitment, footprint, reserve, health, attention, carry-over, and Commit Gate.

---

## 3. Engineering Principles

1. **Build vertical management loops.** Each phase must produce a workflow a user can exercise, not only technical layers.
2. **Keep domain logic independent.** Capacity, scenarios, rules, permissions, and history live in pure TypeScript packages without React or provider dependencies.
3. **Use one mutation model.** UI edits, undo/redo, scenarios, history, import, sync, and restore use the same domain commands and versioned change representation.
4. **Treat baseline and scenario as separate projections.** Scenario operations never mutate baseline until an explicit apply command succeeds.
5. **Make explanations data.** Rules and derived load calculations return codes, contributing facts, and suggested actions; UI copy is rendered from those results.
6. **Design for keyboard use with the visual prototype.** Accessible alternatives are part of each visual slice, not a final audit task.
7. **Start with SVG and DOM.** Move a view to Canvas/WebGL only after a measured performance failure and an accessibility plan.
8. **Prove external constraints early.** Tauri and SharePoint receive early feasibility spikes but not premature production implementations.
9. **Capture progressively.** Every board supports direct visual creation with the minimum information needed to preserve a valid model; enrich data in context only when it becomes useful.

---

## 4. Proposed Technical Baseline

The following is a starting point to confirm with architecture spikes.

### 4.1 Repository

- pnpm workspace with TypeScript project references
- `apps/desktop` - Tauri 2 shell and React/Vite application
- `packages/domain` - entities, value objects, commands, invariants, projections
- `packages/rules` - deterministic rules and explanations
- `packages/visual-model` - layout-neutral view models and selection/focus state
- `packages/storage` - provider contracts, versions, change sets, migrations
- `packages/storage-local` - SQLite repository and mutation queue
- `packages/storage-sharepoint` - isolated SharePoint Lists provider, added after spike approval
- `packages/storage-file` - safely versioned shared-document provider and portable fallback
- `packages/import-export` - parsers, mapping, validation, export
- `packages/ui` - design tokens and reusable accessible controls
- `fixtures` - sample, benchmark, import, and conflict workspaces

### 4.2 Frontend and state

- React + TypeScript + Vite
- Zustand for transient editor/view state unless the initial spike shows a need for Redux Toolkit
- TanStack Query only at asynchronous repository/provider boundaries
- Zod schemas at file, provider, IPC, and import boundaries
- React Hook Form for detail/configuration forms
- SVG/DOM for Portfolio, Capacity, Demand Flow, and Timeline
- React Flow plus ELK, or Cytoscape, selected by a measured dependency-map spike

### 4.3 Domain mutation model

Use explicit commands such as:

- `CreateCommitment`
- `SetLifecycle`
- `AssignCapacityFootprint`
- `MoveCapacityFootprint`
- `SetProductImpact`
- `AddDependency` (default type: `REQUIRES`)
- `ReviewRadarSignal`
- `ApplyScenario`
- `CloseQuarter`

A successful command returns:

- entity changes with before/after versions
- domain events for meaningful history
- affected projection keys for localized rule recalculation
- an inverse command when the operation is safely undoable

Every synchronized entity should include workspace ID, schema version, entity version, created/updated metadata, and optional tombstone metadata.

### 4.4 Quality toolchain

- Vitest for unit and integration tests
- fast-check for capacity, scenario, and import invariants
- React Testing Library for accessible component behavior
- Playwright for workflow, visual regression, and desktop webview smoke tests
- axe-core plus manual keyboard and screen-reader testing
- ESLint, TypeScript strict mode, Prettier, and dependency/license scanning
- Windows and macOS CI from the first runnable desktop skeleton

---

## 5. Delivery Phases

No calendar estimate should be committed until team size, target-environment access, and decision turnaround are known. Each phase below has an exit gate; work may overlap where dependencies allow.

### Phase 0 - Decisions and feasibility

**Objective:** retire the assumptions that can invalidate the product or architecture.

Deliverables:

- Named primary pilot persona and documented current-state QBR workflow
- Domain decision record covering capacity/lifecycle matrix, quarters, footprint sizing, dependency direction, scenario staleness, and the three snapshot concepts
- Low-fidelity Portfolio Map alternatives using the validation fixture
- Demand Flow interaction prototype
- Keyboard interaction model for selecting, moving, and inspecting visual objects
- Tauri skeleton exercised on managed Windows and macOS
- SharePoint/Graph proof of authentication, list CRUD, ETag conflict, throttling response, and required permissions, or a documented blocked decision
- Threat model and management-data classification
- Target-scale fixtures and benchmark protocol

Exit gate:

- Both target portfolio leads can explain the visual capacity model and complete the core idea-placement task.
- The chosen Portfolio Map layout is recorded with rejected alternatives and evidence.
- Desktop feasibility has no unidentified policy blocker.
- Shared storage has a credible approved path or is explicitly removed from the pilot release.
- Blocking domain decisions in section 2.1 are accepted.

### Phase 1 - Walking skeleton and domain foundation

**Objective:** establish one tested path from UI command through local persistence and back to a rendered projection.

Deliverables:

- Workspace scaffold, CI, quality checks, and architecture decision records
- Tauri desktop shell with local development mode
- Versioned domain schemas and migration framework
- Command handler, invariant validation, domain events, and undo contract
- Local SQLite provider with repository transactions
- Local profile and sample workspace loading
- Workspace, Team, Quarter, TeamQuarter, Reserve (including refinement bucket), Commitment, Decision/Approval Constraint, and qualitative Idea-to-refinement-reserve link entities
- One screen that creates a commitment, assigns a footprint, persists it, reloads it, and renders capacity
- Error boundary, structured local diagnostics, and clear-local-data behavior

Exit gate:

- Restarting the app preserves the workspace with no semantic loss.
- Invalid domain commands cannot bypass invariants through UI, import, or repository APIs.
- Export/import round-trip tests pass for the implemented schema.
- Windows and macOS CI produce runnable development artifacts.

### Phase 2 - Physical portfolio alpha

**Objective:** prove that a lead can model and understand a real portfolio visually.

Deliverables:

- Portfolio Map with defined semantic zoom levels
- Separate Ideas/Demand lane with refinement-reserve links
- Visual quarter-timeline selection as the primary target-timing control; no target-quarter dropdown in primary workflows
- Team-quarter capacity containers, delivery reserves, linkable refinement bucket, headroom, and overflow
- Commitment blocks and multi-team/multi-quarter footprints
- Product/service impacts and themes
- Focus mode with relevant team, product, footprint, and dependency context
- Progressive commitment detail panel, inline board-based Quick Capture, and typed external links
- Lifecycle commands, Commit Gate guardrail foundation, carry-over representation, and milestones
- Fast capture path for material unplanned work in the active quarter
- Keyboard alternatives, list companion, reduced motion, non-color indicators, and screen-reader summaries
- 25-, 100-, and 500-commitment rendering tests

Exit gate:

- A pilot user can model the agreed real portfolio without execution-task data.
- A new user identifies the overloaded team, affected product, and selected commitment's footprint from the sample workspace.
- Capacity totals agree across visual and list views.
- Target-scale overview and focus interactions meet the agreed benchmark.

Release: **Product validation alpha, part 1**.

### Phase 3 - Radar and explainable rules

**Objective:** prove that the app can be trusted as management memory.

Deliverables:

- Pure rule evaluation API with localized recalculation
- Capacity, dependency timing, milestone, missing owner, idea readiness, staleness, and target-date rules
- Separate health and attention projections
- Stable Radar signal identities and persisted review/snooze dispositions
- My Radar and Team/Portfolio Radar with explicit owner resolution
- Explanation panel showing facts, threshold, severity, and available action
- Workspace threshold configuration with validation and reset to defaults
- Rule clock abstraction for repeatable date/time tests

Exit gate:

- Every signal shown in Radar has a deterministic explanation and reproduction test.
- Review and snooze do not hide changed or materially worsened conditions.
- The same workspace and clock always produce the same rule results.
- Pilot review finds no critical missing or false-positive default rule category.

Release: **Product validation alpha, part 2**.

### Phase 4 - Scenario and QBR loop

**Objective:** validate the primary differentiated planning workflow.

Deliverables:

- Scenario base revision and ordered command overlay
- Private local scenario creation, naming, save, discard, and clone
- Ghost footprints for Ideas and tentative product/dependency signals, without baseline lifecycle change
- Demand Flow idea staging, target team/quarter placement, and Commit Gate
- Scenario versus current-baseline diff
- Rebase/staleness detection and conflict presentation
- Apply-whole-scenario default, with selective apply, dependency-consequence visibility, and transactional boundary
- Undo/redo for routine edits
- Consequence preview for cascading baseline commands
- Presentation mode for Portfolio, Radar, and Demand Flow

Exit gate:

- A lead can run the agreed QBR exercise from idea intake through compare and selective apply.
- Scenario edits cannot mutate baseline before apply, verified by property tests.
- A stale scenario cannot silently overwrite a newer baseline.
- Capacity, product impacts, dependency effects, and attention changes appear in comparison.

Release: **Product validation alpha complete**. Continue only if observed use validates the product thesis.

### Phase 5 - Pilot completeness

**Objective:** support repeated individual use and real meetings without shared live storage.

Deliverables:

- Timeline, dependency neighborhood/map, products view, themes lens, and change-load explanation
- Search, command palette, visible filter chips, and list/table companions
- Domain history, quarter-close workflow, and best-effort carry-over proposals requiring Planner confirmation
- Import mapping and preview for CSV/XLSX/JSON with transactional apply
- Structured export and versioned `.drworkspace` package
- Restorable workspace snapshots with diff
- Saved views for presentation state
- Multiple workspaces, switcher, smart-default creation, and resettable sample workspace
- Archive/restore behavior and referential-integrity policies
- Manual duplication for recurring commitment instances; automated recurrence remains deferred
- Native desktop notifications with user-configurable eligibility
- Notification scheduling while the application is open; missed conditions surface in Radar on next launch
- Command-level local permission harness ready for shared identity
- Pre-migration local recovery backup, restore path, corrupted-cache recovery, and rollback tests
- Sensitivity warning before portable workspace export and import

Exit gate:

- A new pilot user can start with sample data, create or import a workspace, run a meeting, close a quarter, export it, and recover it on another device.
- Import failures are atomic and explain record-level errors.
- Workspace format migration and round-trip tests cover at least the previous schema version.
- Accessibility acceptance criteria pass for every primary workflow.

Release: **Pilot MVP**.

### Phase 6 - Shared provider and collaboration beta

**Objective:** allow multiple users to work safely without a custom backend.

Prerequisite: written approval of the identity and storage design proven in Phase 0. SQLite remains local-only; shared persistence uses SharePoint Lists or the approved versioned shared-document provider.

Deliverables:

- Capability-aware `WorkspaceProvider` contract
- Entra authentication and OS-secure token storage
- SharePoint Lists provider or the approved safely versioned shared-document provider
- Local mutation queue, pull cursor, idempotent push, tombstones, retries, and backoff
- Entity-level optimistic concurrency, automatic non-overlapping field merge, and explicit conflict UI for overlapping changes
- Viewer, Contributor, and Planner command authorization matrix
- Local-person to authenticated-user linkage
- Shared baseline and shared scenario publication
- Sync/offline status, pending counts, last sync, conflict count, access revalidation, and offline expiry
- Multi-client deterministic sync and fault-injection test harness

Exit gate:

- Two clients can edit independent records offline and converge after sync.
- Conflicting edits are never silently overwritten.
- Interrupted or repeated pushes are idempotent.
- Revoked access expires according to policy.
- Provider throttling and partial service failure preserve local work and produce actionable status.

Release: **Shared collaboration beta**.

### Phase 7 - Enterprise production readiness

**Objective:** meet operational, security, accessibility, performance, and distribution requirements.

Deliverables:

- Signed Windows and notarized macOS packages through the approved pipeline, with no-admin installation required and managed distribution as policy fallback
- Manual signed-installer distribution for Pilot MVP; installation, rollback, and schema-migration strategy; automatic update only if later permitted
- Security review, dependency/license scanning, 2,000-character management-note limit, and secret-paste warnings
- No automatic telemetry; logging redaction, opt-in diagnostic export, retention, and support runbook
- WCAG 2.2 AA evidence plus desktop keyboard/screen-reader matrix
- Target-scale performance and soak results
- Provider recovery, corrupted-cache, conflict, and disaster-recovery exercises
- Data lifecycle, workspace deletion, export handling, and offboarding procedures
- User, admin, and support guidance

Exit gate:

- All agreed security and operational controls have evidence and an owner.
- Packaging works on representative managed Windows and macOS devices without unsupported privileges.
- No severity-1 accessibility, data-loss, authorization, or migration defect remains.
- Pilot success measures meet the thresholds agreed in Phase 0.

Release: **Shared production release**.

---

## 6. Validation and Test Strategy

### 6.1 Domain invariants

Automate at minimum:

- Baseline capacity equals included footprint units plus reserves under the lifecycle matrix.
- Refinement-bucket links explain supported Ideas but do not alter capacity totals.
- A footprint references exactly one team and one explicit workspace quarter.
- A scenario command cannot change baseline state before apply.
- Applying the same synchronized mutation twice is idempotent.
- History actor, command, timestamp, and affected entities are present for meaningful changes.
- Archived or deleted targets cannot leave unexplained live references.
- Dependency cycles remain representable and produce an explicit warning rather than failing validation.
- Portable workspace round trips preserve domain meaning and configuration.
- Migrations are monotonic and recoverable from backup.

### 6.2 Workflow tests

Maintain Playwright paths for:

1. Create an idea and progressively add planning context.
2. Place an idea into a team-quarter and explain overflow.
3. Trace a commitment through teams, products, dependencies, and milestones.
4. Review and snooze a Radar signal, then worsen its condition.
5. Create, compare, rebase, and selectively apply a scenario.
6. Import a workspace, resolve mapping errors, and verify totals.
7. Close a quarter and create carry-over.
8. Export, clear local data, restore, and compare.
9. Make conflicting offline edits from two clients and resolve them.

### 6.3 Product validation fixture

Use one stable fictional dataset throughout design, tests, demos, and benchmarks:

- 5 teams
- 5 products/services
- 25 commitments across all lifecycle states
- 10 ideas under refinement or consideration
- 10 reserves across 6 quarters
- 30 dependencies including a decision hub
- 3 carry-over items
- 2 overloaded team-quarters
- 1 high product change-load period
- 12 Radar signals with different reasons and severities
- 2 scenarios, one of which becomes stale

Generate larger deterministic variants for 100 and 500 commitments.

---

## 7. Initial Backlog

The first implementation backlog should stop after the walking skeleton until Phase 0 evidence is reviewed.

### Iteration 0 - Discovery and spikes

- Observe and map one real QBR preparation and meeting
- Agree glossary and capacity/lifecycle table
- Create validation fixture
- Prototype two Portfolio Map layouts
- Prototype idea placement and overflow explanation
- Test keyboard selection/movement model
- Run managed-device Tauri spike
- Run SharePoint authentication/ETag spike
- Record architecture decisions and unresolved policy owners

### Iteration 1 - Repository and domain

- Scaffold pnpm workspace, Tauri/React app, strict TypeScript, lint, unit tests, and CI
- Define IDs, workspace quarters, versions, actors, timestamps, and errors
- Implement Workspace, Team, TeamQuarter, Reserve, Commitment, and Footprint schemas
- Implement create commitment and assign/move footprint commands
- Implement capacity projection and invariant/property tests
- Add sample fixture loader

### Iteration 2 - Persistence and first vertical slice

- Add SQLite schema and migrations
- Add local repository transaction and reload path
- Render one accessible capacity container and commitment block
- Add create/edit interaction with undo
- Add list companion with matching capacity totals
- Add Playwright restart/persistence smoke path
- Produce Windows and macOS CI artifacts

At that point, review the Phase 1 exit gate and re-plan Phase 2 using measured velocity and prototype findings.

---

## 8. Delivery Governance

- Keep a decision log for every proposed working decision in section 2.
- Demonstrate a usable vertical slice at least every two weeks; avoid layer-only milestones.
- Test each phase with representative users before expanding scope.
- Track product risk, policy risk, data-loss risk, accessibility risk, and performance risk separately.
- Do not count a feature complete until its keyboard path, explanation/error states, migration impact, and tests are complete.
- Revisit the release cut at every phase gate. Deferred items remain deferred unless evidence shows they are required for the management loop.
