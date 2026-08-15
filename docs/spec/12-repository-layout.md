# 12 — Repository & Code Layout

## 1. Structure

```
flowmap/
├── AGENTS.md                       # working agreement for humans and agents
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json              # strict; project references
├── turbo.json                      # task graph (build, test, lint, bench)
│
├── apps/
│   └── desktop/
│       ├── src/                    # React application
│       │   ├── app/                # shell, routing, providers, error boundaries
│       │   ├── views/              # portfolio, radar, demand-flow, timeline,
│       │   │                       # dependencies, products, history, settings
│       │   ├── features/           # commitment-detail, commit-gate, scenario-compare,
│       │   │                       # quarter-close, import-wizard, conflict-resolver
│       │   ├── canvas/             # SVG rendering primitives, layout, hit-testing, zoom
│       │   ├── state/              # zustand stores: selection, focus, filters, view, undo
│       │   ├── ipc/                # typed Tauri bridge (Zod-validated both ways)
│       │   └── i18n/               # locale catalogues
│       ├── src-tauri/              # Rust: db, files, secrets, auth, notify, http
│       └── e2e/                    # Playwright specs + fixtures
│
├── packages/
│   ├── domain/                     # entities, commands, invariants, projections   [pure]
│   ├── rules/                      # rule catalogue, evaluation, explanations      [pure]
│   ├── visual-model/               # layout-neutral view models, selection, focus  [pure]
│   ├── storage/                    # repository + provider contracts, migrations, contract tests
│   ├── storage-local/              # SQLite repository, outbox, sync engine
│   ├── storage-file/               # versioned shared-document provider
│   ├── storage-sharepoint/         # Graph/Lists provider (added after spike approval)
│   ├── import-export/              # parsers, mapping, validation, .flowmap package
│   ├── ui/                         # design tokens + accessible primitives
│   └── testing/                    # fixture builders, fake clock, fake provider, matchers
│
├── fixtures/
│   ├── validation/                 # the canonical 5-team fixture
│   ├── scale/{25,100,500}/
│   ├── edge/
│   └── import/
│
├── docs/
│   ├── concept/                    # original product pack (historical input)
│   ├── spec/                       # this specification (authoritative)
│   ├── design/                     # design system + tokens
│   ├── plan/                       # execution plan + backlog
│   └── adr/                        # architecture decision records
│
├── bench/                          # benchmark harness + committed results
└── scripts/                        # codegen, fixture generation, provisioning
```

## 2. Dependency rules (enforced, not aspirational)

```
apps/desktop  →  ui, visual-model, domain, rules, storage, import-export
storage-*     →  storage, domain
import-export →  domain
visual-model  →  domain
rules         →  domain
domain        →  (nothing)
ui            →  (nothing but tokens)
```

Enforced by `eslint-plugin-boundaries` plus TypeScript project references. Violations fail CI.

Additional hard rules in `domain`, `rules`, and `visual-model`:

- No `react`, `react-dom`, or any DOM type.
- No `fs`, `net`, `http`, or Tauri API.
- No `Date.now()`, `new Date()` without an argument, `Math.random()`, `crypto.randomUUID()`, or
  `Intl` formatting — time, identity, and locale are injected.
- No `console.*` — diagnostics are returned, not printed.

These are ESLint `no-restricted-*` rules with explanatory messages, not conventions.

## 3. Toolchain and conventions

- **pnpm** workspace, Node 22 LTS, TypeScript 5.x `strict` with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- **Three run targets**, one codebase:

  | Target          | Command                                   | Purpose                                                                                     |
  | --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
  | Desktop (Tauri) | `pnpm dev:desktop` / `pnpm build:desktop` | The product. Full provider, keychain, notifications                                         |
  | Browser         | `pnpm dev`                                | Fast development and Playwright. In-memory or WASM-SQLite repository, Local provider only   |
  | Docker          | `docker compose up`                       | Demo and review environments. Serves the browser target with the sample workspace preloaded |

  Browser and Docker are **development and demo targets, not distribution channels** — shared
  storage and OS-secure token storage exist only in the desktop shell. The IPC bridge is behind an
  interface so the browser target substitutes an in-process implementation without any change above
  it.

- **Vite** for the app; **Turborepo** for the task graph and caching.
- **Zod** schemas colocated with types, exported as `<Type>Schema`, used at every trust boundary.
- **Zustand** for transient view state (selection, focus, filters, zoom, undo stack). Domain state
  lives in the projection store, not in Zustand.
- **TanStack Query** only at the asynchronous repository/provider boundary.
- **React Hook Form** for detail and configuration forms only — never for the primary board
  interactions, which are direct manipulation.
- **ELK** in a worker for dependency-map layout; **React Flow** or **Cytoscape** chosen by the
  measured Phase-0 spike, isolated behind a `GraphRenderer` interface either way.
- Conventional Commits; PR template requires the spec section link, the open-questions list, and the
  done-checklist from [11 §8](11-quality-performance.md#8-definition-of-done).

## 4. Internationalisation

- Every user-visible string is an i18n key. No literal strings in components, rule outputs, or error
  messages.
- Catalogue: `apps/desktop/src/i18n/<locale>/*.json`, namespaced by area
  (`common`, `portfolio`, `radar`, `rules`, `errors`, `settings`, `tooltips`).
- Supported locales are declared in one place (`SUPPORTED_LOCALES`). The Pilot MVP ships **`en`
  only** — but the machinery is real from day one, and a missing key in any declared locale fails
  CI.
- Rule messages, error messages, tooltips, and accessibility announcements all go through the same
  catalogue, with typed parameter interpolation.
- Dates, numbers, and units format through an injected formatter bound to the workspace timezone and
  the app locale — never through ad-hoc `toLocaleString` calls in components.

## 5. Architecture decision records

`docs/adr/NNNN-title.md`, one per decision that constrains future work. The initial set, to be
written in Phase 0/1:

| ADR  | Subject                                                           |
| ---- | ----------------------------------------------------------------- |
| 0001 | Three release gates rather than one MVP                           |
| 0002 | Command-based mutation model (not event sourcing)                 |
| 0003 | Footprint units as the sole capacity source of truth              |
| 0004 | Scenario as a replayable command overlay                          |
| 0005 | Capability-aware provider contract; SQLite is local-only          |
| 0006 | Tauri as the desktop shell (with the Electron fallback condition) |
| 0007 | SVG/DOM rendering before Canvas/WebGL                             |
| 0008 | Deferring local cache encryption, with compensating controls      |
| 0009 | Deterministic rules only; no scripting, no AI                     |
| 0010 | Graph library selection for the Dependency Map                    |
