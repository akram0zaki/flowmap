# 09 — Import, Export, Portability & Snapshots

## 1. Import

Supported formats: **XLSX**, **CSV**, **JSON**. Excel is import/export only — it is never a
persistence format.

### 1.1 Pipeline

```
Choose file → Detect sheets/columns → Map to entities → Validate → Preview → Apply (transaction)
```

Every stage is reversible until Apply. Apply is a single command batch: **all rows or none**.

### 1.2 Importable entities

Teams · Products/Services · People · Commitments · Capacity footprints · Dependencies · Milestones ·
Themes · External links · Team-quarter capacity and reserves.

Not importable: scenarios, snapshots, history, signal dispositions, workspace users/roles.

### 1.3 Mapping

- The mapper proposes column→field matches by header name, shows confidence, and lets the user
  correct every one. Mappings are savable and reusable per workspace.
- Enum columns (`lifecycle`, `class`, `importance`, impact type, dependency type, size) map through
  an editable value table; unmapped values are listed as errors, never guessed.
- Relative sizes resolve to units through the workspace mapping at import time; `XL` rows require an
  explicit units column or they fail validation.
- Quarter columns accept `2026-Q4`, `Q4 2026`, `2026Q4`, and ISO dates (which derive the quarter).

### 1.4 Identity and duplicates

Updating an existing record **requires a stable external key**.

```
externalKey: string   // per-entity-type column, e.g. 'ExternalId'
```

| Situation                                            | Behaviour                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Row has an `externalKey` matching an existing record | Update that record                                                                                                |
| Row has an `externalKey` with no match               | Create, storing the key                                                                                           |
| Row has no `externalKey`                             | **Create a new record**                                                                                           |
| Row has no key but name matches an existing record   | Create, and list it in the preview under **Possible duplicates** with a per-row "link to existing instead" action |

Records are **never silently merged**. The preview shows counts for create / update / possible
duplicate / error, and every error names the row, the column, and the reason.

### 1.5 Validation

Rows are validated against the same Zod schemas and the same domain invariants as interactive
commands — import cannot bypass an invariant that the UI enforces. This is a property test:
_"any workspace state reachable by import is also reachable by commands."_

Cross-sheet references (a footprint's team, a dependency's target) resolve within the import set
first, then against existing data; unresolved references are errors, not silent nulls.

### 1.6 Apply

Single transaction. On failure, nothing is written and the error report is downloadable as CSV.
On success, one `IMPORT_APPLIED` domain event records file name, mapping id, and per-entity counts.

## 2. Export

