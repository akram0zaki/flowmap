# Delivery Radar — UX and Functional Specification

## 1. UX North Star

Delivery Radar should feel like **manipulating a physical model of the portfolio**, not filling out enterprise forms.

The interface must help a lead:

1. See the landscape.
2. Focus on an area.
3. Manipulate possible futures.
4. Understand consequences.
5. Return to the big picture.

The primary design principle is:

> **Visual for understanding; structured views for precision.**

---

## 2. Visual Language

### 2.1 Canonical symbols

| Visual Element          | Meaning                              |
| ----------------------- | ------------------------------------ |
| Block                   | Managed commitment                   |
| Block size              | Approximate relative capacity        |
| Container               | Team × Quarter capacity              |
| Shaded region           | Reserved baseline capacity           |
| Translucent/ghost block | Candidate in scenario or uncertainty |
| Hatched block           | Carry-over                           |
| Arrow/line              | Dependency                           |
| Lock marker             | Mandatory/constrained commitment     |
| Warning marker          | Attention/health signal              |
| Overflow                | Over-capacity condition              |
| Milestone marker        | Management-level checkpoint          |

No state is communicated by colour alone.

### 2.2 Motion

Motion is functional, not decorative.

Use motion for:

- Drag/drop response
- Flow through Demand Flow pipe
- Focus transitions
- Dependency highlighting
- Scenario comparison
- Capacity change response

Do not use:

- Confetti
- Gamification effects
- Decorative animation unrelated to meaning

Reduced Motion must be supported.

---

## 3. Application Shell

### 3.1 Primary navigation

Recommended top-level navigation:

- Portfolio
- Radar
- Demand Flow
- Timeline
- Dependencies
- Products
- History

Secondary actions:

- Workspace switcher
- Search / Command palette
- Scenario selector
- Presentation mode
- Import/export
- Workspace settings

### 3.2 Workspace switcher

Users may switch between independent workspaces without restarting.

Sample workspace is visually identifiable and resettable.

---

## 4. Home — Portfolio Map

### 4.1 Purpose

The Portfolio Map is the default landing screen.

Question answered:

> What is the current landscape?

### 4.2 High-level content

The default map should show:

- Current quarter visually centred
- Adjacent quarters visible
- Up to 18-month horizon
- Team aggregates
- Product/service aggregates
- Commitment concentration
- Attention indicators
- Capacity pressure
- Change-load pressure
- Theme overlays when selected

### 4.3 Semantic zoom levels

#### Level 1 — Portfolio overview

Show:

- Teams as aggregate regions/cards
- Products/services as aggregate regions/cards
- Counts
- High-level pressure
- Attention totals

Hide:

- Most individual commitments
- Most dependency lines
- Most milestones

#### Level 2 — Area focus

Selecting a team/product reveals:

- Relevant commitments
- Capacity footprints
- Product impact
- Relevant dependencies
- Attention signals

#### Level 3 — Commitment focus

Selecting a commitment:

- Highlights the commitment
- Shows all capacity footprints
- Shows impacted products/services
- Shows upstream/downstream dependencies
- Shows milestones
- Shows next action/attention
- Fades unrelated content

### 4.4 Portfolio lenses

Available lenses:

- Portfolio
- Teams
- Products
- Themes
- Attention
- Dependencies
- QBR
- Timeline

Lenses alter emphasis without changing the underlying data.

---

## 5. Demand Flow / QBR View

### 5.1 Purpose

Question answered:

> What happens if we accept this new demand?

### 5.2 Layout

Recommended conceptual structure:

**Ideas/Candidates → Commitment Flow Pipe → Commit Gate → Team × Quarter Containers**

Candidates can be:

- Dragged onto the flow
- Directed toward a target quarter
- Assigned to primary team
- Tested in Scenario Mode
- Committed through the gate

### 5.3 Scenario candidate behavior

Candidate in Scenario Mode:

- Appears translucent
- Occupies tentative capacity
- Does not alter baseline
- May create tentative secondary footprints
- May display tentative product impacts
- May trigger tentative bottleneck warnings

### 5.4 Commit Gate

Crossing the Commit Gate:

- Converts Candidate to Committed
- Applies selected capacity footprints
- Records history
- Triggers deterministic rules
- May show consequence preview if materially cascading

### 5.5 Capacity box interaction

Capacity container should show:

- Adjusted capacity baseline
- Reserved capacity
- Existing planned work
- Carry-over
- New committed work
- Tentative scenario work
- Headroom
- Overflow

### 5.6 Overflow interaction

When over capacity:

- Container visually overflows
- Exact reason is shown
- Mandatory/constrained blocks are marked
- Movable alternatives are highlighted
- Cross-team impact is summarized
- Product/service change impact is summarized

