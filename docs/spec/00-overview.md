# 00 — Overview, Principles & Glossary

## 1. What Flowmap is

Flowmap is a cross-platform desktop application that holds a **management-level model of a
portfolio** and renders it as a manipulable physical landscape: blocks inside team-quarter
containers, connected by typed dependency lines, filtered through lenses.

It answers seven questions and nothing else:

1. What is happening across my portfolio?
2. What needs attention now?
3. Can we accept this new demand?
4. What moves if we do?
5. Where are the bottlenecks?
6. Where does the change land?
7. What did we learn last quarter?

## 2. What Flowmap is not

Flowmap is not a system of record. It references enterprise systems (Azure DevOps, ServiceNow,
ServiceNow PPM, Confluence, Forge, Teams) by typed HTTPS link and never replicates their content.

Hard anti-goals — a feature that serves any of these is rejected, not deferred:

sprint/backlog management · task management · timesheets · person-level resource planning ·
skills planning · percent-complete tracking · Gantt/critical path · chat · document management ·
budgets · generic dashboard builder · workflow engine · approval routing · org charts ·
mobile-first · **any AI/LLM feature**

All guidance in Flowmap is deterministic, rule-based, and explainable. There is no model
inference anywhere in the product or its build-time assets.

## 3. Hard constraints

| Constraint    | Requirement                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platforms     | Windows and macOS, same codebase, versions per the managed-device matrix                                                                                                  |
| Distribution  | **Portable ZIP — no installation of any kind.** Unzip to a folder, run from it, delete the folder to remove it. Signed for execution policy, not for install              |
| Backend       | **No backend, and no network access at all.** Shared state is a versioned document in a synced folder (SharePoint library / OneDrive). Flowmap makes no outbound requests |
| Offline       | Always. There is no online mode to lose — the shared document is reached through the filesystem                                                                           |
| Scale         | 20 teams · 30 products/services · 500 open commitments · 600 dependencies · 6-quarter (18-month) horizon · thousands of history records                                   |
| Performance   | Local workspace load ≈ 2 s; drag/placement feedback ≤ 100 ms; 60 fps target during pan/zoom on reference hardware                                                         |
| Accessibility | WCAG 2.2 AA; every visual interaction has a keyboard equivalent and a list/table companion                                                                                |
| Identity      | **None.** A self-declared local profile names changes in history. No Entra, no accounts, no passwords. Access is controlled by who can reach the shared folder            |
| Data class    | Management metadata only. No credentials, tokens, customer data, incident dumps, or vulnerability detail                                                                  |
| Language      | English only; all UI copy externalised for future localisation                                                                                                            |

## 4. Engineering principles

1. **Vertical slices.** Every milestone produces a workflow a user can exercise end to end.
   Layer-only milestones are not accepted as done.
2. **Pure domain.** `@flowmap/domain`, `@flowmap/rules`, `@flowmap/visual-model` contain no React,
   no I/O, no clock access, no randomness. Time and IDs are injected.
3. **One mutation model.** UI edits, undo/redo, scenarios, import, sync, and restore all go through
   the same command handler and produce the same versioned entity changes and domain events.
4. **Baseline and scenario are separate projections.** A scenario command can never mutate baseline
   state before an explicit, authorised `ApplyScenario` succeeds. This is enforced by types
   (a scenario projection is a distinct type from a baseline projection) and by property tests.
5. **Explanations are data.** Rules return `{ ruleCode, facts, threshold, severity, actions }`.
   UI copy renders from that structure; no rule text is authored in components.
6. **Keyboard is designed with the visual, not after it.** A visual interaction without its keyboard
   path and list companion is not complete.
7. **SVG/DOM first.** Move a view to Canvas/WebGL only after a _measured_ failure against the
   benchmark, and only with an accessibility plan for the replacement.
8. **Prove external constraints early, build them late.** Tauri packaging and the SharePoint
   provider get feasibility spikes in Phase 0 and production implementations only after the local
   product loop is validated.
9. **Progressive capture.** Every board supports direct visual creation with the minimum
   information that keeps the model valid. Creation never requires a multi-field form.
10. **Aggregate before cluttering.** Detail appears because the user asked for it (zoom, focus,
    filter), never because the data exists.

## 5. Spec conventions

- **MUST / MUST NOT / SHOULD / MAY** carry RFC 2119 meaning.
- TypeScript blocks are normative type definitions unless labelled _illustrative_.
- Formula blocks are normative and MUST be implemented exactly, including rounding.
- **⚠ Spike-gated** marks a decision awaiting an external constraint; each names its spike and its
  fallback.
- Identifiers use `SCREAMING_SNAKE` for enum members, `camelCase` for fields, `PascalCase` for
  types and command names, `kebab-case` for files and rule codes are `AREA_NAME` uppercase.

## 6. Glossary

Terms in this table are the _only_ permitted vocabulary in code, UI copy, and tests. Synonyms are
bugs — they cause the local-meaning drift the product exists to prevent.

