# 07 — Persistence & Sync

Flowmap is **local-first**. The UI always reads the local cache; the network is never in the render
path. Sync is an asynchronous background reconciliation with the shared provider.

## 1. Layering

```
      UI (React)
         │  commands / projections
   ┌─────▼──────────────────────────────────────────────┐
   │  @flowmap/domain   — pure command handlers          │
   │  @flowmap/rules    — pure evaluation                │
   └─────┬──────────────────────────────────────────────┘
         │  EntityChange[] + DomainEvent[]
   ┌─────▼──────────────────────────────────────────────┐
   │  WorkspaceRepository (@flowmap/storage)             │
   │   · local read model      · outbox                  │
   │   · transaction boundary  · migrations              │
   └─────┬───────────────────────────┬──────────────────┘
         │ SQLite (Tauri/Rust)       │ SyncEngine
         │                     ┌─────▼──────────────────┐
         │                     │ WorkspaceProvider      │
         │                     │  Local · File · SP     │
         └─────────────────────┴────────────────────────┘
```

**SQLite is a local cache only.** It is never placed in a synced folder and never opened by two
machines. This is stated in code comments, in the storage README, and enforced at runtime by a
startup check that refuses to open a database whose path is inside a known cloud-sync root
(OneDrive, iCloud Drive, Dropbox, Google Drive) unless the user overrides with an explicit,
logged confirmation.

## 2. Local schema (SQLite)

Tables (all with `workspace_id`, `entity_version`, `schema_version`, `updated_at`, `deleted_at`):

```sql
workspace(id PK, name, timezone, current_quarter_id, is_sample, revision, settings_json, …)
team(id PK, workspace_id, name, default_quarter_capacity, display_order, active, …)
team_quarter(id PK, workspace_id, team_id, quarter_id, capacity_baseline, capacity_adjustment,
             adjustment_note, reserves_json, closed_at, overflow_accepted_json, …)
commitment(id PK, workspace_id, name, lifecycle, prior_active_lifecycle, class, importance,
           primary_team_id, owner_json, target_quarter_id, target_date, confidence_json,
           outcome, value_drivers_json, attention_date, latest_safe_start, next_action,
           next_action_owner_json, next_action_due_date, management_note, recurrence_json,
           renewed_from_commitment_id, committed_at, committed_by,
           last_meaningful_update_at, last_reviewed_at, …)
capacity_footprint(id PK, workspace_id, commitment_id, team_id, quarter_id, units,
                   size_at_creation, units_source, confidence, is_primary,
                   carry_over_from_quarter_id, carry_over_from_footprint_id,
                   closed_as_unfinished, …)
product_service(id PK, …)          product_impact(id PK, commitment_id, product_service_id, type, …)
dependency(id PK, source_commitment_id, target_kind, target_id, type, owner_json,
           needed_by, status, is_hard, note, …)
decision(id PK, kind, name, owner_json, needed_by, status, …)
milestone(id PK, commitment_id, name, target_date, status, display_order, …)
theme(id PK, …)                    commitment_theme(id PK, commitment_id, theme_id, …)
person(id PK, …)                   workspace_user(id PK, identity_subject, person_id, role, …)
external_link(id PK, commitment_id, type, url, label, …)
scenario(id PK, name, owner_user_id, visibility, base_revision, status, commands_json, …)
snapshot(id PK, name, workspace_revision, content_hash, size_bytes, storage_ref, …)
saved_view(id PK, name, lens, filters_json, horizon, focus_json, owner_user_id, visibility, …)
domain_event(id PK, workspace_id, sequence, occurred_at, actor_id, command_name, event_type,
             entity_refs_json, summary, facts_json, reason, scenario_id)
signal_disposition(id PK, workspace_id, signal_key, actor_id, disposition, at_fingerprint,
                   at_severity, snooze_until, note, …)
quarter_review(id PK, workspace_id, quarter_id, team_id, outcomes_json, closed_at, …)

-- sync infrastructure
outbox(id PK, workspace_id, command_id, batch_id, entity_ref_json, op, base_version,
       base_snapshot_json, changed_fields_json, patch_json, created_at, attempts,
       last_error, state)          -- state: PENDING | IN_FLIGHT | ACKED | CONFLICT | FAILED
sync_state(workspace_id PK, provider_id, pull_cursor, last_pull_at, last_push_at,
           last_auth_at, offline_expires_at)
conflict(id PK, workspace_id, entity_ref_json, field, local_value_json, remote_value_json,
         local_version, remote_version, detected_at, resolved_at, resolution)
migration_log(version PK, applied_at, checksum, duration_ms)

-- search
commitment_fts USING fts5(name, outcome, management_note, content='commitment', content_rowid=…)
search_index(entity_kind, entity_id, workspace_id, text)   -- teams, products, people, themes, links
```

