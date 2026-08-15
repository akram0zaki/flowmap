# Flowmap — Engineering Specification

Build-ready specification for **Flowmap**, a visual portfolio control tool for leads coordinating
multiple teams, products/services, commitments, dependencies, and planning horizons.

This spec supersedes `docs/concept/` for all implementation decisions. The concept pack
(PRD, UX spec, technical architecture, build plan, implementation plan) remains the record of
product intent and is still authoritative for _why_; this spec is authoritative for _what_ and _how_.

The root input is [`docs/concept/problem-statement.md`](../concept/problem-statement.md) — an
engineering lead's account of QBR capacity guesswork, work scattered across Azure DevOps /
ServiceNow / PPM / Teams / Confluence / Forge, post-it notes as the only "what do I pick up now"
mechanism, and invisible bottlenecks. Every feature in this spec should be traceable back to one of
those four problems. Two of its instincts were deliberately overruled downstream, and it is worth
knowing why:

- _"a database shared on OneDrive in some format (e.g. Excel or JSON)"_ → Excel is **import/export
  only**. A spreadsheet cannot give per-entity versioning, conflict detection, or tombstones, so it
  cannot be a shared store without silent data loss. The equivalent capability ships as the
  [File provider](08-providers.md#3-file-provider-fallback): a versioned JSON document with atomic
  replace, which is the same distribution model with safe write semantics.
- _"runnable in a docker container and maybe even an EXE"_ → the primary target is a signed,
  no-install portable package on Windows and macOS. Browser and Docker remain **development and demo**
  targets ([12 §3](12-repository-layout.md#3-toolchain-and-conventions)), not distribution channels,
  because the shared-storage and OS-keychain paths only exist in the desktop shell.

> **Naming.** The concept pack calls the product "Delivery Radar". The product is now **Flowmap**.
> Package scope `@flowmap/*`, portable workspace extension `.flowmap`, app identifier
> `com.flowmap.desktop`. "Radar" survives as the name of one view, not the product.

## Reading order

| #   | Document                                                      | Contents                                                                         |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 00  | [Overview & principles](00-overview.md)                       | Product frame, hard constraints, glossary, spec conventions                      |
| 01  | [Domain model](01-domain-model.md)                            | Every entity, enum, invariant, ID scheme, schema versioning                      |
| 02  | [Capacity & planning model](02-capacity-model.md)             | Quarters, footprints, reserves, capacity math, carry-over, quarter close         |
| 03  | [Commands, events & permissions](03-commands-permissions.md)  | Full command catalog, event model, undo, role matrix                             |
| 04  | [Rules engine & Radar](04-rules-radar.md)                     | Rule catalog with formulas, signal identity, dispositions, change-load           |
| 05  | [Scenarios & Demand Flow](05-scenarios-qbr.md)                | Overlay model, rebase, diff, selective apply, Commit Gate                        |
| 06  | [Views, interaction & accessibility](06-views-interaction.md) | Every view, semantic zoom, keyboard model, WCAG 2.2 AA conformance               |
| 07  | [Persistence & sync](07-persistence-sync.md)                  | Local SQLite, outbox, pull cursor, conflict resolution                           |
| 08  | [Storage providers](08-providers.md)                          | Provider contract, Local and File implementations, why the SharePoint API is out |
| 09  | [Import, export & portability](09-import-export.md)           | CSV/XLSX/JSON import, `.flowmap` package, snapshots, saved views                 |
| 10  | [Desktop runtime & security](10-desktop-security.md)          | Tauri shell, IPC surface, notifications, packaging, threat model                 |
| 11  | [Quality & performance](11-quality-performance.md)            | Test strategy, fixtures, benchmarks, CI matrix                                   |
| 12  | [Repository & code layout](12-repository-layout.md)           | Packages, boundaries, dependency rules, toolchain                                |

Execution plan lives separately: [`docs/plan/execution-plan.md`](../plan/execution-plan.md)
with ticket-level detail in [`docs/plan/backlog.md`](../plan/backlog.md).

## Contradictions resolved against the concept pack

The concept documents disagree with each other in places. Where they do, this spec picks one
answer. Every such resolution is listed here so reviewers can challenge it directly.

> **Status: R1–R14 accepted 2026-08-15.** All fourteen resolutions were reviewed and approved
> together with the product name (**Flowmap**) and the design direction. They are now binding.
> Reversing one is a normal decision — raise it, record it as an ADR, and update the affected spec
> sections in the same change.

| #   | Concept pack said                                                                      | Flowmap spec says                                                                                                                                             | Rationale                                                                                                               |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| R1  | PRD §6.2: lifecycle is `Idea → Candidate → Committed → …`                              | `CANDIDATE` is removed. `IDEA` is the single pre-delivery state; Commit Gate promotes `IDEA → COMMITTED`                                                      | Implementation plan decision 2026-08-14; two pre-delivery states had no distinct behaviour                              |
| R2  | PRD §7: "Only **Committed** work consumes official baseline capacity"                  | `COMMITTED` **and** `IN_DELIVERY` consume delivery capacity                                                                                                   | Work in flight obviously consumes capacity; PRD statement was about the commit boundary, not the load model             |
| R3  | Unspecified: does `DONE` work still count in its quarter?                              | `DONE` footprints count toward load in the **current or past** quarters, and count 0 in **future** quarters                                                   | Otherwise a team's utilisation falsely drops as work completes mid-quarter; matches the architecture's stated invariant |
| R4  | Unspecified: `ON_HOLD` capacity                                                        | `ON_HOLD` releases capacity unless a Planner sets `holdCapacityPreserved`, which converts the load to a `HOLD` reserve                                        | Implementation plan decision; keeps the "held slot" case representable without lying about load                         |
| R5  | PRD §7.3 + architecture: both `Commitment.size` and `CapacityFootprint.size` exist     | **Only footprint units drive capacity.** `Commitment.sizeSummary` is a _derived, non-stored_ band over total footprint units                                  | Two sources of truth for size is the single largest correctness risk in the model                                       |
| R6  | Architecture §5.9: dependency `target` may be `DECISION` but no Decision entity exists | `Decision` is a first-class entity (`kind: DECISION \| APPROVAL`)                                                                                             | Dependency targets must reference real rows for Radar, ownership, and the Dependency Map                                |
| R7  | PRD §8.2 lists change-load _inputs_ with no formula                                    | Deterministic weighted-overlap formula, specified in [04](04-rules-radar.md#5-product-change-load)                                                            | "Explainable" requires a formula the UI can show                                                                        |
| R8  | PRD §10.4: "No generic permanent dismissal" vs UX §6.6 snooze                          | `Reviewed — no change` suppresses until the condition **fingerprint** changes or severity rises; `Snooze` suppresses until a date, with severity breakthrough | Both concepts kept, given precise suppression semantics                                                                 |
| R9  | Architecture §5.15: scenario as "overlay mutation set" (vague)                         | Scenario = `baseRevision` + ordered, replayable **command log**; apply replays against current baseline                                                       | Only representation that supports rebase, diff, and selective apply coherently                                          |
| R10 | PRD §23.3: `workspace.drworkspace`                                                     | `workspace.flowmap` (ZIP container, `formatVersion` in manifest)                                                                                              | Product rename                                                                                                          |
| R11 | Architecture §2.4 recommends SQLite; PRD §29 implies shared persistence                | SQLite is **local cache only, never shared**. Shared state goes through a `WorkspaceProvider`                                                                 | Multi-machine SQLite over OneDrive is a data-loss bug waiting to happen                                                 |
| R12 | Architecture §17.3: "encrypt local data where practical"                               | Cache encryption at rest is **deferred**, with explicit compensating controls listed in [10](10-desktop-security.md)                                          | Deferral is a decision with owners and controls, not a vague aspiration                                                 |
| R13 | UX §21: notifications "not MVP-critical"                                               | Native notifications are **in** the Pilot MVP, foreground-only                                                                                                | Implementation plan decision 2026-08-14                                                                                 |
| R14 | PRD §25: recurrence may auto-create next occurrence                                    | Automatic recurrence **deferred**; manual duplication only through Pilot MVP                                                                                  | Implementation plan decision; auto-creation needs history semantics not yet designed                                    |

## Status of this spec

**Approved 2026-08-15.** Every section is written to be implementable without further product input.
Sections that depend on an unresolved _external_ constraint (execution policy, WebView2
availability, managed-device policy) are marked with a **⚠ Spike-gated** callout naming the spike that must clear
first, and specify the fallback that ships if the spike fails.

### Environment constraints confirmed 2026-08-15

Three answers from the target environment changed the shape of the product. They are recorded here
because they are the reason several sections read differently from the concept pack.

| #   | Question                                       | Answer  | Consequence                                                                                                                                                                                                                              |
| --- | ---------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Can users install software on managed devices? | **No**  | Flowmap ships as a **portable ZIP** — no installer, no registry, no elevation. [10 §3](10-desktop-security.md#3-packaging-and-distribution)                                                                                              |
| C2  | Is code signing available?                     | **Yes** | Used for execution policy (AppLocker/WDAC publisher rules) and macOS notarisation, not for install. [10 §3.3](10-desktop-security.md#33-execution-policy)                                                                                |
| C3  | Can an Entra app be registered?                | **No**  | The SharePoint **Lists API** provider is removed. Workspaces still live in SharePoint/OneDrive — as a **file**, via the File provider. No auth, no tokens, no network. [08 §4](08-providers.md#4-sharepoint-lists-api-provider--removed) |

C3 has the widest reach: no authenticated identity, so roles are advisory and the shared folder's
permissions are the only real boundary; no token storage; no offline expiry; and no network command
in the IPC surface at all.

### Approved with open external dependencies

These were approved as written, but each still needs an answer from outside the codebase. They are
tracked in the [risk register](../plan/execution-plan.md#risk-register); none of them blocks M1.

| #   | Item                                        | What approval means                                                                                                        | Still needed                                                             | Blocks                 |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------- |
| O1  | Product name **Flowmap**                    | Binding. `@flowmap/*`, `.flowmap`, `com.flowmap.desktop`                                                                   | —                                                                        | —                      |
| O2  | Windows execution policy                    | Portable design assumes a signed binary may run from a user folder                                                         | Confirmation that AppLocker/WDAC permits it (spike S-1)                  | M7 Windows target only |
| O3  | Benchmark reference hardware                | Budgets in [11 §6.2](11-quality-performance.md#62-budgets-500-commitment-workspace) are accepted as targets                | A named reference device before the budgets become gates                 | Gate C                 |
| O4  | Local cache encryption deferred (R12)       | Deferral accepted with the compensating controls in [10 §4](10-desktop-security.md#4-data-classification-and-threat-model) | Confirmation that OS full-disk encryption is enforced on managed devices | M9 security review     |
| O5  | Excel as shared store → File provider       | Accepted: Excel is import/export only                                                                                      | —                                                                        | —                      |
| O6  | Docker/browser as dev and demo targets only | Accepted                                                                                                                   | —                                                                        | —                      |