| Term                       | Definition                                                                                                                                                                          | What it is **not**                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Commitment**             | A piece of work or obligation significant enough to consume meaningful capacity, require management attention, create dependencies, affect a product/service, or require a decision | Not a story, task, defect, or sprint item                                |
| **Idea**                   | The single pre-delivery lifecycle state. Lives in the Ideas/Demand lane                                                                                                             | Not a "candidate", "proposal", or "epic"                                 |
| **Commit Gate**            | The deliberate act of accepting capacity consumption into the baseline; promotes `IDEA → COMMITTED`                                                                                 | Not an approval workflow, not a sign-off                                 |
| **Capacity footprint**     | A commitment's load on exactly one team in exactly one quarter, in explicit capacity units                                                                                          | Not an estimate, not person-days, not story points                       |
| **Capacity unit**          | Relative planning unit. A normal team quarter is 100 units                                                                                                                          | Not hours, not days, not money                                           |
| **Reserve**                | Capacity a team-quarter sets aside before committed delivery work (BAU, support, LCM, overhead, refinement, hold)                                                                   | Not a commitment, not a placeholder task                                 |
| **Refinement reserve**     | The reserve that pays for shaping Ideas before delivery. Ideas link to it qualitatively                                                                                             | Not an allocation to a specific Idea; links carry no units               |
| **Deliverable capacity**   | `effective capacity − total reserves`. The pool committed footprints consume                                                                                                        | Not the team's total capacity                                            |
| **Headroom**               | `deliverable capacity − counted load`. Negative headroom is overflow                                                                                                                | Not slack time, not a buffer to be filled                                |
| **Carry-over**             | Derived condition where unfinished work receives a footprint in a later quarter at quarter close                                                                                    | Not a lifecycle state, not a failure flag                                |
| **Product/service impact** | Typed statement that a commitment lands change on a product/service: `PRIMARY`, `MAJOR`, `MINOR`, `DEPENDENCY`                                                                      | Not capacity; products do not have a 100-unit budget                     |
| **Change load**            | Derived `LOW/MEDIUM/HIGH` signal of how much change a product/service absorbs in a quarter                                                                                          | Not team capacity; answers "where does it land", not "can we deliver it" |
| **Dependency**             | Directed, typed link from the work **waiting** (source) to its **prerequisite** (target)                                                                                            | Not a task predecessor in a schedule                                     |
| **Decision**               | First-class prerequisite representing a required decision or approval                                                                                                               | Not an approval workflow step                                            |
| **Attention**              | "This needs a human to look now." Time- and ownership-driven                                                                                                                        | Not health                                                               |
| **Health**                 | "This is in trouble." Condition-driven                                                                                                                                              | Not attention; a healthy item can need attention and vice versa          |
| **Confidence**             | Qualitative `LOW/MEDIUM/HIGH`, tracked separately for size, timing, and scope                                                                                                       | Not health; never combined into a score                                  |
| **Signal**                 | One deterministic rule result about one entity at one moment                                                                                                                        | Not a notification; notifications are a delivery channel for signals     |
| **Radar**                  | The view that shows only attention-worthy signals                                                                                                                                   | Not a list of all work                                                   |
| **Scenario**               | A private-by-default overlay of ordered commands on a recorded baseline revision                                                                                                    | Not a branch of the data; baseline is untouched until apply              |
| **Baseline**               | The shared, agreed current management plan                                                                                                                                          | Not a snapshot; snapshots are restorable point-in-time copies            |
| **Snapshot**               | Restorable point-in-time copy of workspace data, restored only with a diff and confirmation                                                                                         | Not a saved view                                                         |
| **Saved view**             | Non-restorable capture of lens, filters, horizon, and focus                                                                                                                         | Never changes data                                                       |
| **Workspace**              | One manageable portfolio: teams, products, commitments, people, themes, settings, history                                                                                           | Not a tenant; workspaces are independent, no cross-workspace roll-up     |
| **Lens**                   | A way of emphasising the same model (Portfolio, Teams, Products, Themes, Dependencies, Attention, QBR, Timeline)                                                                    | Not a separate data copy                                                 |

## 7. Roles

| Role            | Can                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Viewer**      | Read and explore everything; open shared scenarios; save personal views; export views                                                                                                                 |
| **Contributor** | Everything a Viewer can, plus create/edit Ideas, dependencies, decisions, product impacts, milestones, links, notes; create private scenarios and share them for review                               |
| **Planner**     | Everything a Contributor can, plus pass/revert Commit Gate, move committed capacity, change team capacity and reserves, apply scenarios, close quarters, restore snapshots, manage workspace settings |
| **Admin**       | Everything a Planner can, plus hard delete, workspace deletion, schema migration execution, and member role assignment                                                                                |

Application roles are **behavioural controls**, not the security boundary. The security boundary is
the underlying store's permissions (M365 site/list permissions, or filesystem permissions for local
and file providers). This is stated in the UI where it matters.

## 8. Release gates

| Gate                          | Contains                                                                                                                                  | Proves                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Product Validation Alpha**  | Portfolio Map, capacity model, Radar + rules, Scenario/QBR loop, local persistence                                                        | The visual planning model solves the lead's problem          |
| **Pilot MVP**                 | Full lens set, history, quarter close, import/export, portability, snapshots, multiple workspaces, notifications, signed desktop packages | A lead can use it for real, repeatedly, alone                |
| **Shared Collaboration Beta** | Provider contract, File provider over a synced folder, conflict UI, advisory role enforcement                                             | Several users can share a workspace without silent data loss |
| **Shared Production Release** | Security review, accessibility evidence, performance/soak, operations, distribution, documentation                                        | It meets enterprise operational requirements                 |
