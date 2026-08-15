# Delivery Radar — Phased Build Plan

## 1. Delivery Strategy

Build Delivery Radar in vertical slices that prove the product thesis before investing in enterprise integration.

The build should prioritize:

1. Visual model
2. Planning semantics
3. Deterministic rules
4. Scenario reasoning
5. Local reliability
6. Shared persistence
7. Enterprise hardening

Do not begin with ServiceNow, Azure DevOps, or SharePoint integration.

---

## 2. Phase 0 — Product Foundation & Prototype

### Goal

Prove the visual language and core interactions with fake data.

### Deliverables

- Repository scaffold
- React/TypeScript app
- Basic design system
- Sample workspace fixture
- Portfolio Map prototype
- Team × Quarter capacity boxes
- Commitment blocks with XS/S/M/L/XL sizing
- Reserved-capacity rendering
- Drag/drop
- Ghost Candidate rendering
- Basic dependency lines
- Focus mode
- Reduced-motion toggle
- Keyboard basics

### Exit criteria

A user can:

- Open a fictional portfolio
- Understand team load visually
- Select a commitment
- See affected teams/products
- Drag a Candidate into a capacity area
- See load change immediately

### What not to build

- Persistence
- Auth
- SharePoint
- Import/export
- Notifications
- Full rules engine

---

## 3. Phase 1 — Core Domain MVP

### Goal

Create the actual product model locally.

### Deliverables

#### Domain model

- Workspace
- Team
- TeamQuarter
- CapacityReserve
- Commitment
- CapacityFootprint
- ProductService
- ProductImpact
- Dependency
- Milestone
- Theme
- Person
- ExternalLink

#### Lifecycle

- Idea
- Candidate
- Committed
- In Delivery
- Done
- On Hold
- Dropped

#### Planning

- Quarter navigation
- 18-month horizon
- Multi-team footprints
- Multi-quarter footprints
- Carry-over
- Baseline reserves

#### Details

- Progressive commitment panel
- Tooltips
- Smart defaults
- Quick Capture
- Inline editing
- Typed external links

### Exit criteria

A single user can model a real portfolio locally without needing external systems.

---

## 4. Phase 2 — Radar & Rule Engine

### Goal

Make Delivery Radar useful as an external memory and management-control tool.

### Deliverables

- Deterministic rule engine
- Attention signals
- Health signals
- Candidate readiness
- Missing ownership
- Dependency timing
- Capacity overflow
- Staleness
- Milestone timing
- My Radar
- Team/Portfolio Radar
- Reviewed — no change
- Defer/snooze
- Rule explanations
- Rule tooltips
- Workspace thresholds

### Exit criteria

A lead can trust the app to surface actionable management issues without manually maintaining reminders.

---

## 5. Phase 3 — QBR / Demand Flow + Scenario Mode

### Goal

Prove the core differentiated QBR interaction.

### Deliverables

- Demand Flow pipe
- Idea/Candidate staging
- Commit Gate
- Scenario creation
- Private-by-default scenarios
- Ghost capacity
- Cross-team impact preview
- Product-impact preview
- Scenario vs baseline comparison
- Undo/redo
- Consequence preview
- Selective scenario apply
- Mandatory/constrained markers
- Trade-off explanation panel

### Exit criteria

A lead can run a realistic QBR capacity conversation entirely inside Delivery Radar.

---

## 6. Phase 4 — Portfolio Intelligence Views

### Goal

Complete the major visual lenses.

### Deliverables

- Product/Service Impact view
- Change-load signal
- Themes lens
- 18-month Timeline
- Milestones on timeline
- Dependency Map
- Bottleneck detection
- Focus neighborhood
- Semantic zoom
- Table/list companions
- Composable filter chips
- Ctrl/Cmd + K search

### Exit criteria

The same workspace can answer:

- Can we deliver it?
- Where does change land?
- What is blocking what?
- What is upcoming?
- What needs attention?

---

## 7. Phase 5 — History, Learning, and Quarter Close

### Goal

Make the tool improve planning over time.

### Deliverables

- Meaningful change history
- Original vs current estimates
- Quarter movement history
- Carry-over analysis
- Quarter-close workflow
- Planned vs outcome view
- Operational reserve variance
- Explainable planning recommendations
- Recurring commitment support

### Exit criteria

The app can provide useful evidence for the next QBR based on previous quarters without timesheets.

---

## 8. Phase 6 — Workspace UX & Portability

### Goal

Make the product practical for repeated real use.

### Deliverables

- Multiple workspaces
- Workspace switcher
- Sample workspace
- New workspace with smart defaults
- Progressive onboarding
- Import XLSX/CSV/JSON
- Structured export
- Portable `.drworkspace` format
- Named snapshots
- Restore with diff
- Presentation mode
- Save/reopen visual snapshots

### Exit criteria

A new lead can install the app, understand the sample, create/import a workspace, and run a meeting from it.

---

## 9. Phase 7 — Cross-Platform Desktop Packaging

### Goal

Turn the web prototype into a bank-friendly desktop product.

### Deliverables

- Tauri shell
- Windows package
- macOS package
- Local SQLite cache
- OS-safe token storage abstraction
- Local provider
- Offline status
- Pending change queue
- Clear local data
- Native menu/shortcuts
- Native notifications if feasible

### Technical spikes

- No-admin install
- Windows signing
- macOS signing/notarisation
- WebView policy
- Background execution
- Notification policy

### Exit criteria

The same feature set works reliably on both Windows and macOS.

