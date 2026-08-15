# Delivery Radar — Product Requirements Document (PRD)

## 1. Product Summary

**Delivery Radar** is a lightweight, cross-platform visual portfolio control tool for business and technology leads who coordinate multiple teams, products/services, commitments, dependencies, and planning horizons across disparate enterprise systems.

It is explicitly **not a project-management tool** and does not replace Azure DevOps, ServiceNow, Confluence, Forge, Teams, PPM, or other systems of record.

Its purpose is to provide a trusted management layer that answers:

- What is happening across my portfolio?
- What requires attention now?
- Can we safely accept new demand?
- Where are the bottlenecks?
- Which teams will absorb the work?
- Which products/services will absorb the change?
- What happens if we move, defer, add, or remove a commitment?
- What did we learn from previous quarters?

The primary design goal is to make the portfolio **physically understandable** through blocks, containers, flows, spatial relationships, semantic zoom, and graphical dependencies rather than through forms and dashboards.

---

## 2. Primary Product Principle

> **Model reality visually; do not recreate execution management.**

Delivery Radar owns **management context** only. Existing enterprise tools remain the systems of record for execution, incidents, change management, documentation, product/service records, and detailed project delivery.

A commitment may link to:

- Azure DevOps
- ServiceNow
- ServiceNow PPM
- Confluence
- Forge
- Teams
- Generic URLs

The application follows the rule:

> **Reference, do not replicate.**

---

## 3. Target Users

### 3.1 Primary users

A **lead** responsible for coordinating work across multiple teams, products, or domains, including:

- Business leads
- Technology leads
- Chapter leads
- Product leads
- IT leads
- Domain leads
- Portfolio-responsible managers

The product must not assume an engineering-only worldview.

### 3.2 Secondary users

- Product managers
- Architects
- Programme contributors
- Stakeholders who contribute candidate demand or scenarios
- Viewers who need portfolio transparency

### 3.3 MVP adoption principle

The product must deliver value even if a **single lead maintains most of the information**. Its usefulness must not depend on every engineer or stakeholder updating it.

---

## 4. Product Success Statement

> A lead can maintain a trustworthy visual model of a multi-team/product portfolio, identify upcoming attention and bottlenecks, test planning decisions, and run QBR/management conversations without duplicating execution management from existing enterprise systems.

### 4.1 MVP success criteria

The MVP is successful if a lead can:

1. Open the Portfolio Map and understand the current and near-term landscape within roughly one minute.
2. Use Radar to identify what needs action early enough to intervene.
3. Test new demand against capacity during QBR.
4. Identify team, dependency, and cross-team bottlenecks.
5. Understand both delivery-team impact and business/product change impact.
6. Create private scenarios and compare them with the baseline.
7. Run QBR or management discussions directly from the application.
8. Reduce dependence on post-it notes, ad hoc Teams boards, and manual consolidated spreadsheets.
9. Trust that non-urgent work will surface when attention is needed.

---

## 5. Explicit Anti-Goals

Delivery Radar must **not** become:

- Sprint or backlog management
- Task management
- Timesheet management
- Person-level resource planning
- Skills-capacity planning
- A percent-complete tracker
- A Gantt or critical-path scheduler
- Chat or threaded discussion
- Document management
- A financial/project-budget system
- A generic dashboard builder
- A custom workflow engine
- A detailed approval system
- An enterprise PPM replacement
- An organisation chart
- A mobile-first product
- An AI-based assistant

AI is explicitly out of scope. Guidance is deterministic and rule-based.

---

## 6. Core Domain Model

### 6.1 Managed Commitment

The core visual object is a **Managed Commitment**.

Definition:

> A piece of work or obligation significant enough to consume meaningful capacity, require management attention, create dependencies, affect products/services, or require a decision.

Typical examples:

- New capability
- Strategic initiative
- Regulatory commitment
- LCM activity
- Platform migration
- Operational stability initiative
- Material production issue remediation
- Cross-team dependency
- Major decision or approval requirement

Not suitable as commitments:

- Sprint stories
- Small code changes
- Individual defects
- Unit tests
- Detailed execution tasks

### 6.2 Commitment lifecycle

Primary lifecycle:

**Idea → Candidate → Committed → In Delivery → Done**

Exceptional states:

- On Hold
- Dropped

Notes:

- “Shaping” is not a separate state; shaping happens while an item remains an Idea.
- Only **Committed** work consumes official baseline capacity.
- Candidates may consume translucent/ghost capacity only inside Scenario Mode.

### 6.3 Commitment class

Each commitment may be classified as:

- Mandatory
- Strategic
- Operational
- Discretionary

### 6.4 Importance

- High
- Medium
- Low

Class and importance support trade-off explanation but never calculate a synthetic priority score.

### 6.5 Value / Outcome

Each commitment may contain:

- A short **Outcome** statement
- One or more qualitative **Value Drivers**

Default value drivers:

- Revenue / Growth
- Client Experience
- Regulatory / Compliance
- Risk Reduction
- Resilience
- Cost / Efficiency
- Strategic Enablement
- Technology Health

No mandatory numeric business-value scoring.

---

## 7. Capacity Model

### 7.1 Fundamental planning unit

Capacity is represented by:

> **Team × Quarter**

Quarter is the default planning horizon.

### 7.2 Relative baseline

A normal team quarter begins at:

> **100 relative capacity units**

This is deliberately not person-days or story points.

### 7.3 Relative sizing

Commitment size uses:

- XS
- S
- M
- L
- XL

The exact internal conversion may be configured but the UI must clearly communicate that sizing is approximate planning capacity, not delivery estimation.

Default guidance may map approximately to:

- XS ≈ 5
- S ≈ 10
- M ≈ 20
- L ≈ 35
- XL ≈ 50+

These mappings are defaults, not contractual precision.

### 7.4 Capacity adjustments

Teams may adjust the normal-quarter baseline for material known changes such as:

- Vacancies
- Extended leave
- Onboarding/ramp-up
- Material staffing changes

No person-level planning is required.

### 7.5 Baseline reserves

Each Team × Quarter may reserve visible baseline capacity for:

- Production support
- BAU
- LCM baseline
- Team overhead
- Mandatory engineering work

Baseline reserves are visually distinct from named commitments.

### 7.6 Exceptional operational work

Material deviations from routine operational load become explicit commitment blocks.

### 7.7 Multiple team footprints

One commitment remains a single canonical object but can consume capacity across multiple teams and quarters.

Example:

- Payments / Q4: L
- Platform / Q4: S
- Security / Q4: XS
- Payments / Q1: M

The commitment has one **primary delivery team** but may have multiple linked capacity footprints.

### 7.8 Carry-over

Carry-over is a derived condition, not a lifecycle state.

If work slips into a later quarter:

- Original plan is preserved
- New receiving-quarter capacity is consumed
- Carry-over is visually distinct from originally planned work
- QBR explicitly separates carry-over from new demand

---

## 8. Product / Service Impact Model

Delivery capacity and business change impact are intentionally separate.

### 8.1 Product/service impact types

A commitment may affect multiple products/services with typed impact:

- Primary
- Major
- Minor
- Dependency

### 8.2 Product/business change load

Products/services do not automatically use the same 100-unit capacity model as teams.

Instead, Delivery Radar derives a separate **change-load signal** based on:

- Number of overlapping Primary/Major impacts
- Commitment sizes
- Mandatory work
- Timing overlap
- Product/service concentration
- Optional workspace thresholds

Typical presentation:

- Low
- Medium
- High

This answers:

> Where will the change land?

while Team Capacity answers:

> Can we deliver it?

---

## 9. Dependencies

Dependencies are first-class, typed, directional, and visual.

### 9.1 Dependency types

Initial types:

- Blocked by
- Requires
- Depends on delivery of
- Needs capacity from
- Needs decision/approval from

### 9.2 Dependency attributes

A dependency may contain:

- Owner
- Needed-by date
- Status: Open / At Risk / Resolved
- Optional link to a milestone
- Optional management note

### 9.3 Visual representation

Dependencies must appear graphically in:

- Portfolio focus mode
- Timeline
- Capacity/QBR views where relevant
- Dedicated Dependency Map

Visual grammar:

- Direction shown with arrows
- Hard/blocking dependencies shown differently from softer dependencies
- Status never communicated by colour alone
- Lines may use pattern, thickness, icons, or state markers

### 9.4 Bottleneck detection

The application should detect concentration points such as:

- Many commitments needing the same team
- Many commitments waiting for the same decision/approval
- Capacity-constrained teams that are also dependency hubs

---

## 10. Time, Attention, and Radar

### 10.1 Time concepts

A commitment may have:

- Target / due date
- Attention date
- Latest safe start / decision date
- Next action
- Next-action owner
- Next-action due date
- Optional lead time
- Optional management milestones

### 10.2 Attention vs health

These are separate concepts.

A commitment may be:

- Healthy but require attention
- Unhealthy but require no action from the current user

### 10.3 Radar

Radar shows **only attention-worthy items**, not the entire portfolio.

Two perspectives:

