# Delivery Radar — Technical Architecture & Engineering Specification

## 1. Architecture Goals

The architecture must satisfy these hard constraints:

- Cross-platform: Windows + macOS
- Lightweight native desktop distribution
- No custom centrally hosted backend required
- Works with approved shared enterprise storage
- Local cache and offline operation
- Multiple users with conflict awareness
- No AI dependency
- Pluggable persistence
- No direct external-system integration required for MVP
- Secure handling of tokens and local cache
- Accessible, high-performance visual UI
- Support up to ~500 active/future commitments per workspace

---

## 2. Recommended Technology Stack

### 2.1 Desktop shell

**Tauri 2.x**

Rationale:

- Cross-platform Windows/macOS
- Lightweight compared with Electron
- Uses system WebView
- Native packaging
- Native file APIs
- Native notifications where allowed
- Rust core suitable for secure local storage and sync boundary

This is a recommendation, not a dependency that should be accepted without a technical spike in ING.

### 2.2 Frontend

**React + TypeScript**

Recommended supporting libraries:

- Vite
- Zustand or Redux Toolkit for application state
- TanStack Query for async/cache orchestration where useful
- Zod for validation
- React Hook Form only for secondary detail forms, not the primary UX

### 2.3 Visual rendering

Use different techniques for different views:

**Portfolio Map / Capacity / Demand Flow**

- SVG + DOM hybrid where practical
- Canvas/WebGL only if performance requires it

**Dependency Map**

- Prefer a graph/layout library that allows strong control over progressive disclosure
- Candidate libraries to evaluate in spike:
  - React Flow
  - Cytoscape.js
  - ElkJS for layout
  - D3 only for targeted layout/geometry, not as the whole app framework

**Timeline**

- Custom SVG/DOM timeline likely preferable to generic Gantt libraries because detailed Gantt semantics are explicitly out of scope

### 2.4 Local database/cache

Recommended:

- SQLite local cache accessed via Tauri plugin / Rust layer

Use cases:

- Offline workspace copy
- Pending mutations
- Local scenarios
- Search index
- History
- Sync metadata

SQLite is safe locally. It must **not** be placed in a shared OneDrive folder and opened concurrently by multiple machines.

---

## 3. High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Delivery Radar Desktop                    │
│                                                             │
│  React / TypeScript UI                                      │
│  ├─ Portfolio Map                                           │
│  ├─ Radar                                                   │
│  ├─ Demand Flow                                             │
│  ├─ Timeline                                                │
│  ├─ Dependency Map                                          │
│  └─ Admin / Import / Export                                 │
│                                                             │
│  Domain / Rules Engine                                      │
│  ├─ Capacity rules                                          │
│  ├─ Attention rules                                         │
│  ├─ Health rules                                            │
│  ├─ Candidate readiness                                     │
│  └─ Historical recommendations                              │
│                                                             │
│  Workspace Repository                                       │
│  ├─ Local cache                                             │
│  ├─ Sync engine                                             │
│  └─ Provider abstraction                                    │
│          ├─ Local Provider                                  │
│          ├─ SharePoint Provider                             │
│          └─ File Provider                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Storage Provider Abstraction

Define a stable interface independent of provider.

Example conceptual interface:

```ts
interface WorkspaceProvider {
  getWorkspace(id: WorkspaceId): Promise<WorkspaceSnapshot>;
  getChanges(since: SyncCursor): Promise<RemoteChangeSet>;
  applyChanges(changes: MutationBatch): Promise<ApplyResult>;
  getVersion(entity: EntityRef): Promise<EntityVersion>;
  exportWorkspace(id: WorkspaceId): Promise<PortableWorkspace>;
}
```

Required provider implementations:

### 4.1 Local Provider

Use for:

- Development
- Sample workspace
- Single-user prototype
- Technical validation

### 4.2 SharePoint/M365 Provider — preferred shared provider

Target:

- Structured list-based storage
- User-authenticated access
- Version/conflict handling
- Workspace-level permissions backed by M365 access

Exact implementation must be validated in ING.

### 4.3 File Provider — fallback

Possible formats:

- JSON bundle
- Append-log + snapshot
- OneDrive/SharePoint document file

This provider must use safe write patterns:

- Whole-file version IDs
- Atomic replacement where supported
- Conflict detection
- Never rely on multi-machine SQLite locking

---

## 5. Suggested Data Model

### 5.1 Workspace

```ts
type Workspace = {
  id: string;
  name: string;
  currentQuarter: QuarterId;
  settings: WorkspaceSettings;
  createdAt: string;
  updatedAt: string;
};
```

### 5.2 Team