| Export                 | Contents                                                                              | Format     |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------- |
| **Current view**       | Exactly the rows and columns of the active list companion, honouring filters and sort | CSV, XLSX  |
| **Workspace data**     | All entities, one sheet/file per type, with external keys                             | XLSX, JSON |
| **Portable workspace** | Everything including settings and history                                             | `.flowmap` |
| **Radar**              | Current signals with reason, entity, owner, due date, severity                        | CSV, XLSX  |
| **Quarter review**     | The close-of-quarter review payload                                                   | XLSX       |
| **Diagnostics**        | Opt-in, redacted ([10 §6](10-desktop-security.md#6-diagnostics))                      | ZIP        |

Exports never contain credentials, tokens, or provider secrets. Every export writes a
`_README` sheet/file naming the workspace, the export time, the schema version, and a sensitivity
notice.

## 3. Portable workspace format

```
workspace.flowmap                     # ZIP container, custom extension
├── manifest.json                     # formatVersion, schemaVersion, workspaceId, exportedAt,
│                                     # exportedBy, appVersion, contentHash, entityCounts
├── workspace.json                    # workspace record + settings
├── entities/
│   ├── teams.json          products.json        people.json
│   ├── team-quarters.json  commitments.json     footprints.json
│   ├── impacts.json        dependencies.json    decisions.json
│   ├── milestones.json     themes.json          commitment-themes.json
│   └── links.json          workspace-users.json
├── scenarios/<scenarioId>.json
├── history/<quarterId>.jsonl         # domain events, append-ordered
├── reviews/<quarterId>.json          # quarter-close reviews
└── views/saved-views.json
```

Rules:

- `formatVersion` is independent of `schemaVersion`; both are checked on import.
- **MUST NOT contain**: credentials, access or refresh tokens, provider configuration secrets,
  OS-specific cache, local file paths, or signal dispositions of other users.
- `contentHash` is a SHA-256 over the canonical (sorted-key, `\n`-joined) serialisation of all entity
  files, verified on import.
- Import of a `.flowmap` offers **new workspace** or **merge into existing** (which runs the same
  duplicate/external-key rules as §1.4 and shows the same preview). **Only "new workspace" is
  built**; merge into existing is not.
- **Every entity is given a fresh id on import, and every reference to an old one is rewritten.**
  Rows are keyed by entity id, so importing a package that came from the same machine while keeping
  its ids does not copy anything — it rewrites the existing rows' workspace and moves the portfolio
  out of the workspace it was in. The rewrite is a deep string substitution rather than a list of
  known reference fields, because ids also reach into settings, saved views and external-key maps.
- The **workspace data JSON** export (§2) carries the same workspace and entities without the
  manifest or hash, and imports by the same route. It is the file most people reach for, because it
  is the one labelled JSON.
- Round-trip is lossless for domain meaning and configuration — a property test exports, imports
  into a clean store, and asserts projection equality plus rule-result equality under a fixed clock.

**Sensitivity**: `.flowmap` files are **unencrypted**. A clear warning is shown before both export
and import: _"This file contains your portfolio's management data in plain text. Store and share it
according to your organisation's data classification."_ This is a deliberate, recorded decision
(R12) — encryption is reassessed at enterprise production readiness.

## 4. Snapshots

```
CreateSnapshot(name, note?) → Snapshot
RestoreSnapshot(snapshotId) → RestoreReport   (diff + explicit confirmation required)
DeleteSnapshot(snapshotId)
```

- Snapshot payloads are `.flowmap` packages stored under the app data directory (Local/File) or in
  the `FM_Snapshots` library (SharePoint).
- **Automatic snapshots** are created before every barrier command: `ApplyScenario`, `CloseQuarter`,
  `RestoreSnapshot`, `MigrateFootprintUnits`, `ApplyImport`, and any schema migration. They are
  named for the action and retained for 90 days or the last 20, whichever is larger.
- Restore is never silent. The `RestoreReport` shows, before anything is written:

```ts
type RestoreReport = {
  snapshot: { name; createdAt; workspaceRevision; schemaVersion };
  counts: Record<EntityKind, { added: number; removed: number; changed: number }>;
  notable: Array<{ ref: EntityRef; effect: 'WILL_BE_REMOVED' | 'WILL_REVERT'; summary: string }>;
  eventsSinceSnapshot: number;
  scenariosInvalidated: EntityId[];
};
```

- Restore requires typing the snapshot name to confirm, auto-snapshots the current state first,
  clears the undo stack, invalidates scenarios whose `baseRevision` no longer exists, and emits
  `SNAPSHOT_RESTORED`.
- Restoring across schema versions runs migrations forward on the snapshot content; restoring a
  snapshot **newer** than the build is refused.

## 5. Saved views

Non-restorable, data-free presentation state: lens, filters, horizon, focus, zoom level. Private by
default, shareable. Used to build a QBR agenda as an ordered set of views.

A saved view referencing an entity that no longer exists opens with the rest of its state intact and
a note that the focused item is gone — it never fails to open.

## 6. Workspace lifecycle

| Action       | Behaviour                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Create       | Name + timezone; seeds defaults; opens the map                                                                                                |
| Switch       | Instant, no restart; per-workspace undo stacks are cleared                                                                                    |
| Duplicate    | Export → import under a new id, with all `EntityId`s remapped                                                                                 |
| Reset sample | Sample workspaces only; restores the shipped fixture verbatim                                                                                 |
| Archive      | Hidden from the switcher, still on disk, restorable                                                                                           |
| Delete       | Admin; requires typing the workspace name; offers export first; removes local data and, for shared providers, tombstones the workspace record |
| Offboarding  | A documented procedure: export, verify hash, delete local data, revoke provider access                                                        |
