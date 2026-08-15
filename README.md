# Flowmap

Visual portfolio control for leads coordinating multiple teams, products and services,
commitments, dependencies, and planning horizons across disparate enterprise systems.

Flowmap answers seven questions and nothing else:

1. What is happening across my portfolio?
2. What needs attention now?
3. Can we accept this new demand?
4. What moves if we do?
5. Where are the bottlenecks?
6. Where does the change land?
7. What did we learn last quarter?

It is **not** a project-management tool. It references Azure DevOps, ServiceNow, PPM, Confluence,
Forge, and Teams by link and never replicates them. There is no AI anywhere in it — all guidance is
deterministic, rule-based, and explainable.

## Status

Early. The specification is complete and approved; implementation is at **M1 — walking skeleton**.

| Area                         | State                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| Specification                | ✅ Complete — [`docs/spec/`](docs/spec/README.md)                                             |
| Design system and tokens     | ✅ [`docs/design/`](docs/design/design-system.md), [`packages/ui/tokens`](packages/ui/tokens) |
| Execution plan and backlog   | ✅ [`docs/plan/`](docs/plan/execution-plan.md)                                                |
| Quarters, capacity model     | ✅ Implemented and property-tested                                                            |
| Validation fixture           | ✅ 35 commitments, 30 dependencies, 2 engineered overloads                                    |
| Commands, rules, storage, UI | ⬜ Not started — see the [backlog](docs/plan/backlog.md)                                      |

## Getting started

```bash
pnpm install
pnpm verify        # lint + typecheck + test + i18n contract
pnpm dev           # browser target at http://localhost:5173
```

The desktop target additionally needs Rust (`rustup`), then:

```bash
pnpm build:desktop
```

Individually:

```bash
pnpm test          # unit and property tests
pnpm lint          # boundaries, purity, and design-token rules
pnpm typecheck
pnpm i18n:check    # locale parity and enum coverage
pnpm test:e2e      # Playwright workflows, axe on every page state
```

## Layout

```
docs/spec/      the authoritative specification (start at README.md)
docs/design/    design system — "measured drawing"
docs/plan/      execution plan and ticket-level backlog
docs/concept/   the original product pack; historical input, not authoritative
packages/       domain · rules · visual-model · storage* · ui · i18n · testing
fixtures/       the canonical validation fixture
```

Package boundaries, purity rules, and the design-token rule are enforced by ESLint, not by
convention. `packages/domain`, `packages/rules`, and `packages/visual-model` are pure: no React, no
I/O, and no ambient time, ids, or locale — those are injected, which is what makes every command and
every rule reproducible.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. It carries the working agreement, the product boundaries, and
the definition of done.