- My Radar
- Team/Portfolio Radar

Radar reasons may include:

- Decision required
- Dependency approaching/overdue
- Next action due/overdue
- Target approaching
- Capacity problem
- Blocked item
- Missing owner
- Candidate requiring commitment decision
- Stale item
- Milestone approaching/overdue
- Material baseline change affecting the user

### 10.4 Radar actions

- Open
- Reviewed — no change
- Defer / Snooze
- Resolve relevant action

No generic permanent dismissal for system-generated signals.

Material deterioration may break through a snooze.

---

## 11. Health Model

Health is primarily derived from explainable signals.

Examples:

- Dependency overdue
- Milestone missed
- Capacity exceeded
- Required decision missing
- Target date threatened
- Stale management model
- Linked commitment moved

Human judgement may add context or disagree with the system but may not hide the underlying signal.

The product keeps separate:

- Lifecycle
- Health
- Attention

---

## 12. Confidence and Uncertainty

Confidence is qualitative:

- Low
- Medium
- High

Tracked separately for:

- Size
- Timing
- Scope

Confidence is not health.

Uncertainty should be reflected visually, for example with:

- Ghost/translucent extensions
- Approximate ranges
- Distinct outline states

No composite numerical confidence score.

---

## 13. Milestones

Commitments may have a small number of optional management-level milestones.

Guideline:

- 0–6 milestones per commitment
- No detailed task plan

Milestones may:

- Appear on the timeline
- Trigger Radar rules
- Act as dependency targets

---

## 14. Visual Product Direction

### 14.1 Core visual grammar

- **Block** = commitment
- **Block size** = approximate capacity consumption
- **Container** = Team × Quarter capacity
- **Reserved shaded region** = BAU/support/LCM/overhead reserve
- **Ghost/translucent block** = scenario candidate / uncertainty
- **Line** = dependency
- **Arrow** = dependency direction
- **Lock marker** = constrained/mandatory
- **Warning halo/icon/pattern** = attention/health signal
- **Overflow** = overcommitment
- **Distinct hatch/pattern** = carry-over

The UI must not rely on colour alone.

### 14.2 Home screen

Default landing screen:

> **Visual Portfolio Map**

The Portfolio Map is a structured living landscape, not a free-form graph.

It connects:

- Teams
- Commitments
- Products/services
- Themes
- Time horizon
- Attention/health signals

The user begins high-level and then progressively zooms/focuses into relevant areas.

### 14.3 Lenses

The same portfolio model can be viewed through multiple lenses:

- Portfolio
- Teams
- Products/Services
- Themes
- Dependencies
- Attention
- QBR / Demand Flow
- Timeline

Lenses change emphasis; they do not create separate data copies.

### 14.4 Semantic zoom

At high level:

- Aggregate teams
- Aggregate products
- Show counts and concentration signals

At lower levels:

- Reveal commitment blocks
- Reveal capacity footprints
- Reveal dependencies
- Reveal milestones/details

Design principle:

> Aggregate before cluttering.

### 14.5 Focus mode

Selecting a commitment causes unrelated elements to visually recede while relevant:

- teams
- products
- dependencies
- milestones
- attention points

remain emphasized.

---

## 15. QBR / Demand Flow

The pipe is the central metaphor of the QBR/Demand Flow lens.

The main Portfolio Map does not permanently show the pipe.

### 15.1 Demand Flow behavior

- Ideas and Candidates appear before commitment
- Candidate blocks can enter Scenario Mode
- Candidate may be directed toward a Team × Quarter
- Commit Gate marks the transition into official baseline capacity
- Candidate footprints remain ghost/translucent before commitment
- Capacity consequences update immediately

### 15.2 Commit Gate

Crossing the Commit Gate is a deliberate planning action:

> The organisation is accepting capacity consumption into the baseline.

It is not a bureaucratic approval workflow.

### 15.3 Overflow behavior

When capacity does not fit, the tool explains:

- Amount of excess load
- Constrained/mandatory items
- Movable alternatives
- Cross-team effects
- Product impacts
- Dependency consequences

The tool supports decisions but does not choose priorities automatically.

---

## 16. Scenario Mode

Scenario Mode is private by default.

Users may:

- Clone baseline
- Move commitments
- Move quarter footprints
- Add candidate demand
- Place items on hold
- Compare with baseline
- Save
- Share
- Apply selected changes

Scenario changes do not alter baseline until explicitly applied.

Applying a scenario presents a consolidated diff and consequence preview.

---

## 17. History and Quarter Close

### 17.1 Lightweight change history

Meaningful baseline changes are recorded:

- Who
- What changed
- When
- Optional reason/note

No detailed audit ledger is required.

### 17.2 Event-driven updates

A commitment is considered meaningfully updated when:

- Capacity changes
- Target moves
- Lifecycle changes
- Dependency changes
- Milestone changes
- Note is added
- Next action changes

Users may also select:

> **Reviewed — no change**

This confirms the management model remains current without status-report bureaucracy.

### 17.3 Quarter-close review

At quarter end, a lightweight review captures:

- Completed commitments
- Carry-over
- Dropped work
- Operational load above/below expectation
- Material capacity deviations
- Original vs current size
- Original vs actual target timing

No person-days or detailed actual effort.

Historical patterns may produce deterministic planning recommendations for future quarters.

---

## 18. Collaboration

### 18.1 Shared baseline

Each workspace has a shared baseline representing the current management plan.

### 18.2 Roles

Workspace-level roles:

- Viewer
- Contributor
- Planner/Admin

Viewer:

- Explore views
- Read baseline
- View shared scenarios

Contributor:

- Create/edit Ideas and Candidates
- Add dependencies, impacts, links
- Create/share scenarios

Planner/Admin:

- Modify baseline
- Commit work
- Move committed capacity
- Change team capacity assumptions
- Manage workspace configuration

### 18.3 People vs users

A Person/Stakeholder does not need application access.

Owners may be:

- Person
- Team

An authenticated user may later be linked to an existing stakeholder record.

---

## 19. Workspace Model

A workspace represents a manageable portfolio containing multiple teams.

It may also contain:

- Products/services
- People/stakeholders
- Commitments
- Themes
- Rules
- Templates
- Scenarios
- Snapshots
- History

### 19.1 Themes

Themes are optional workspace-defined classification lenses.

A commitment may belong to multiple themes.

Themes:

- Do not create hierarchy
- Do not own capacity
- Do not create workflow

Free-form tags may supplement curated Themes.

### 19.2 Multiple workspaces

The application supports multiple independent workspaces with a workspace switcher.

Cross-workspace aggregation and dependencies are deferred.

---

## 20. Search, Filters, and Tables

### 20.1 Universal search

Ctrl/Cmd + K opens deterministic universal search/navigation.

It supports:

- Commitments
- Teams
- Products/services
- Themes
- People
- Structured filter suggestions

It does not pretend to understand arbitrary natural language.

### 20.2 Filters

Filters are composable and visible as chips/lenses.

Example:

- Q1 2027
- Candidate
- Account & Cash Management
- Requires Architecture

### 20.3 Companion views

Major graphical views may have optional list/table companions for:

- Sorting
- Precision
- Accessibility
- Export

Rule:

> Visual for understanding; structured lists for precision.

---

## 21. Rules, Templates, and Tooltips

### 21.1 No AI

The application must not depend on AI.

All automation and recommendations are:

- Deterministic
- Explainable
- Rule-based
- Template-driven

### 21.2 Rule engine

Rules may identify:

- Capacity pressure
- Dependency timing
- Staleness
- Candidate readiness
- Missing owner
- Overdue milestone
- Change-load concentration
- Carry-over patterns

Rules should explain:

- What happened
- Why it matters
- Recommended action

### 21.3 Advisory vs hard rules

Most guidance is advisory.

A small configurable set of hard guardrails may enforce essential data integrity.

Examples:

- Committed item must have an owner
- Mandatory commitment must have a target date
- Capacity footprint must specify team and quarter

### 21.4 Core semantics vs workspace policy

Core semantics are fixed:

- Lifecycle meanings
- Size semantics
- Impact semantics
- Attention vs health
- Dependency meaning

Workspace-configurable:

- Thresholds
- Staleness timing
- Warning lead times
- Templates
- Guardrails
- Rules

### 21.5 Tooltips

Important concepts must include contextual help that explains both:

- What the concept means
- What it does not mean

Example:

> **Size: Large** — Approximate relative capacity consumption for this team and quarter. It is not a story-point or person-day estimate.

This prevents users from improvising local meanings.

---

## 22. Starter Experience and Smart Defaults

The product must work out of the box.

### 22.1 First launch

Two primary options:

1. **Explore Sample Workspace**
2. **Create New Workspace**

### 22.2 Sample Workspace

The sample contains fictional:

- Teams
- Products/services
- Ideas
- Candidates
- Committed work
- Dependencies
- Operational reserves
- Product impacts
- Attention signals
- Themes
- External links
- Sample scenario
- Planner/Admin user

### 22.3 New Workspace

A new workspace has no fictional actors/data but includes smart defaults:

- Quarterly planning
- Team baseline 100
- XS/S/M/L/XL
- Confidence model
- Lifecycle
- Commitment classes
- Product impact types
- Default rules
- Default guardrails
- Default templates
- Default tooltips
- Default views/lenses

Onboarding is progressive, not wizard-driven.

---

## 23. Import, Export, Snapshots

### 23.1 Import

MVP supports:

- Excel
- CSV
- JSON

For bootstrapping:

- Teams
- Products/services
- Commitments
- People
- Basic capacities

### 23.2 Export

MVP should support useful structured exports for:

- Meetings
- Interoperability
- Portfolio review

### 23.3 Portable workspace

Workspace export/import should be possible via a portable package such as:

`workspace.drworkspace`

It includes portfolio data and configuration but never credentials/tokens.

### 23.4 Snapshots

Users can create named snapshots.

Restore should:

- Show a diff
- Explain impacted objects
- Require deliberate confirmation

---

## 24. Presentation Mode

The application should be usable live during:

- QBR
- Portfolio review
- Management meetings

Focus/Presentation mode removes editing chrome while preserving the interactive model.

Users should be able to:

- Start from 18-month portfolio
- Focus on a team/product
- Open Demand Flow
- Test a scenario
- Inspect bottlenecks
- Return to overview

A separate generic report designer is out of scope.

---

## 25. Recurring Commitments

Material named commitments may recur.

Supported conceptually:

- Quarterly
- Annual
- Simple custom interval

The system may:

- Propose the next occurrence
- Optionally auto-create the next occurrence a configured period before target

Each occurrence is a separate commitment instance.

Routine BAU remains reserve capacity, not recurring commitment objects.

---

## 26. Scale and Performance Target

One workspace should comfortably support approximately:

- 20 teams
- 20–30 products/services
- Up to 500 current/future commitments
- Several hundred dependencies
- Multiple saved scenarios
- Historical records in the thousands
- 18-month planning horizon

The UI must use aggregation and semantic zoom rather than rendering every object at once.

---

## 27. Security and Data Boundaries

Delivery Radar is intended for management metadata, not sensitive operational detail.

The app should discourage storing:

- Credentials
- Access tokens
- Private keys
- Production logs
- Customer data
- Detailed vulnerability information
- Incident dumps

Deterministic checks may warn on obvious secrets.

Local cache must:

- Avoid storing passwords
- Use OS-secure credential storage where applicable
- Support clear-local-data action
- Revalidate access periodically
- Support configurable offline-access validity

---

## 28. Cross-Platform Requirement

Hard requirement:

- Windows
- macOS

Primary distribution:

- Lightweight native desktop app

Development may use:

- Browser
- Optional Docker

Deployment objective:

- No administrator rights required where technically possible

Technical validation required for:

- Corporate application signing
- Windows distribution policy
- macOS signing/notarisation
- System WebView compatibility
- Entra app registration
- SharePoint permissions
- Native notifications
- Background sync

---

## 29. Persistence Strategy

Persistence must use a storage-provider abstraction.

Preferred shared provider:

- Microsoft 365 / SharePoint structured storage

Fallback:

- File-based provider

Local provider:

- Local development/single-user mode

The product requires no centrally hosted custom backend.

Shared baseline supports:

- Local cache
- Offline editing
- Pending sync indicators
- Explicit conflict resolution

---

## 30. MVP Boundary

### In MVP

- Visual Portfolio Map
- Semantic zoom/focus
- Team × Quarter capacity
- Baseline reserves
- Managed commitments
- Lifecycle
- Multi-team/multi-quarter capacity footprints
- Typed product/service impacts
- Themes
- Visual dependencies
- Radar
- Attention/defer/review
- Demand Flow with pipe metaphor
- Commit Gate
- Scenario Mode
- 18-month timeline
- Milestones
- Carry-over
- Quarter close
- History
- Rules/templates/tooltips
- Search/filters
- List/table companions
- Multiple workspaces
- Smart-default onboarding
- Sample workspace
- Typed external links
- Import/export
- Portable workspace
- Snapshots/restore
- Presentation mode
- Accessibility
- Workspace permissions
- Local cache/offline behavior
- Storage abstraction
- Cross-platform desktop packaging

### Explicitly deferred

- Mobile app
- Azure DevOps direct integration
- ServiceNow direct integration
- Confluence direct integration
- Forge direct integration
- Write-back integrations
- Real-time collaborative cursors/editing
- Cross-workspace roll-up
- Detailed project scheduling
- Task management
- Person-level resource planning
- Financial management
- Generic report builder
- AI features