```ts
type Team = {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  defaultQuarterCapacity: number; // default 100
  active: boolean;
};
```

### 5.3 TeamQuarter

```ts
type TeamQuarter = {
  id: string;
  teamId: string;
  quarterId: QuarterId;
  capacityBaseline: number;
  capacityAdjustment: number;
  reserves: CapacityReserve[];
};
```

### 5.4 CapacityReserve

```ts
type CapacityReserve = {
  id: string;
  type: 'BAU' | 'SUPPORT' | 'LCM' | 'OVERHEAD' | 'OTHER';
  amount: number;
  label: string;
};
```

### 5.5 Commitment

```ts
type Commitment = {
  id: string;
  workspaceId: string;
  name: string;
  lifecycle: 'IDEA' | 'CANDIDATE' | 'COMMITTED' | 'IN_DELIVERY' | 'DONE' | 'ON_HOLD' | 'DROPPED';

  class: 'MANDATORY' | 'STRATEGIC' | 'OPERATIONAL' | 'DISCRETIONARY';

  importance: 'HIGH' | 'MEDIUM' | 'LOW';

  primaryTeamId?: string;
  ownerRef?: OwnerRef;

  targetQuarterId?: QuarterId;
  targetDate?: string;

  size?: RelativeSize;
  sizeConfidence?: Confidence;
  timingConfidence?: Confidence;
  scopeConfidence?: Confidence;

  outcome?: string;
  valueDrivers: ValueDriver[];

  attentionDate?: string;
  latestSafeStart?: string;
  nextAction?: string;
  nextActionOwner?: OwnerRef;
  nextActionDueDate?: string;

  managementNote?: string;

  createdAt: string;
  updatedAt: string;
  lastMeaningfulUpdateAt?: string;
  lastReviewedAt?: string;
};
```

### 5.6 CapacityFootprint

```ts
type CapacityFootprint = {
  id: string;
  commitmentId: string;
  teamId: string;
  quarterId: QuarterId;
  size: RelativeSize;
  capacityUnits: number;
  confidence?: Confidence;
  primary: boolean;
  carryOverFromQuarterId?: QuarterId;
};
```

### 5.7 ProductService

```ts
type ProductService = {
  id: string;
  workspaceId: string;
  name: string;
  active: boolean;
};
```

### 5.8 ProductImpact

```ts
type ProductImpact = {
  id: string;
  commitmentId: string;
  productServiceId: string;
  type: 'PRIMARY' | 'MAJOR' | 'MINOR' | 'DEPENDENCY';
};
```

### 5.9 Dependency

```ts
type Dependency = {
  id: string;
  workspaceId: string;
  sourceCommitmentId: string;
  target:
    | { kind: 'COMMITMENT'; id: string }
    | { kind: 'MILESTONE'; id: string }
    | { kind: 'TEAM'; id: string }
    | { kind: 'DECISION'; id: string };

  type:
    | 'BLOCKED_BY'
    | 'REQUIRES'
    | 'DEPENDS_ON_DELIVERY'
    | 'NEEDS_CAPACITY_FROM'
    | 'NEEDS_DECISION_APPROVAL_FROM';

  ownerRef?: OwnerRef;
  neededBy?: string;
  status: 'OPEN' | 'AT_RISK' | 'RESOLVED';
  note?: string;
};
```

### 5.10 Milestone

```ts
type Milestone = {
  id: string;
  commitmentId: string;
  name: string;
  targetDate?: string;
  status: 'PLANNED' | 'DONE' | 'MISSED';
};
```

### 5.11 Theme

```ts
type Theme = {
  id: string;
  workspaceId: string;
  name: string;
};
```

Join:
`CommitmentTheme(commitmentId, themeId)`

### 5.12 Person

```ts
type Person = {
  id: string;
  workspaceId: string;
  displayName: string;
  email?: string;
  roleLabel?: string;
  teamId?: string;
  linkedUserId?: string;
};
```

### 5.13 WorkspaceUser

```ts
type WorkspaceUser = {
  id: string;
  workspaceId: string;
  identitySubject: string;
  personId?: string;
  role: 'VIEWER' | 'CONTRIBUTOR' | 'PLANNER';
};
```

### 5.14 ExternalLink

```ts
type ExternalLink = {
  id: string;
  commitmentId: string;
  type:
    'AZURE_DEVOPS' | 'SERVICENOW' | 'SERVICENOW_PPM' | 'CONFLUENCE' | 'FORGE' | 'TEAMS' | 'GENERIC';
  url: string;
  label?: string;
};
```

### 5.15 Scenario

