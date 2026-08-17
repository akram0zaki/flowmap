# Flowmap

Flowmap is a visual portfolio control app for leaders who need to understand the current state of a delivery portfolio, the pressure on teams, and the consequences of adding or changing demand.

This repository is the live project home for Flowmap: https://github.com/akram0zaki/flowmap

Flowmap is designed to help answer questions like:

- What is happening across the portfolio right now?
- What needs attention immediately?
- Can we accept this new demand?
- What moves if we do?
- Where are the bottlenecks?
- Where will the change land?
- What did we learn in the last planning cycle?

It is not a project-management tool. It does not replace Azure DevOps, ServiceNow, PPM, Jira, Confluence, Forge, or Teams. Instead, it links to those systems and gives leaders a higher-level operating model for capacity, risk, dependency load, and portfolio decisions.

## What Flowmap is for

Flowmap gives portfolio and engineering leads a single view of how work is distributed across teams, products, and delivery horizons. It is built to make trade-offs visible before they become surprises.

Typical use cases include:

- Portfolio health reviews and QBR preparation
- Capacity planning across quarters and planning windows
- Demand intake and prioritisation decisions
- Dependency tracking and bottleneck visibility
- Scenario analysis to compare change impacts before committing
- Explainable, rule-based decision support instead of opaque AI summaries

## Key features

- Portfolio view of commitments, dependencies, and delivery exposure
- Capacity and planning model across time horizons
- Rule-based radar and signal analysis for bottlenecks and risk
- Scenario overlays for comparing alternative portfolio decisions
- Commit and gating concepts to keep planning decisions explicit
- Local-first desktop-first workflow with portable workspace data
- Deterministic logic and explainable rules rather than hidden heuristics
- Accessibility-conscious interaction patterns and design-system-driven UI

## Current status

Flowmap is an active implementation project in the early-to-mid development stage. The product specification is complete and approved, and the engineering work is progressing through the implementation plan and backlog.

For the exact implementation status, see:

- [docs/spec/README.md](docs/spec/README.md)
- [docs/plan/execution-plan.md](docs/plan/execution-plan.md)
- [docs/plan/backlog.md](docs/plan/backlog.md)

## Repository layout

```text
apps/           desktop application and runtime
packages/       domain, rules, storage, UI, i18n, testing, and visual-model packages
fixtures/       canonical validation and planning fixtures
scripts/        repo validation and tooling
docs/           product specification, design, and planning docs
```

The specification is the authoritative product source, especially:

- [docs/spec/00-overview.md](docs/spec/00-overview.md)
- [docs/spec/01-domain-model.md](docs/spec/01-domain-model.md)
- [docs/spec/02-capacity-model.md](docs/spec/02-capacity-model.md)
- [docs/spec/04-rules-radar.md](docs/spec/04-rules-radar.md)
- [docs/spec/05-scenarios-qbr.md](docs/spec/05-scenarios-qbr.md)

## Cloning the project

Requirements:

- Node.js 22 or newer
- pnpm
- Optional: Rust and Tauri tooling for the desktop build target

Clone and install:

```bash
git clone https://github.com/akram0zaki/flowmap.git
cd flowmap
pnpm install
```

## Running Flowmap

Start the browser-based development app:

```bash
pnpm dev
```

This runs the desktop shell target in development mode and is typically served at:

- http://localhost:5173

For the desktop app build workflow, install Rust first if needed and then run:

```bash
pnpm build:desktop
pnpm package:portable                 # unzip-and-run ZIP for this platform
pnpm package:portable -- --universal  # macOS universal
pnpm package:portable -- --standalone # Windows + bundled WebView2
```

Or run the Tauri desktop app directly:

```bash
pnpm dev:desktop
```

Distribution, rollback, and the managed-device unzip-and-run checklist live in [`docs/ops/`](docs/ops/distribution.md).

## Common verification commands

```bash
pnpm test          # unit and property tests
pnpm lint          # boundaries, purity, and token rules
pnpm typecheck
pnpm i18n:check    # locale and catalogue checks
pnpm verify        # lint + typecheck + test + i18n checks
pnpm test:e2e      # browser-based workflow and accessibility checks
```

## How to use it

The product is designed around a simple planning loop:

1. Import or model portfolio commitments and dependencies.
2. Review current portfolio state, load, and signals.
3. Identify blockers, exposure, and overdue decisions.
4. Test a scenario or change request before acceptance.
5. Compare trade-offs and understand capacity impact.
6. Commit to a path and review the resulting portfolio state.

The core idea is not to manage every task in detail, but to help decision-makers answer, with evidence, what is changing, what is constrained, and which choices create the least disruption.

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. It documents the working agreement, product boundaries, engineering rules, and completion requirements.

If you want to help with implementation, the best place to start is the design and spec docs, then the current backlog:

- [docs/spec/README.md](docs/spec/README.md)
- [docs/design/design-system.md](docs/design/design-system.md)
- [docs/plan/backlog.md](docs/plan/backlog.md)

## License and project home

Project repository:

- https://github.com/akram0zaki/flowmap

This project is currently under active development and is evolving with the product specification and implementation roadmap.
