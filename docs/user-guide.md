# Flowmap user guide

Flowmap is a landscape of your delivery portfolio. It shows which work sits on
which team in which quarter, how full those teams are, and what needs a look.

It is not a task board, a sprint tracker, or a replacement for Azure DevOps,
Jira, or ServiceNow. Those systems stay the system of record. Flowmap holds
management-level commitments and links out to the detail.

This guide matches the current app. Read it top to bottom the first time, then
jump to a task when you need it.

## Contents

1. [Start here](#1-start-here)
2. [Tour of the screen](#2-tour-of-the-screen)
3. [Words that matter](#3-words-that-matter)
4. [Read the map](#4-read-the-map)
5. [Everyday tasks](#5-everyday-tasks)
6. [Other views](#6-other-views)
7. [Radar and rules](#7-radar-and-rules)
8. [Try a change before you commit](#8-try-a-change-before-you-commit)
9. [Workspaces and files](#9-workspaces-and-files)
10. [Keyboard](#10-keyboard)
11. [What Flowmap will not do](#11-what-flowmap-will-not-do)

---

## 1. Start here

Open Flowmap. On first launch you get an empty personal workspace and a short
welcome.

- **Explore sample workspace** opens a filled-in retail-payments portfolio. Use
  this to learn the map. Switching to it does not overwrite your empty
  workspace.
- **Start empty** keeps the blank workspace so you can build your own.

The sample stays in the workspace switcher at the top of the window. You can
move between your workspace and the sample at any time. On the sample, **Reset
sample workspace** puts the demo data back without touching anything else.

To run the development app from this repository:

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173. The packaged desktop app works the same way;
it just lives in a folder you unzip, with no installer.

---

## 2. Tour of the screen

```
┌─ Flowmap   [Workspace ▾]   [Import and export] [Saved views] [Snapshots]  [☀] [Settings] [Sync] ─┐
├─ 1 Portfolio  2 Teams  3 Products  …  7 QBR  8 Timeline  History          filters             ┤
├─ Planning context: Baseline                                              [New scenario]        ┤
├─ Undo  Redo  List                                        [Radar 12] [Rules]                    ┤
├─ Add and place work ▾                                                                              ┤
├──────────────┬─────────────────────────────────────────────────────────────────────────────────┤
│ Ideas        │  2026-Q3          2026-Q4          2027-Q1                                      │
│              │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                              │
│  ○ New idea  │ │ Payments     │ │ 120% ▲       │ │              │                              │
│              │ └──────────────┘ └──────────────┘ └──────────────┘                              │
│              │                                                                                 │
│              │                              [ Overview | Areas | Detail ]                      │
└──────────────┴─────────────────────────────────────────────────────────────────────────────────┘
└─ List: every footprint, with the same totals as the map ────────────────────────────────────────┘
```

| Area                           | What it is                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Brand and workspace**        | Top left. Switch, create, or archive a workspace. Independent menus, not a breadcrumb.                                       |
| **Workspace tools**            | Import and export, saved views, snapshots.                                                                                   |
| **Appearance, Settings, Sync** | Theme, data location, and whether a shared file is pending or in conflict. Your self-declared name sits here too.            |
| **Lenses**                     | Different ways to look at the same portfolio. Number keys `1`–`8` switch them.                                               |
| **Planning context**           | Baseline is the agreed plan. A scenario is a private draft on top of it.                                                     |
| **Undo, Redo, List**           | Every change is undoable. List is the table twin of the map.                                                                 |
| **Radar and Rules**            | Attention signals, and the thresholds behind them. Only one of these sheets is open at a time.                               |
| **Add and place work**         | Fold-out forms to add a team, capture an Idea, place it, or record work that is already real.                                |
| **Ideas lane**                 | Uncommitted demand, pinned on the left. Ideas are not on the grid yet.                                                       |
| **The grid**                   | Quarters run left to right. Teams are rows. Blocks sit inside a team-quarter.                                                |
| **Zoom dock**                  | Floats at the bottom of the window: Overview, Areas, Detail. It stays on the team you are looking at when the level changes. |
| **Detail panel**               | Opens when you select a commitment. Identity, planning, outcome, impact, attention, dependencies, milestones, links.         |
| **List**                       | A table of every capacity footprint. Its totals match the map exactly.                                                       |

---

## 3. Words that matter

Flowmap uses these words on purpose. Treating them as synonyms of project-management terms is how
portfolios drift.

| You will see           | It means                                                                 | It is not                                                      |
| ---------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **Commitment**         | Work big enough to consume capacity or need a management decision        | A story, task, or ticket                                       |
| **Idea**               | Demand that is not yet accepted onto a team                              | A backlog item waiting to be estimated                         |
| **Commit Gate**        | The act of accepting an Idea into the plan                               | An approval workflow                                           |
| **Capacity footprint** | How much of one team, in one quarter, this work occupies                 | Hours, story points, or money                                  |
| **Unit**               | A relative slice of a team-quarter. A normal quarter is **100 units**    | A person-day                                                   |
| **Reserve**            | Capacity set aside before delivery work (support, refinement, and so on) | A hidden buffer you should fill                                |
| **Headroom**           | Deliverable capacity minus counted load. Negative means overflow         | Slack you are expected to use up                               |
| **Overflow**           | More is committed than the team can hold. Allowed, and drawn in the open | A blocked save or a failed state                               |
| **Radar**              | Signals that need a human look now                                       | A list of all work                                             |
| **Scenario**           | A draft of “what if we did this”                                         | A branch of the data. Baseline does not change until you apply |
| **Lens**               | A different emphasis on the same model                                   | A second copy of the portfolio                                 |

Every important field has a **?** next to the label. It always answers three things: what it is,
what it is not, and an example.

---

## 4. Read the map

**Columns are quarters. Rows are teams.** The current quarter is marked **now**.

Inside a cell, from the bottom up:

1. A **hatched band** is reserved capacity (support, refinement, holds).
2. **Blocks** are commitments. Taller means more units. Mandatory work stacks first.
3. A **cross-hatched** block was carried over from an earlier quarter.
4. Anything that **spills above the cell** is overflow. The label always shows units _and_
   percent, with an ▲. Colour is never the only cue.

### Zoom levels

Use the dock at the bottom of the window, `+` / `−`, or Ctrl/Cmd + scroll.

| Control      | Shows                                               | Hides             |
| ------------ | --------------------------------------------------- | ----------------- |
| **Overview** | One pressure bar per team-quarter, counts, overflow | Individual blocks |
| **Areas**    | Blocks, reserves, capacity numbers                  | Fine labels       |
| **Detail**   | Names, milestones, dependencies, the full cell      | Nothing           |

Changing level keeps the team-quarter you are looking at on screen.

### Focus

Click a commitment (or press Space on it). Related footprints, products, and dependencies stay
sharp; everything else fades. Escape clears focus.

### The list

**List** (or Ctrl/Cmd + L) opens the table under the map. Use it when you want exact numbers.
If the list and the map ever disagreed, that would be a bug — they share one calculation.

---

## 5. Everyday tasks

### Add a team

1. Open **Add and place work**.
2. Type a team name (for example `Payments`).
3. Add the team.

Rows stay in the order you set. Use ↑ / ↓ on a row header to reorder them. Pressure never
reshuffles the map.

### Capture an Idea

An Idea is a title only. Everything else comes later.

- Open **Add and place work**, type a name, click **Capture idea**.
- Or open the command palette (`Ctrl/Cmd + K`) and type `+ idea SEPA instant payments`.

The Idea appears in the left lane. It consumes no capacity yet.

### Place work on a team and quarter

**From the forms**

1. Open **Add and place work**.
2. Choose the Idea, the team, and a size (`XS` `S` `M` `L`).
3. **Place**. Units are resolved once from the workspace size map and then frozen.

**From the lane**

1. Pick an Idea up (press and hold, or focus it and press Space).
2. Drop it on a team-quarter.
3. The cell preview tells you what utilisation would become, and whether the drop is allowed.

**Work that is already happening**

Use **Capture and commit** in the same fold-out: name, team, units. It lands as Committed in the
current quarter. Use this for mid-quarter work that is already real, not for exploring an Idea.

Default sizes: XS = 5, S = 10, M = 20, L = 35 units. **XL** has no default — enter units
explicitly. Changing the size map later does not rewrite work already placed.

### Inspect and edit a commitment

Click a block. The detail panel opens on the right.

Fill in only what you have. Empty sections offer **Add…** rather than a blank form. Typical
order: identity (lifecycle, class, owner, primary team) → planning (target quarter, footprints,
confidence) → outcome → product impact → attention → dependencies → milestones → links.

Lifecycle moves through a fixed table. Illegal moves are refused with a reason. You cannot
invent a new state.

### Move or resize a block

- Drag a block to another team or quarter.
- Focus a block and press Space to pick it up, arrow to a cell, Enter to drop, Esc to cancel.
- Drag a block’s edge to change its units.
- Undo (`Ctrl/Cmd + Z`) reverses the whole action, not a half-finished drag.

If the move would overflow a team-quarter, it still succeeds for a Planner. The overflow is
shown, not blocked.

### Filter the board

- Click a team or quarter header to pin a filter chip.
- Use the command palette: `filter: quarter 2026-Q3`.
- Chips sit in the strip under the lenses. Remove one chip, or clear all.

By default, filtered-out work **fades** so you keep your place on the map. Turn on hide only
when you want it gone.

---

## 6. Other views

Lenses change emphasis, not data. Selection and filters carry across where the view can show
them.

| Key | Lens             | Use it to answer                                                           |
| --- | ---------------- | -------------------------------------------------------------------------- |
| `1` | **Portfolio**    | What is committed, where does it sit, what can we move?                    |
| `2` | **Teams**        | How loaded is each team across the horizon? Where is the pressure?         |
| `3` | **Products**     | Where does the change land? (Change load, not team capacity.)              |
| `4` | **Themes**       | Which commitments share a direction?                                       |
| `5` | **Attention**    | What needs a human look now? Grouped by reason, not by name.               |
| `6` | **Dependencies** | What is waiting on what? Where are the hubs and cycles?                    |
| `7` | **QBR**          | The next three quarters. A dropdown switches Capacity, Demand, and Review. |
| `8` | **Timeline**     | How do footprints line up across quarters? (Not a Gantt chart.)            |
| —   | **History**      | What changed, and close or reopen a quarter.                               |

**Teams** is a pressure grid, not another copy of the map. Each cell is load against
deliverable capacity. The footer is portfolio pressure for that quarter. **Open on the
Portfolio map** jumps to that team-quarter.

**Products** states the contrast in the header: team capacity answers “can we deliver it”;
change load answers “where does the change land”.

**Timeline** draws one fragment per footprint. Fragments of the same commitment are one piece
of work, not duplicates. There is no percent-complete and no critical path.

**QBR** opens on the Capacity map (current quarter plus two). The **QBR view** dropdown
switches Capacity, Demand (Ideas → pipe → Commit Gate), and Review (quarter close).

**Attention** is Radar’s list as a full view. **Open** jumps to the matching cell on the
Portfolio map.

---

## 7. Radar and rules

**Radar** is the “what needs a look” list. It is not every commitment.

1. Click **Radar**. The count on the button is the number of live signals.
2. Signals are grouped (action now, this week, capacity, dependencies, ownership, and so on).
3. Open a signal to read the rule, the facts it used, and the threshold.
4. **Open** jumps to the matching cell on the map — the team _and_ the quarter, not just the
   column.
5. Review it, or defer it until tomorrow / next week / next month. A deferred signal comes
   back sooner if the situation gets worse.

Switch **Mine** / **Portfolio** to see only items assigned to you, or the whole workspace.

**Rules** is a toggle next to Radar. They cannot both be open. Rules are deterministic: you
can change a threshold or silence an advisory rule, and you can see how many are firing.
Nothing here is learned or scored. Reset one rule, or reset all, to go back to the defaults.

---

## 8. Try a change before you commit

### Scenarios

1. Click **New scenario**. You are now looking at a draft. The baseline is untouched.
2. Place or move work as usual. Ghost blocks are dashed and labelled **Scenario**.
3. The dock shows what would change: teams, quarters, units moved, new overflows.
4. **Apply scenario** writes the draft into the baseline, takes a snapshot, and clears undo.
   You can apply every change, or only the ones you tick.
5. **Discard** throws the draft away. **Share** marks it for review. **Clone** copies it.

If someone else changes the baseline while your draft is open, **Rebase** asks you to keep
yours, take theirs, or edit the overlap. A scenario never writes the baseline by itself.

### Demand Flow

On the QBR lens, switch **QBR view** to **Demand**. That is the “can we take this?” pipe.

1. Create and select a scenario first.
2. Choose an Idea, a team, a quarter, and units.
3. Place a ghost footprint. The cell shows the consequence.
4. The Idea stays an Idea until you apply the scenario (or pass Commit Gate on the baseline).

Switch the dropdown back to **Capacity** to see the QBR map again.

---

## 9. Workspaces and files

### Switch or create a workspace

Open the workspace name in the header.

- Click another workspace to switch. The one you left is unchanged.
- **New workspace** asks for a name and a location:
  - **This computer** — local cache only, for one machine.
  - **Shared file** — a `.flowmap` file you put in a shared folder. Changes appear for others
    after each save, and may take a few minutes to propagate.
- You can archive a workspace you created once another personal one exists. The sample cannot
  be archived.

### Import and export

**Import and export** in the header.

- Export this view, the Radar, workspace data, a quarter review, or the whole workspace.
- Import CSV, JSON, or XLSX. Flowmap always shows a preview (creates, updates, possible
  duplicates, errors) and never merges names silently.
- Exports are plain-text management data. Store them as you would any other portfolio file.

### Snapshots and saved views

- **Snapshots** are restorable copies of the workspace. Restore asks you to confirm a diff.
- **Saved views** remember a lens and its filters. They do not change data and they do not
  restore history.

### Settings

**Settings** shows where data lives, whether this copy is portable, and **Clear local data**.

Clearing local data wipes the cache for the current workspace and reloads empty. Export a
`.flowmap` file first if you need the work.

Roles (Viewer, Contributor, Planner, Admin) stop accidents. They are not a login. Access to a
shared file is whoever can open that folder.

---

## 10. Keyboard

Press `?` any time for the in-app list.

**Everywhere**

| Keys                         | Does                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| `Ctrl/Cmd + K`               | Command palette — search, `+ idea …`, `filter: quarter 2026-Q3` |
| `Ctrl/Cmd + L`               | Toggle the list                                                 |
| `Ctrl/Cmd + Z` / `Shift + Z` | Undo / redo                                                     |
| `Ctrl/Cmd + ,`               | Settings                                                        |
| `1` … `8`                    | Switch lens                                                     |
| `?`                          | This shortcut list                                              |
| `Esc`                        | Clear focus, cancel a mode, leave presentation                  |

**On the map and in Demand Flow**

| Keys            | Does                                                      |
| --------------- | --------------------------------------------------------- |
| Arrow keys      | Move between cells                                        |
| `Enter`         | Open the focused cell, or drop what you are carrying      |
| `Space`         | Pick up the focused Idea or block                         |
| `+` / `−`       | Zoom                                                      |
| `m` then arrows | In Demand Flow, choose a team-quarter without the pointer |

The palette does not interpret natural language. If there is no exact local match, it says so.

---

## 11. What Flowmap will not do

By design, not “not yet”:

- Track tasks, sprints, timesheets, or percent complete
- Plan named people or skills
- Draw a Gantt chart or a critical path
- Host documents, chat, or approvals
- Call an AI model. Radar and rules are deterministic and explainable
- Connect to Jira or ServiceNow as a live sync. Links are typed HTTPS addresses, nothing more

If you find yourself asking “how do we make everyone update this?”, you are in the wrong tool.

A useful session in Flowmap usually ends with one of: we can take this, we cannot, this team
is the bottleneck, this is what moves if we do, this is what needs a look before Friday.