```ts
type Scenario = {
  id: string;
  workspaceId: string;
  name: string;
  ownerUserId: string;
  visibility: 'PRIVATE' | 'SHARED';
  baseSnapshotId: string;
  createdAt: string;
};
```

Scenario changes may be represented as an overlay mutation set rather than full object duplication.

### 5.16 Snapshot

```ts
type Snapshot = {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  versionRef: string;
};
```

---

## 6. Rule Engine

The rule engine must be deterministic and explainable.

Recommended internal rule result:

```ts
type RuleResult = {
  id: string;
  entityRef: EntityRef;
  ruleCode: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  category: 'ATTENTION' | 'HEALTH' | 'CAPACITY' | 'DEPENDENCY' | 'READINESS' | 'HISTORY';
  message: string;
  explanation: string;
  suggestedActions: SuggestedAction[];
};
```

### 6.1 Example rules

**Capacity overflow**

```text
IF committedCapacity > effectiveAvailableCapacity
THEN HIGH capacity signal
```

**Dependency approaching**

```text
IF dependency != RESOLVED
AND neededBy - today <= configuredLeadDays
THEN attention signal
```

**Stale delivery**

```text
IF lifecycle = IN_DELIVERY
AND max(lastMeaningfulUpdate, lastReviewed) older than threshold
THEN review signal
```

**Candidate readiness**

```text
Check owner, team, size, target, product impact, dependency review
Return advisory gaps
```

**Missing individual owner**

```text
IF nextActionDue soon
AND owner is team only
THEN attention warning
```

**Carry-over pattern**

```text
IF team has carry-over in N of last M quarters
THEN suggest reserve/planning review
```

### 6.2 Rule configurability

Core rule semantics are code-defined.

Workspace may configure:

- Thresholds
- Lead times
- Enable/disable advisory rules
- Guardrails
- Templates

Do not allow arbitrary script execution in MVP.

---

## 7. Sync and Offline Model

### 7.1 Local-first runtime

The UI reads from the local cache for responsiveness.

Sync runs asynchronously when provider is available.

### 7.2 Mutation queue

Local writes are recorded as immutable pending mutations.

Example:

```ts
type PendingMutation = {
  id: string;
  entityRef: EntityRef;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  baseVersion?: string;
  patch: unknown;
  createdAt: string;
};
```

### 7.3 Conflict detection

On sync:

- Compare base version with remote version
- If unchanged, apply
- If changed and fields do not conflict, auto-merge may be considered
- If materially conflicting, show explicit conflict UI

MVP may choose record-level conflict resolution first.

### 7.4 Offline indicator

UI must show:

- Offline
- Last sync time
- Pending mutation count
- Conflict count

### 7.5 Access revalidation

Offline workspace cache access should have configurable validity based on last successful authentication.

---

## 8. Authentication & Authorization

### 8.1 Preferred identity

Microsoft Entra ID / bank Microsoft identity.

### 8.2 Token handling

- Never store passwords
- Tokens stored using OS-secure facilities where possible
- Refresh flow handled by approved auth library
- Workspace export excludes tokens

### 8.3 Authorization

Security boundary:

- Underlying shared store permissions

Application-level role:

- Viewer
- Contributor
- Planner

App permissions are behavioral/UX controls, not the sole security control.

---

## 9. SharePoint Provider Design Spike

Questions to validate:

1. Can Delivery Radar obtain an approved Entra app registration?
2. Can a native desktop public client authenticate using delegated permissions?
3. Which Microsoft Graph permissions are acceptable?
4. Can SharePoint Lists store the required entity volume comfortably?
5. How will record versioning / ETags be surfaced?
6. Can workspace-level permissions map cleanly to site/list permissions?
7. Can the app create required lists, or must they be provisioned manually?
8. Are Graph calls available from both Windows and macOS endpoints under bank policy?
9. What offline token/session duration is permitted?

Potential mapping:

- One SharePoint site per organisational area
- One or several lists per workspace
- Or a shared list set keyed by workspace ID

Avoid over-normalising if SharePoint list joins become cumbersome.

---

## 10. File Provider Design

Fallback provider should prioritize safety over convenience.

Recommended file strategy:

- Portable structured archive
- Version metadata
- Last-writer detection
- Atomic write/replace
- Explicit conflict handling

Avoid:

- Shared SQLite file
- Append-only writes without versioning
- Silent merge of divergent JSON

---

## 11. Portable Workspace Format

Suggested package:

```text
workspace.drworkspace
  manifest.json
  workspace.json
  entities/
    teams.json
    products.json
    commitments.json
    dependencies.json
    milestones.json
    people.json
    themes.json
  scenarios/
  history/
  settings/
```

