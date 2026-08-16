# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

[`AGENTS.md`](AGENTS.md) is the working agreement — product boundaries, domain rules, a11y and i18n
requirements, and the definition of done. It applies in full; this file does not restate it.

[`docs/spec/`](docs/spec/README.md) is the authoritative specification. `docs/concept/` is historical
input and loses to the spec wherever they disagree. Source files cite their normative spec section in
the file header comment — follow the citation before changing behaviour.

[`docs/plan/backlog.md`](docs/plan/backlog.md) tracks what is actually done. Its status column is
honest: ✅ means acceptance criteria pass, and eight M2 rows are explicitly listed as partial with the
specific gap named. Read it before assuming a feature exists.

## Commands

```bash
pnpm install
pnpm dev            # browser target at http://localhost:5173
pnpm verify         # lint + typecheck + test + i18n:check — what CI gates on
pnpm test           # vitest (unit + property tests via fast-check)
pnpm typecheck      # turbo → tsc -b per package
pnpm lint           # boundaries, purity, and design-token rules
pnpm i18n:check     # locale parity, enum coverage, tooltip contract
pnpm format:check   # CI fails on unformatted files
pnpm test:e2e       # Playwright; starts its own dev server
pnpm build:desktop  # Tauri package; needs Rust (rustup)
```

Single test file / single test:

```bash
pnpm vitest run packages/domain/src/capacity.test.ts
pnpm vitest run packages/domain/src/capacity.test.ts -t "over capacity"
pnpm --filter @flowmap/desktop test:e2e e2e/stale.spec.ts
```

`pnpm bench` is listed in AGENTS.md but does **not** exist yet (backlog M0-SPK-7).

## Architecture

### The dependency graph is enforced, not documented

`eslint.config.js` encodes three architectural decisions as hard CI failures. When lint rejects an
import, the fix is a different design, not a disable comment.

1. **Boundaries** (`eslint-plugin-boundaries`) — `domain` and `ui` import nothing; `rules`,
   `visual-model`, `storage`, `import-export` import only `domain`; `storage-{local,file}` import
   `domain` + `storage`; `apps/**` imports everything.
2. **Purity** — `packages/domain`, `packages/rules`, `packages/visual-model` may not use React, I/O,
   `@tauri-apps/*`, `console`, `Intl`, `Math.random`, `crypto.randomUUID`, `Date.now()`, or
   `new Date()`. Time, ids, and locale are **injected** (`Clock`, `IdGenerator`), which is what makes
   every command and every rule reproducible. Tests are exempt.
3. **Tokens** — no hex, `rgb()`/`hsl()`, or `px`/`rem`/`em` literals outside `packages/ui/tokens`.
   `tokens.ts` exports `var(--…)` references; `tokens.css` holds the actual values. A token that does
   not exist yet gets added to the token set, never inlined.

### Packages export TypeScript source

Every `packages/*/package.json` points `main`/`exports` at `./src/index.ts`. Vite and Vitest resolve
source directly — there is no build step to run before tests, and no `dist` to keep in sync.
`tsc -b` (project references, `composite: true`) exists for typechecking and declaration emit only.

### One mutation model

Nothing writes to a repository directly. Every state change is:

```
component → workspace-store.dispatch(name, handler)
          → pure handler in @flowmap/domain  (state, cmd, ctx) → CommandResult
          → repository.apply({ changes, events, command })     ← one transaction
          → repository.load() → new WorkspaceState projection
```

- `packages/domain/src/command.ts` defines `Command`, `CommandEffects`, `CommandContext`, and
  `WorkspaceState` (a readonly snapshot, deliberately not a repository — a handler that cannot do I/O
  cannot depend on write ordering).
- Handlers validate in a fixed order: authorisation → payload → referential existence → invariants →
  guardrails → apply, so a failure produces no partial effects. `handler-kit.ts` holds the shared
  pieces; `diffFields()` computes `changedFields` structurally so a handler cannot forget one.
- `CommandEffects.inverse` is what powers undo. `apps/desktop/src/state/workspace-store.ts` stacks
  inverses as **steps** (one user action = one undo, however many commands), and undo re-executes each
  inverse as a normal command — an undo that has since become illegal is refused, not forced.
  `runNamed()` there maps a command name back to its handler; a new undoable command must be added to
  that switch or undo silently no-ops.
