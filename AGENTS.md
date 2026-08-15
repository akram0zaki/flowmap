# AGENTS.md — working agreement

Applies to every contributor, human or agent, working in this repository.

**Flowmap** is a cross-platform desktop app that holds a management-level model of a delivery
portfolio and renders it as a manipulable visual landscape. It is not a project-management tool.

## Read first

| Before you…            | Read                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything               | [`docs/spec/README.md`](docs/spec/README.md) — index and the list of resolved contradictions                                                                                |
| Touch domain logic     | [`01-domain-model`](docs/spec/01-domain-model.md), [`02-capacity-model`](docs/spec/02-capacity-model.md), [`03-commands-permissions`](docs/spec/03-commands-permissions.md) |
| Touch rules or Radar   | [`04-rules-radar`](docs/spec/04-rules-radar.md)                                                                                                                             |
| Touch scenarios or QBR | [`05-scenarios-qbr`](docs/spec/05-scenarios-qbr.md)                                                                                                                         |
| Touch UI               | [`06-views-interaction`](docs/spec/06-views-interaction.md) + [`docs/design/design-system.md`](docs/design/design-system.md)                                                |
| Touch storage or sync  | [`07-persistence-sync`](docs/spec/07-persistence-sync.md), [`08-providers`](docs/spec/08-providers.md)                                                                      |
| Pick up work           | [`docs/plan/execution-plan.md`](docs/plan/execution-plan.md), [`docs/plan/backlog.md`](docs/plan/backlog.md)                                                                |

`docs/concept/` is the original product pack. It is historical input, **not** authoritative. Where it
disagrees with `docs/spec/`, the spec wins — the disagreements are listed explicitly in the spec's
README.

## Rules

### Working style

- Follow existing codebase patterns and conventions. Match the surrounding file's structure, naming,
  and idiom rather than introducing a new style alongside it.
- Respect the design system and tokens. No raw hex, `rgb()`, `px` literals, or font stacks outside
  `packages/ui/tokens` — ESLint enforces this, and a token that does not exist yet should be added to
  the token set rather than inlined.
- **Don't make assumptions. Ask when there is a gap or a doubt.** A wrong guess about capacity
  semantics, lifecycle rules, or permission boundaries is expensive to unwind. If the spec does not
  answer it, ask before implementing — do not invent an answer and move on.
- **Clearly outline any open ends, assumptions, or judgement calls you made, for review afterwards.**
  Put them in the PR description under `## Open questions` and `## Decisions taken`. An empty list is
  a valid answer; a missing list is not.
- Prefer deleting to adding. This product's biggest risk is becoming the project-management tool it
  exists to avoid.

### Product boundaries — reject, don't defer

Anything that answers _"how do we manage sprint execution / track every task / calculate individual
utilisation / calculate percent complete / replace ServiceNow / make everyone update this"_ is out of
scope by construction. So is **any AI or LLM feature** — all guidance is deterministic, rule-based,
and explainable.

Prefer features that answer: _what is happening · what needs attention · can we take this · what
moves if we do · where is the bottleneck · where does change land · what did we learn._

### Domain and correctness

- **All state changes go through a command.** Nothing writes to the repository directly. UI edits,
  undo, scenarios, import, sync, and restore all use the same command handlers.
- **Capacity comes only from `CapacityFootprint.units`.** There is no stored commitment size. If you
  find yourself adding a second source of capacity truth, stop and ask.
- **A scenario must never mutate baseline state before an explicit apply.** This is enforced by
  branded types and by property tests. Do not weaken either.
- `packages/domain`, `packages/rules`, and `packages/visual-model` are **pure**: no React, no I/O, no
  `Date.now()`, no `Math.random()`, no `console`. Time, ids, and locale are injected.
- Every rule returns structured facts, thresholds, and actions. Rule prose lives in the i18n
  catalogue, never in a component.

### UI and accessibility

- **Every visual interaction needs a keyboard equivalent and a list/table companion.** A drag with no
  keyboard path does not ship.
- **No state is communicated by colour alone**, ever. Icon + pattern + text, with hue as the last
  channel.
- Target WCAG 2.2 AA. Interactive targets ≥ 24 × 24 px (44 × 44 px for primary and draggable
  canvas objects). Focus is always visible and never clipped.
- The shell is fluid down to 1024 × 640 with **no clipped content, no overflow, and no horizontal
  page scroll**. Wide content (tables, timelines, dependency graphs) scrolls inside its own region —
  the shell never scrolls.
- Respect `prefers-reduced-motion` and the in-app override. No state cue may depend on motion.
- Every new domain concept gets the three-part tooltip: definition · what it is not · example.

### Text and i18n

- **All new labels and text must have i18n keys with entries in every supported locale.** No literal
  user-visible strings in components, rules, or errors. A missing key in a declared locale fails CI.
  (`SUPPORTED_LOCALES` currently declares `en` only — the machinery is still mandatory.)
- Sentence case. Active voice. Actions keep the same name through the whole flow: the button says
  _Commit_, the toast says _Committed_, the history entry says _Committed_.
- Errors state what happened and how to fix it. They do not apologise and are never vague.
- Use the glossary in [`docs/spec/00-overview.md §6`](docs/spec/00-overview.md). Synonyms are bugs —
  they cause exactly the local-meaning drift this product exists to prevent.

### Data and migrations

- **All DB migrations must be idempotent.** Re-running an applied migration is a no-op:
  `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` guarded by a `pragma_table_info` check, backfills
  written as `UPDATE … WHERE <not yet backfilled>`. Migrations are forward-only, run inside a single
  transaction, and are preceded by a recovery backup.
- SQLite is a **local cache only**. It is never shared, never placed in a synced folder, never opened
  by two machines.
- Never store credentials, tokens, customer data, incident detail, or vulnerability information.
  Tokens live in the OS keychain and never in the database, logs, or exports.

### Testing

- **Any meaningful change must be covered by unit tests.** A command without its negative-path test,
  or a rule without a firing and a non-firing fixture, is incomplete.
- Add a property test whenever a change introduces or touches an invariant
  ([`11-quality-performance §3`](docs/spec/11-quality-performance.md)).
- Changes to the map, timeline, dependency graph, or rules must be checked against the performance
  budgets before merge.

## Definition of done

- [ ] Matches the spec section it implements (link it in the PR)
- [ ] Command path, keyboard path, and list-companion path all work
- [ ] Positive and negative tests; invariants added where introduced
- [ ] i18n keys present in every supported locale
- [ ] `axe` clean; focus order and announcements verified
- [ ] Error, empty, loading, offline, and conflict states designed and implemented
- [ ] Tooltip added for any new domain concept
- [ ] Migration impact assessed; any migration is idempotent and tested
- [ ] Performance budget checked where relevant
- [ ] Design tokens used throughout
- [ ] `## Open questions` and `## Decisions taken` filled in on the PR

## Commands

```bash
pnpm install
pnpm dev            # desktop app in development
pnpm test           # unit + property tests
pnpm test:e2e       # Playwright workflows (also runs axe)
pnpm lint           # eslint + boundary rules + token rules
pnpm typecheck
pnpm bench          # performance budgets against the scale fixtures
pnpm build:desktop  # Tauri packages for the current platform
```

Not yet scaffolded — see [`docs/plan/execution-plan.md`](docs/plan/execution-plan.md) M1.