Optional compression:

- ZIP container with custom extension

Must exclude:

- Credentials
- Access tokens
- OS-specific cache
- Secret provider configuration

Include format version for future migration.

---

## 12. Import/Export

### 12.1 Import parsers

MVP:

- XLSX
- CSV
- JSON

Excel import should support mapping sheets/columns.

### 12.2 Validation

Import preview must show:

- New entities
- Updates
- Errors
- Unmapped values
- Duplicate matches

### 12.3 Export

Structured export should support:

- Current filtered view
- Workspace data
- Snapshot metadata

---

## 13. Search

Use local cache for search.

Initial approach:

- SQLite FTS or in-memory indexed search

Search entities:

- Commitment names
- Team names
- Product names
- People
- Themes
- External-link labels

Command palette uses explicit command parsing, not AI.

---

## 14. Rendering and Performance

Performance target:

- Smooth interactions at 60 FPS where feasible
- Initial workspace render under ~2 seconds from local cache on normal enterprise laptops
- Drag feedback under 100 ms
- Rule recalculation localized to affected entities where possible

Optimization tactics:

- Semantic zoom
- Aggregation
- Viewport virtualization
- Memoized graph neighborhoods
- Incremental rule recalculation
- Worker thread for expensive layout/rule operations if needed

Do not render all 500 commitments in detail simultaneously.

---

## 15. Accessibility Engineering

Required:

- ARIA labels
- Keyboard focus model for visual objects
- Screen-reader-readable dependency descriptions
- Non-colour indicators
- Reduced motion
- High-contrast compatibility
- Keyboard move operations equivalent to drag/drop

---

## 16. Notifications

Native notifications are post-MVP-safe if corporate constraints block them.

Architecture should nevertheless allow a notification service abstraction.

Candidate events:

- Attention reached
- Owned action due
- Dependency overdue
- Health worsened
- Material baseline change

No server-side push required in MVP.

---

## 17. Security Safeguards

### 17.1 Secret detection

Use deterministic patterns for obvious:

- Private keys
- Bearer tokens
- AWS-style access keys
- Password assignments
- Known credential formats

Warn; do not attempt semantic classification.

### 17.2 Notes limits

Keep management notes short enough to discourage document/incident dumping.

### 17.3 Local data

- Encrypt sensitive local provider metadata where practical
- Secure tokens separately
- Clear-cache command
- Workspace access expiry
- Minimize PII

---

## 18. Testing Strategy

### 18.1 Unit tests

- Capacity rules
- Attention rules
- Health rules
- Carry-over
- Scenario diff
- Import validation
- Permission logic

### 18.2 Property/invariant tests

Examples:

- Scenario never mutates baseline before apply
- Done commitment cannot consume future baseline capacity unless explicitly retained
- Sum of committed footprints derives capacity load deterministically
- Workspace export/import round-trips without semantic loss

### 18.3 Visual interaction tests

- Drag/drop
- Undo/redo
- Focus mode
- Semantic zoom
- Dependency highlighting
- Reduced motion

### 18.4 Cross-platform CI

Build/test matrix:

- Windows
- macOS

### 18.5 Accessibility tests

Automated + manual keyboard/screen-reader checks.

---

## 19. Technical Spikes Required Before Production Commitment

1. Tauri deployment on ING-managed Windows laptop
2. Tauri deployment on ING-managed macOS laptop
3. No-admin installation feasibility
4. Code signing requirements
5. macOS notarisation requirements
6. Entra native app authentication
7. SharePoint List Graph access
8. Background sync constraints
9. Native notification constraints
10. Offline token/access policy
11. File provider conflict behavior inside OneDrive
12. Performance of chosen graph/layout library

---

## 20. Recommended Repository Structure

```text
delivery-radar/
  apps/
    desktop/
  packages/
    domain/
    rules/
    storage/
    storage-local/
    storage-sharepoint/
    storage-file/
    ui/
    visual-model/
    import-export/
    workspace-format/
  fixtures/
    sample-workspace/
  docs/
    prd/
    architecture/
    ux/
  scripts/
```

---

## 21. MVP Technical Exit Criteria

MVP is technically ready when:

- Windows and macOS builds run from the same codebase
- Sample workspace loads locally
- New workspace with smart defaults works
- Portfolio map handles target scale
- Capacity and scenario calculations are deterministic
- Radar rules are explainable
- Dependencies render visually
- Offline cache works
- Pending changes sync through at least one shared provider or validated equivalent
- Conflicts are not silently overwritten
- Import/export works
- Portable workspace works
- Accessibility baseline is met
- No enterprise-system integrations are required