- Lifecycle moves are a data table (`lifecycle.ts` `TRANSITIONS`), not scattered `if`s. Anything
  absent from the table is rejected.

### Capacity has exactly one source of truth

`CapacityFootprint.units`. There is no stored commitment size. `packages/domain/src/capacity.ts` is
integer arithmetic throughout; utilisation is the only ratio and is `null` — never `Infinity`/`NaN` —
when there is no deliverable capacity. Adding a second source of capacity truth is a design error;
stop and ask.

### Visual model is pure, the canvas is dumb

`packages/visual-model` computes board layout, zoom levels, focus, filters, and — importantly —
**drop previews** (`placement.ts`). The pointer path, the keyboard path, and the tests all call the
same `previewDrop`/`previewResize`/`previewRemoval` functions, which is what stops them drifting
apart. `apps/desktop/src/components/` renders what those return and owns no placement logic.

### Storage: one contract, three targets

`packages/storage` defines `WorkspaceRepository` and `WorkspaceProvider`. `apply()` writes entity
changes, domain events, and outbox entries in a single transaction — deliberately no way to write one
without the others. `apps/desktop/src/runtime.ts` picks the implementation: Tauri/SQLite when
`__TAURI_INTERNALS__` is present, otherwise `MemoryWorkspaceRepository` over localStorage (a dev/demo
target, not a distribution channel). Reloading the page is a genuine restart in both.

SQL text is authored only in `packages/storage-local` — see the deviation from spec 10 §2 recorded in
`src/driver.ts`. `assertNotCloudSynced()` refuses to open a database inside OneDrive/iCloud/Dropbox;
that guard exists because a synced SQLite file opened twice corrupts silently.

Migrations are forward-only, idempotent, and checksummed (`packages/storage/src/migrations.ts`).
There is no `down`.

### i18n is a build-time contract

No user-visible literal strings anywhere — components, rules, or errors. Catalogues live in
`packages/i18n/src/locales/en/` across five namespaces (`common`, `errors`, `fields`, `patterns`,
`severity`); `apps/desktop/src/i18n/t.ts` defaults a bare key to `common.`.

`scripts/check-i18n.ts` fails CI on: a key missing from any declared locale; any value of
`DOMAIN_ERROR_CODES`, `GATE_BLOCKERS`, `GATE_ADVISORIES`, lifecycles, classes, severities, patterns
etc. without a message; a placeholder dropped or added by a translation; and any field in
`TOOLTIP_REQUIRED` missing its `.label`/`.def`/`.not` — the three-part tooltip is checked, not
trusted. Adding an enum member means adding its catalogue entry in the same change.

## Conventions that will bite you

- **Relative imports carry extensions**: `./foo.js` for TS, `./Foo.jsx` for TSX, even though the
  files are `.ts`/`.tsx`. `verbatimModuleSyntax` is on, so type imports must be `import type`.
- **`exactOptionalPropertyTypes` is on.** Optional fields are passed with conditional spreads —
  `...(x !== undefined ? { x } : {})` — throughout the store. Match that; don't pass `undefined`.
- `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noUnusedParameters` are on. Prefix intentionally
  unused bindings with `_`.
- Tests live beside their source as `*.test.ts(x)`. `vitest.config.ts` includes `packages/*/src`,
  `packages/ui/tokens`, `fixtures/src`, and `apps/desktop/src` — a test outside those globs never
  runs.
- `enable-pre-post-scripts=false` in `.npmrc` — dependency lifecycle scripts do not run, by design.
- Fixtures are deterministic (`FIXTURE_NOW`, `FixedClock`, seeded ULIDs in `packages/testing`), so a
  fixture built twice is byte-identical. Keep it that way.

## Verifying UI work

A green Vitest and Playwright run is not evidence the app works. Load the real app (`pnpm dev`) and
exercise the change — including the upgrade path from existing local data, which hermetic test setup
structurally misses.

---

An OpenAI Codex config exists at `~/.codex/`. Reply `/import` to scan and list what is importable
(MCP servers, slash commands, subagents, skills, instructions), then `/import --yes=<digest>` to
apply the user-level items.