The system must not recommend a single “correct” priority score.

---

## 6. Radar

### 6.1 Purpose

Question answered:

> What needs intervention now?

### 6.2 Modes

- My Radar
- Team/Portfolio Radar

### 6.3 Grouping

Group by attention reason rather than by project name.

Suggested groups:

- Action needed now
- This week
- Emerging
- Capacity
- Dependencies
- Stale/review
- Missing ownership
- Candidate decisions

### 6.4 Item contents

Each item shows:

- Commitment/dependency/action name
- Why it is surfaced
- Required timing
- Owner
- Impact/importance
- Quick actions

### 6.5 Quick actions

- Open
- Reviewed — no change
- Defer
- Resolve

### 6.6 Snooze

Defer requires a return date or preset.

Underlying condition remains unchanged.

A more severe signal can surface early.

---

## 7. Timeline

### 7.1 Purpose

Question answered:

> How does work span time and quarters?

### 7.2 Time controls

Presets:

- Now
- QBR
- 18 Months

Current quarter remains visually centred.

### 7.3 Commitment rendering

A canonical commitment may appear across multiple quarters.

Fragments represent capacity footprints, not duplicate commitments.

### 7.4 Milestones

Milestones appear as visual markers.

Dependencies may target milestone markers.

### 7.5 Carry-over

Carry-over is visually distinct and preserves original plan history.

---

## 8. Dependency Map

### 8.1 Purpose

Question answered:

> Where are commitments converging on shared constraints?

### 8.2 Nodes

Potential node types:

- Commitment
- Team
- Product/service
- Decision/approval
- Milestone

### 8.3 Links

Directional, typed, and status-aware.

### 8.4 Visual overload controls

Use:

- Filtering
- Focus mode
- Grouping
- Semantic zoom
- Hide unrelated links by default
- Expand neighborhood around selected node

Do not render a permanent “spaghetti graph”.

### 8.5 Bottleneck emphasis

Highlight:

- High in-degree dependency hubs
- Capacity-constrained teams with many incoming dependencies
- Overdue approval/decision hubs
- Cross-product concentration

---

## 9. Product/Service Impact View

### 9.1 Purpose

Question answered:

> Where does the change land?

### 9.2 Product grouping

Show commitments grouped by:

- Primary
- Major
- Minor
- Dependency

### 9.3 Change load

Derived signal:

- Low
- Medium
- High

Must explain why:

- Number of major changes
- Overlapping timing
- Mandatory concentration
- Large commitments
- Multiple cross-product dependencies

---

## 10. Commitment Details

### 10.1 Progressive disclosure

Creating a commitment requires very few fields.

Suggested minimum:

- Name
- Primary team
- Approximate size
- Target quarter
- Owner

Everything else is optional and progressively added.

### 10.2 Detail panel

Recommended sections:

**Identity**

- Name
- Lifecycle
- Class
- Importance
- Owner
- Primary team

**Planning**

- Target quarter/date
- Size
- Confidence
- Capacity footprints
- Carry-over state

**Outcome**

- Outcome statement
- Value drivers
- Themes

**Impact**

- Products/services
- Typed impacts

**Attention**

- Attention date
- Next action
- Next action owner
- Due date
- Latest safe start

**Dependencies**

- Typed dependencies
- Owner
- Needed by
- Status

**Milestones**

- 0–6 management checkpoints

**Links**

- ADO
- ServiceNow
- PPM
- Confluence
- Forge
- Teams
- Generic

**Management context**

- Concise note
- Lightweight decision/change history

### 10.3 Tooltips

Every important field must have contextual guidance.

Tooltip format:

- Definition
- What it is not
- Example where useful

---

## 11. Quick Capture and Creation

### 11.1 Visual creation

- Click or drag “+ Idea”
- Inline title entry
- Defaults applied
- No full modal required

### 11.2 Quick Capture

Name-only capture must be possible in seconds.

### 11.3 Command palette

Ctrl/Cmd + K supports:

- Search
- Navigate
- Create Idea
- Go to team
- Go to quarter
- Apply deterministic filters

---

## 12. Search and Filters

### 12.1 Search targets

- Commitments
- Teams
- Products/services
- People
- Themes
- Milestones
- External link labels

### 12.2 Filter chips

Examples:

- Q1 2027
- Candidate
- Mandatory
- Needs attention
- Product: Account & Cash Management
- Dependency: Security
- Theme: Resilience

### 12.3 Visual response

Default response to filtering:

- Fade irrelevant objects
- Preserve spatial context
- Avoid replacing the view unnecessarily

---

## 13. Scenario Mode