Indexes (required, not optional — they are the difference between 300 ms and 3 s at target scale):

```sql
CREATE INDEX ix_fp_team_quarter   ON capacity_footprint(workspace_id, team_id, quarter_id)
                                     WHERE deleted_at IS NULL;
CREATE INDEX ix_fp_commitment     ON capacity_footprint(workspace_id, commitment_id);
CREATE INDEX ix_commit_lifecycle  ON commitment(workspace_id, lifecycle) WHERE archived_at IS NULL;
CREATE INDEX ix_commit_target     ON commitment(workspace_id, target_quarter_id);
CREATE INDEX ix_dep_source        ON dependency(workspace_id, source_commitment_id);
CREATE INDEX ix_dep_target        ON dependency(workspace_id, target_kind, target_id);
CREATE INDEX ix_impact_product    ON product_impact(workspace_id, product_service_id);
CREATE INDEX ix_event_sequence    ON domain_event(workspace_id, sequence DESC);
CREATE INDEX ix_outbox_state      ON outbox(workspace_id, state, created_at);
```

Pragmas: `journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`, `busy_timeout = 5000`.

### 2.1 Migrations

- Numbered, forward-only, **idempotent**: every migration is written so that re-running it on an
  already-migrated database is a no-op (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` guarded by a
  `pragma_table_info` check, backfills written as `UPDATE … WHERE <not yet backfilled>`).
- Applied inside a single transaction, recorded in `migration_log` with a checksum of the migration
  source. A checksum mismatch on an applied version aborts startup with an actionable error.
- A **pre-migration backup** (`<workspaceId>.pre-migration-<n>.flowmap`) is written before the first
  migration of a session; failure offers restore-from-backup.
- Tested both forward (n−1 → n) and by round-tripping a fixture workspace through export/import at
  each version.

## 3. Repository contract

```ts
interface WorkspaceRepository {
  load(workspaceId: WorkspaceId): Promise<BaselineProjection>;
  apply(changes: EntityChange[], events: DomainEvent[], outbox: OutboxEntry[]): Promise<void>; // single transaction
  transaction<T>(fn: (tx: RepositoryTx) => Promise<T>): Promise<T>;
  search(query: string, kinds?: EntityKind[]): Promise<SearchHit[]>;
  listEvents(filter: EventFilter, page: Page): Promise<DomainEvent[]>;
  snapshotTo(ref: string): Promise<Snapshot>;
  restoreFrom(ref: string): Promise<RestoreReport>;
  clearLocalData(workspaceId?: WorkspaceId): Promise<void>;
}
```

`apply` writes entity changes, domain events, **and** outbox entries in one transaction. There is no
window in which a change is visible locally but absent from the outbox — that window is how
local-first apps lose data.

## 4. Sync engine

### 4.1 Loop

```
while (online && provider.authenticated):
   pull()            // remote → local
   push()            // local outbox → remote
   sleep(interval)   // 60 s idle, 10 s after a local change, backoff on error
```

Sync is also triggered by: workspace open, window focus, manual "Sync now", and returning online.

### 4.2 Pull

```ts
type PullPage = {
  changes: RemoteEntityChange[]; // includes tombstones
  cursor: SyncCursor;
  hasMore: boolean;
  serverTime: IsoDateTime;
};
```

- Cursor-based and paginated. `sync_state.pull_cursor` is advanced **only after** a page is fully
  applied, so an interrupted pull resumes without gaps.
- Remote changes are applied to the local cache **without** running command handlers — they are
  already-validated facts from a peer. They do, however, run schema validation (Zod) and produce
  `INT_SCHEMA_AHEAD` if newer.
- Applying a remote change to an entity with a pending local outbox entry does **not** overwrite the
  local value; it goes to conflict detection (§5).
- After a pull, affected projection keys are recomputed and rules re-evaluated incrementally.

### 4.3 Push

```ts
type MutationBatch = { batchId: EntityId; operations: MutationOperation[] };
type MutationOperation = {
  operationId: EntityId; // == command id; the idempotency key
  entityRef: EntityRef;
  op: 'CREATE' | 'UPDATE' | 'DELETE';
  baseVersion?: string; // provider concurrency token seen locally
  changedFields: string[];
  patch: unknown; // only the changed fields
};
type PushResult = {
  results: Array<
    | { operationId; status: 'APPLIED'; newVersion: string }
    | { operationId; status: 'DUPLICATE'; newVersion: string } // already applied — treat as success
    | { operationId; status: 'CONFLICT'; remoteVersion: string; remoteEntity: unknown }
    | { operationId; status: 'REJECTED'; code: string; message: string }
  >;
};
```

- Operations are pushed **in outbox order per entity**; different entities may push concurrently up
  to the provider's batch limit.
- `operationId` makes push idempotent: a retried batch after a timeout returns `DUPLICATE`, which is
  success. **Interrupted or repeated pushes never double-apply.**
- `REJECTED` moves the entry to `FAILED`, surfaces an actionable error, and does not block the rest
  of the queue for unrelated entities.
- Backoff: exponential from 2 s to 5 min with jitter; `Retry-After` is honoured exactly when the
  provider supplies it.

## 5. Conflict resolution

Detection is **field-level**, using the `base_snapshot_json` captured when the local mutation was
recorded:

```
for each conflicting entity:
  localChanged  = outbox.changedFields
  remoteChanged = fields where remote != baseSnapshot
  overlap       = localChanged ∩ remoteChanged

  if overlap is empty:
      auto-merge: apply remote changes, replay local patch on top, push with the new baseVersion
  else:
      create a Conflict row per overlapping field; surface in the conflict UI; do not apply either side
```

**Non-overlapping field changes merge automatically. Overlapping field changes are never silently
overwritten** — they require an explicit user choice.

Conflict UI: entity name, the field, "yours" vs "theirs" with who changed it and when, and three
actions — _Keep mine_ · _Take theirs_ · _Edit merged value_. Resolution emits a normal command, so it
is authorised, validated, versioned, and recorded in history like any other change.

Fields excluded from merge and always treated as whole-entity (they are structurally coupled):
`reserves_json`, `settings_json`, `commands_json` (scenario), `outcomes_json` (quarter review).
For these, conflict is entity-level.

While conflicts are unresolved for an entity, that entity is marked in the UI and further local
edits to it are blocked with an explanation, so the user cannot pile changes onto an ambiguous base.

## 6. Offline behaviour

- Everything works offline: read, create, edit, scenario, rules, search, import, export.
- The status bar shows `Offline · Last synced HH:MM · N pending`. Entities with pending changes carry
  a subtle pending marker (icon + text in the list companion).
- **Offline expiry**: a cached _shared_ workspace remains usable for **30 days** after the last
  successful authentication (`sync_state.offline_expires_at`). At 7 days remaining, a persistent but
  dismissible banner warns. On expiry, the workspace becomes read-only and offers export before
  re-authentication. Local-only workspaces never expire.
- Access revalidation happens on every successful auth; a revoked account fails the next pull and the
  workspace becomes read-only with an explanation and an export path — local work is never destroyed
  by a revocation.

## 7. Sync invariants (property + fault-injection tested)

1. Two clients editing **different** entities offline converge with no data loss after sync.
2. Two clients editing **different fields of the same** entity converge by auto-merge.
3. Two clients editing the **same field** produce a conflict, never a silent overwrite.
4. Replaying any push batch is idempotent (`DUPLICATE` == success).
5. An interrupted pull resumes from the cursor with no missed or duplicated change.
6. Killing the process mid-`apply` leaves the local DB consistent (transaction) and the outbox
   complete.
7. Provider throttling (429/503) preserves all local work and produces actionable status.
8. A tombstone always wins over a concurrent update to the same entity, and the update's author is
   told the entity was deleted, by whom, and when.
9. `revision` advances monotonically; a scenario whose `baseRevision` is behind cannot apply.
10. Clearing local data never touches shared-store state.
