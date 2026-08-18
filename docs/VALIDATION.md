# Validating the Portfolio Map

What to run, what to look at, and what would count as the layout failing.

The layout in M2 implements the spec's stated grammar, but no lead has used it.
`M0-SPK-5` and `M0-SPK-6` are still open, and this is the cheapest moment to
change the layout — before M3 builds on top of it.

## Run it

### Browser — fastest, nothing to install

```bash
git checkout m2-physical-portfolio
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The app starts on an empty workspace. Open the
workspace switcher and choose **Retail Payments & Channels (sample)**, or click
**Explore sample workspace** on first run.

State lives in `localStorage`, so a reload is a genuine restart. "Clear local
data" resets it.

### Desktop — the real target

Needs Rust on `PATH`. It was installed with `--no-modify-path`, so it is not on
yours by default:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
pnpm dev:desktop        # live-reloading desktop window
```

Or open the already-built binary:

```
apps/desktop/src-tauri/target/release/flowmap
```

The desktop build stores data in SQLite under
`~/Library/Application Support/Flowmap/`, so it survives a full quit.

## The sample workspace

The same fixture the tests, benchmarks, and demos use — what you see is what CI
asserts. 5 teams, 6 quarters, 25 committed items plus 10 Ideas, with conditions
engineered in on purpose:

| What                 | Where                               | Why it is there                                      |
| -------------------- | ----------------------------------- | ---------------------------------------------------- |
| Over capacity        | Payments 2026-Q3, +13 units at 121% | A vacancy plus a regulatory item landing on one team |
| Over capacity        | Security 2026-Q3                    | A dependency hub that is itself constrained          |
| Carry-over           | Payments and Platform, 2026-Q2 → Q3 | Work that did not finish before the quarter closed   |
| Held capacity        | Card tokenisation, Payments 2027-Q1 | On hold, drawn but not consuming                     |
| Multi-team footprint | SEPA instant payments               | One commitment, two teams, same quarter              |
| Closed quarter       | 2026-Q2, every team                 | Immutable, visibly different                         |

## What to look at

Work through these in order. Each maps to something the product claims.

### 1. Can you read the landscape in about a minute?

Land on the map at **Areas** (level 2) and, without clicking anything:

- Which team is in trouble, and in which quarter?
- Roughly how much over is it?
- Which work is mandatory?

If any of those takes more than a glance, the layout is not doing its job.

### 2. Does the vessel read the way it is meant to?

Switch to **Detail** (level 3) and look at Payments 2026-Q3. It should state,
in words: the overflow (`+13 units · 121% ▲ Over capacity`), the reason the
container is small (`-10 units this quarter — One vacancy, recruitment in
progress`), and what the hatching is (`BAU & support 20 · Refinement 8 · ↻ 10
carried over`).

- Is it obvious that the hatched band at the bottom is _reserved_ and not
  available?
- Does the work that does not fit read as spilling **above** a line, rather than
  as "the cell went red"?
- Does the drawn unit scale make block heights feel measurable, or is it noise?

### 3. Does aggregation help or hide?

Switch to **Overview** (level 1). At 5 teams this is nearly free; the real
question is whether it would still work at 20.

- Can you still find the overloaded cell?
- Is losing the individual blocks a relief or a loss?

### 4. Does focus answer "where else does this land?"

Click **SEPA instant payments**. It has footprints on two teams.

- Do both light up, and does everything else recede enough to help?
- Is the connection between the two blocks obvious, or do they just look like
  two separate things?

`Esc` clears focus.

### 5. Is the Ideas lane in the right place?

Ten Ideas sit in the left lane and never occupy a capacity block.

- Does keeping them outside the grid feel right, or do you expect to see them
  provisionally placed?
- This one is worth pushing on: it is a deliberate spec decision, and the
  alternative (ghost placement before commitment) is a real design.

### 6. Keyboard only

Tab to the grid, then arrow around it.

- Does the announcement on each cell tell you enough?
- Try `1`, `2`, `3` for zoom levels.

## What would count as a failure

Say so plainly if any of these is true — they are all cheap to change now and
expensive later:

- Teams-as-rows and quarters-as-columns is the wrong way round for how you think
- The vessel metaphor does not survive contact with a real portfolio
- Level 1 aggregation hides the thing you actually scan for
- Ideas belong on the grid, not beside it
- Utilisation percent is the wrong headline number — it should be headroom, or
  absolute units, or something else

## What is deliberately not there yet

So you are not surprised by absence:

- **No detail panel.** Clicking a cell currently toggles filters — a placeholder,
  not a design (`M2-COM-2`).
- **No drag and drop.** Placement is through the form at the top (`M2-COM-5`).
- **No dependencies, products, milestones, or Radar.** The domain supports them;
  nothing renders them yet (M2 remainder and M3). So a _dependency_-caused
  bottleneck is not traceable on screen — only a capacity-caused one. An earlier
  version of this document claimed otherwise; it was wrong.
- **No Commit Gate UI.** The rules exist and are tested; the dialog does not.
- **No performance evidence.** Five teams is not twenty (`M2-MAP-9`).