### 13.1 Entry

Scenario Mode may be entered from:

- Demand Flow
- Portfolio Map
- Capacity view

### 13.2 Defaults

- Private
- Named automatically
- Based on current baseline snapshot

### 13.3 Allowed actions

- Add candidate
- Move quarter
- Change footprint
- Change target
- Put on hold
- Drop
- Change product impact
- Adjust reserves if user has permission

### 13.4 Comparison

Compare scenario vs baseline:

- Capacity changes
- Commitment moves
- Product impact changes
- Dependency risks
- Milestone conflicts
- Attention changes

### 13.5 Apply

Applying a scenario:

- Requires Planner/Admin
- Shows consolidated diff
- Supports selective application
- Records history

---

## 14. Undo / Redo

### 14.1 Standard shortcuts

- Ctrl/Cmd + Z
- Ctrl/Cmd + Shift + Z

### 14.2 Interaction principle

Routine drag/drop changes:

- Immediate
- Reversible
- No confirmation modal

Materially cascading baseline change:

- Consequence preview before final apply

---

## 15. Presentation Mode

### 15.1 Purpose

Use Delivery Radar directly in QBR and management meetings.

### 15.2 Behavior

Presentation Mode hides:

- Editing chrome
- Setup/admin controls
- Unnecessary side panels

It preserves:

- Zoom
- Focus
- Lens switching
- Scenario exploration
- Dependency highlighting
- Capacity exploration

### 15.3 Snapshots

Named snapshots preserve:

- Lens
- Filters
- Horizon
- Scenario/baseline state
- Focus state where useful

---

## 16. History and Quarter Review

### 16.1 History view

Show:

- Quarter movement
- Capacity changes
- Lifecycle transitions
- Major dependency changes
- Significant notes/decisions

### 16.2 Quarter close

Simple review:

- Planned load
- Reserve assumptions
- Completed
- Carry-over
- Dropped
- Operational load above/about/below expected
- Capacity materially lower/about/higher than expected

### 16.3 Recommendations

Rule-based recommendation example:

> Operational reserve was exceeded in two consecutive quarters. Consider increasing the default support reserve from 15 to 20.

Must show reasoning.

---

## 17. Recurring Commitments

### 17.1 Behavior

Material recurring commitments may:

- Suggest next occurrence
- Auto-create next occurrence if workspace rule permits

Each occurrence:

- Separate commitment
- Inherits configurable defaults
- Has independent dates/capacity/history

---

## 18. Accessibility

### 18.1 Required

- Keyboard navigation
- Keyboard manipulation alternatives to drag/drop
- Screen-reader labels
- Non-colour state indicators
- Sufficient contrast
- Reduced Motion
- Table/list companion views
- Accessible dependency descriptions

### 18.2 Example

Over-capacity:

- Not only red
- Also “103% ▲ Over capacity”

Blocked dependency:

- Not only red line
- Also blocked icon/label/pattern

---

## 19. Empty States and Smart Defaults

### 19.1 First launch

- Explore Sample Workspace
- Create New Workspace

### 19.2 New workspace

Ask only:

- Workspace name
- Current quarter if not inferred

Then open the visual environment immediately.

### 19.3 Progressive setup prompts

Optional prompts:

- Add first team
- Add product/service
- Capture idea
- Import data
- Invite collaborators

No mandatory multi-step setup wizard.

---

## 20. Import / Export UX

### 20.1 Import

Guided mapping for:

- Excel
- CSV
- JSON

Preview before applying.

### 20.2 Export

Support:

- Structured data export
- Workspace package
- Meeting snapshot export later if needed

### 20.3 Restore

Named snapshot restore:

- Preview differences
- Explain object counts changed
- Confirm deliberate restore

---

## 21. Notification UX

Native desktop notifications are useful but not MVP-critical.

Eligible events:

- Attention date reached
- Owned action due
- Dependency overdue
- Material health deterioration
- Material baseline change affecting user

Notification settings:

- Urgent only
- My actions
- Portfolio warnings
- Stale items

Radar remains the source of truth.

---

## 22. UX Acceptance Criteria

The UX is successful if:

1. A new user can understand the Sample Workspace without documentation.
2. A lead can create an Idea in under one minute.
3. A Candidate can be scenario-tested by drag/drop without a form-heavy flow.
4. Capacity consequences are visible immediately.
5. The user can understand why an item appears on Radar.
6. The user can visually trace dependencies from a selected commitment.
7. A 20-team workspace remains understandable through semantic zoom.
8. The product remains usable without colour or precise mouse input.
9. Users do not need to memorise definitions because tooltips and defaults are available in context.
10. The interface never feels like a duplicated sprint/project-management system.