---

## 10. Phase 8 — Shared Storage & Collaboration

### Goal

Enable multiple users without deploying a custom backend.

### Deliverables

- WorkspaceProvider abstraction hardened
- SharePoint/M365 provider spike
- File provider fallback
- Microsoft identity integration where approved
- Viewer / Contributor / Planner roles
- People vs user linkage
- Shared baseline sync
- Private/shared scenarios
- Conflict detection
- Explicit conflict-resolution UI
- Access revalidation
- Offline expiry policy

### Exit criteria

Two or more users can safely work against the same workspace without silent data loss.

---

## 11. Phase 9 — Enterprise Hardening

### Goal

Make the application suitable for sustained organisational use.

### Deliverables

- Security review
- Dependency scanning
- Secret-paste warnings
- Configurable note limits
- Accessibility audit
- Performance testing at target scale
- Recovery testing
- Workspace migration/versioning
- Code signing pipeline
- Auto-update strategy if allowed
- Packaging documentation
- Admin documentation
- User guidance

### Exit criteria

The application meets agreed ING operational/security constraints.

---

## 12. Post-MVP Roadmap

Only after the core product is validated.

### 12.1 Read-only enrichment adapters

Potential sequence:

1. Azure DevOps
2. ServiceNow / PPM
3. Forge
4. Confluence
5. Teams context links

Principle:

- Link first
- Read/enrich second
- Avoid write-back unless a compelling use case is proven

### 12.2 Cross-workspace roll-up

Read-only executive portfolio view.

### 12.3 Native notifications

If deferred from MVP.

### 12.4 Directory lookup

Microsoft identity/directory-assisted stakeholder selection.

### 12.5 Advanced historical heuristics

Still deterministic; no AI.

---

## 13. Suggested First Development Milestones

### Milestone A — “Physical portfolio”

- Sample workspace
- Portfolio map
- Capacity containers
- Drag/drop
- Focus mode

### Milestone B — “Trust the model”

- Domain persistence
- Commitment details
- Dependencies
- Products/services
- Tooltips
- Smart defaults

### Milestone C — “Tell me what matters”

- Radar
- Rule engine
- Review/defer
- Health/attention separation

### Milestone D — “Can we take this?”

- Demand Flow
- Commit Gate
- Scenario mode
- Consequence preview
- Cross-team footprints

### Milestone E — “Run the QBR”

- Timeline
- Product impact
- Dependency map
- Presentation mode
- Filters/search

### Milestone F — “Use it for real”

- History
- Quarter close
- Import/export
- Multiple workspaces
- Snapshots

### Milestone G — “Share it”

- Tauri packaging
- Local cache
- Shared provider
- Identity
- Conflict resolution

---

## 14. Recommended Backlog Structure

Organize engineering work by vertical capability rather than technical layer.

Example epics:

1. Portfolio Map
2. Commitment Model
3. Capacity Model
4. Product Impact
5. Dependency Model
6. Radar & Rules
7. Demand Flow
8. Scenario Engine
9. Timeline & Milestones
10. Search & Filters
11. History & Quarter Close
12. Workspace Management
13. Import/Export
14. Desktop Runtime
15. Offline & Sync
16. SharePoint Provider
17. Permissions
18. Accessibility
19. Security
20. Packaging & Distribution

---

## 15. Recommended MVP Release Cut

If scope pressure requires a cut, preserve the management loop.

### Must-have

- Portfolio Map
- Teams / Team × Quarter capacity
- Commitments
- Products/services
- Dependencies
- Radar
- Demand Flow
- Scenario Mode
- Rules/tooltips
- 18-month timeline
- External links
- Local persistence
- Import/export
- Cross-platform desktop

### Can move to first follow-up

- Native notifications
- Recurrence automation
- Advanced historical recommendations
- Sophisticated snapshot sharing
- Shared scenario publication
- Full file-provider collaboration
- SharePoint provider if approval is delayed

### Never trade away for MVP

- Visual-first interaction
- Deterministic explainability
- Separation from project-management tooling
- Scenario vs baseline distinction
- Team capacity vs product change-load distinction
- Accessibility
- Undo/redo
- Smart defaults

---

## 16. Discovery / Validation Plan

Before building the shared-storage layer, validate with real portfolio data.

### Test scenario

Model:

- 4–5 teams
- 3–5 products/services
- 15–25 commitments
- 6–10 QBR candidates
- Multiple dependencies
- BAU reserves
- At least one overloaded team
- At least one overloaded product change-load area
- At least one carry-over item

### Validation questions

- Can a lead understand the landscape quickly?
- Does block size feel trustworthy enough?
- Are Team × Quarter boxes intuitive?
- Does the Demand Flow pipe help discussion?
- Is Commit Gate useful or ceremonial?
- Are dependency visuals readable?
- Does Radar surface the right things?
- Does Scenario Mode reduce meeting friction?
- Does the app reduce mental/context-switch load?
- Do business leads understand the model as naturally as technology leads?

---

## 17. Product Guardrails for the Team

During development, reject features that answer:

- “How do we manage sprint execution?”
- “How do we track every task?”
- “How do we calculate individual utilization?”
- “How do we calculate percent complete?”
- “How do we replace ServiceNow?”
- “How do we make everyone update this?”

Prefer features that answer:

- “What is happening?”
- “What needs attention?”
- “Can we take this?”
- “What moves if we do?”
- “Where is the bottleneck?”
- “Where does change land?”
- “What did we learn?”
