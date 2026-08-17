/**
 * SQLite schema, as versioned migrations.
 *
 * Every statement is written to be safe to run twice — `IF NOT EXISTS`
 * throughout, and column additions guarded by `pragma_table_info`. AGENTS.md
 * makes idempotence a hard rule, and `schema.test.ts` proves it by running each
 * migration twice and comparing the resulting schema.
 *
 * Indexes are not optional. At 500 commitments they are the difference between
 * a 300 ms load and a 3 s one — see docs/spec/07-persistence-sync.md §2.
 */

import type { Migration } from '@flowmap/storage';

const V1_SQL = `
CREATE TABLE IF NOT EXISTS workspace (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  timezone           TEXT NOT NULL,
  current_quarter_id TEXT NOT NULL,
  is_sample          INTEGER NOT NULL DEFAULT 0,
  revision           INTEGER NOT NULL DEFAULT 1,
  settings_json      TEXT NOT NULL,
  schema_version     INTEGER NOT NULL,
  entity_version     INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  updated_by         TEXT NOT NULL,
  archived_at        TEXT,
  deleted_at         TEXT,
  remote_version     TEXT
);

CREATE TABLE IF NOT EXISTS team (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT NOT NULL,
  name                     TEXT NOT NULL,
  description              TEXT,
  default_quarter_capacity INTEGER NOT NULL,
  display_order            INTEGER NOT NULL,
  active                   INTEGER NOT NULL DEFAULT 1,
  schema_version           INTEGER NOT NULL,
  entity_version           INTEGER NOT NULL,
  created_at               TEXT NOT NULL,
  created_by               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  updated_by               TEXT NOT NULL,
  archived_at              TEXT,
  archived_by              TEXT,
  deleted_at               TEXT,
  remote_version           TEXT
);

CREATE TABLE IF NOT EXISTS team_quarter (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  team_id               TEXT NOT NULL,
  quarter_id            TEXT NOT NULL,
  capacity_baseline     INTEGER NOT NULL,
  capacity_adjustment   INTEGER NOT NULL DEFAULT 0,
  adjustment_note       TEXT,
  reserves_json         TEXT NOT NULL DEFAULT '[]',
  closed_at             TEXT,
  overflow_accepted_json TEXT,
  schema_version        INTEGER NOT NULL,
  entity_version        INTEGER NOT NULL,
  created_at            TEXT NOT NULL,
  created_by            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  updated_by            TEXT NOT NULL,
  archived_at           TEXT,
  archived_by           TEXT,
  deleted_at            TEXT,
  remote_version        TEXT
);

CREATE TABLE IF NOT EXISTS commitment (
  id                         TEXT PRIMARY KEY,
  workspace_id               TEXT NOT NULL,
  name                       TEXT NOT NULL,
  lifecycle                  TEXT NOT NULL,
  prior_active_lifecycle     TEXT,
  class                      TEXT NOT NULL,
  importance                 TEXT NOT NULL,
  primary_team_id            TEXT,
  owner_json                 TEXT,
  target_quarter_id          TEXT,
  target_date                TEXT,
  size_confidence            TEXT,
  timing_confidence          TEXT,
  scope_confidence           TEXT,
  outcome                    TEXT,
  value_drivers_json         TEXT NOT NULL DEFAULT '[]',
  attention_date             TEXT,
  latest_safe_start          TEXT,
  next_action                TEXT,
  next_action_owner_json     TEXT,
  next_action_due_date       TEXT,
  management_note            TEXT,
  recurrence_json            TEXT,
  renewed_from_commitment_id TEXT,
  committed_at               TEXT,
  committed_by               TEXT,
  units_at_commit            INTEGER,
  last_meaningful_update_at  TEXT,
  last_reviewed_at           TEXT,
  schema_version             INTEGER NOT NULL,
  entity_version             INTEGER NOT NULL,
  created_at                 TEXT NOT NULL,
  created_by                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  updated_by                 TEXT NOT NULL,
  archived_at                TEXT,
  archived_by                TEXT,
  deleted_at                 TEXT,
  remote_version             TEXT
);

CREATE TABLE IF NOT EXISTS capacity_footprint (
  id                          TEXT PRIMARY KEY,
  workspace_id                TEXT NOT NULL,
  commitment_id               TEXT NOT NULL,
  team_id                     TEXT NOT NULL,
  quarter_id                  TEXT NOT NULL,
  units                       INTEGER NOT NULL,
  size_at_creation            TEXT,
  units_source                TEXT NOT NULL,
  confidence                  TEXT,
  is_primary                  INTEGER NOT NULL DEFAULT 0,
  carry_over_from_quarter_id  TEXT,
  carry_over_from_footprint_id TEXT,
  closed_as_unfinished        INTEGER,
  schema_version              INTEGER NOT NULL,
  entity_version              INTEGER NOT NULL,
  created_at                  TEXT NOT NULL,
  created_by                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  updated_by                  TEXT NOT NULL,
  archived_at                 TEXT,
  archived_by                 TEXT,
  deleted_at                  TEXT,
  remote_version              TEXT
);

CREATE TABLE IF NOT EXISTS domain_event (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL,
  sequence         INTEGER NOT NULL,
  occurred_at      TEXT NOT NULL,
  actor_id         TEXT NOT NULL,
  command_name     TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  entity_refs_json TEXT NOT NULL,
  summary_key      TEXT NOT NULL,
  facts_json       TEXT NOT NULL,
  reason           TEXT,
  scenario_id      TEXT
);

CREATE TABLE IF NOT EXISTS outbox (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL,
  command_id          TEXT NOT NULL,
  batch_id            TEXT,
  entity_ref_json     TEXT NOT NULL,
  op                  TEXT NOT NULL,
  base_version        INTEGER,
  base_snapshot_json  TEXT,
  changed_fields_json TEXT NOT NULL,
  patch_json          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  state               TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS sync_state (
  workspace_id       TEXT PRIMARY KEY,
  provider_id        TEXT NOT NULL,
  pull_cursor        TEXT,
  last_pull_at       TEXT,
  last_push_at       TEXT
);

CREATE TABLE IF NOT EXISTS local_profile (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_team_workspace     ON team(workspace_id);
CREATE INDEX IF NOT EXISTS ix_tq_team_quarter    ON team_quarter(workspace_id, team_id, quarter_id);
CREATE INDEX IF NOT EXISTS ix_fp_team_quarter    ON capacity_footprint(workspace_id, team_id, quarter_id);
CREATE INDEX IF NOT EXISTS ix_fp_commitment      ON capacity_footprint(workspace_id, commitment_id);
CREATE INDEX IF NOT EXISTS ix_commit_lifecycle   ON commitment(workspace_id, lifecycle);
CREATE INDEX IF NOT EXISTS ix_commit_target      ON commitment(workspace_id, target_quarter_id);
CREATE INDEX IF NOT EXISTS ix_event_sequence     ON domain_event(workspace_id, sequence DESC);
CREATE INDEX IF NOT EXISTS ix_outbox_state       ON outbox(workspace_id, state, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_outbox_command ON outbox(command_id, entity_ref_json);
`;

const V2_SQL = `
CREATE TABLE IF NOT EXISTS product_service (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  owner_json     TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL,
  entity_version INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  archived_at    TEXT,
  archived_by    TEXT,
  deleted_at     TEXT,
  remote_version TEXT
);

CREATE TABLE IF NOT EXISTS product_impact (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL,
  commitment_id      TEXT NOT NULL,
  product_service_id TEXT NOT NULL,
  type               TEXT NOT NULL,
  note               TEXT,
  schema_version     INTEGER NOT NULL,
  entity_version     INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  updated_by         TEXT NOT NULL,
  archived_at        TEXT,
  archived_by        TEXT,
  deleted_at         TEXT,
  remote_version     TEXT
);

CREATE TABLE IF NOT EXISTS decision (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  name            TEXT NOT NULL,
  owner_json      TEXT,
  needed_by       TEXT,
  status          TEXT NOT NULL,
  resolution_note TEXT,
  resolved_at     TEXT,
  schema_version  INTEGER NOT NULL,
  entity_version  INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  archived_at     TEXT,
  archived_by     TEXT,
  deleted_at      TEXT,
  remote_version  TEXT
);

CREATE TABLE IF NOT EXISTS dependency (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL,
  source_commitment_id TEXT NOT NULL,
  target_kind          TEXT NOT NULL,
  target_id            TEXT NOT NULL,
  type                 TEXT NOT NULL,
  owner_json           TEXT,
  needed_by            TEXT,
  status               TEXT NOT NULL,
  is_hard              INTEGER NOT NULL DEFAULT 0,
  note                 TEXT,
  schema_version       INTEGER NOT NULL,
  entity_version       INTEGER NOT NULL,
  created_at           TEXT NOT NULL,
  created_by           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  updated_by           TEXT NOT NULL,
  archived_at          TEXT,
  archived_by          TEXT,
  deleted_at           TEXT,
  remote_version       TEXT
);

CREATE TABLE IF NOT EXISTS milestone (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  commitment_id  TEXT NOT NULL,
  name           TEXT NOT NULL,
  target_date    TEXT,
  status         TEXT NOT NULL,
  note           TEXT,
  display_order  INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  entity_version INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  archived_at    TEXT,
  archived_by    TEXT,
  deleted_at     TEXT,
  remote_version TEXT
);

CREATE TABLE IF NOT EXISTS theme (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  name           TEXT NOT NULL,
  color_token    TEXT,
  schema_version INTEGER NOT NULL,
  entity_version INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  archived_at    TEXT,
  archived_by    TEXT,
  deleted_at     TEXT,
  remote_version TEXT
);

CREATE TABLE IF NOT EXISTS commitment_theme (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  commitment_id  TEXT NOT NULL,
  theme_id       TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  entity_version INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  archived_at    TEXT,
  archived_by    TEXT,
  deleted_at     TEXT,
  remote_version TEXT
);

CREATE TABLE IF NOT EXISTS external_link (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  commitment_id  TEXT NOT NULL,
  type           TEXT NOT NULL,
  url            TEXT NOT NULL,
  label          TEXT,
  schema_version INTEGER NOT NULL,
  entity_version INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  archived_at    TEXT,
  archived_by    TEXT,
  deleted_at     TEXT,
  remote_version TEXT
);

CREATE TABLE IF NOT EXISTS person (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  email          TEXT,
  role_label     TEXT,
  team_id        TEXT,
  linked_user_id TEXT,
  schema_version INTEGER NOT NULL,
  entity_version INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  archived_at    TEXT,
  archived_by    TEXT,
  deleted_at     TEXT,
  remote_version TEXT
);

CREATE INDEX IF NOT EXISTS ix_impact_commitment ON product_impact(workspace_id, commitment_id);
CREATE INDEX IF NOT EXISTS ix_impact_product    ON product_impact(workspace_id, product_service_id);
CREATE INDEX IF NOT EXISTS ix_dep_source        ON dependency(workspace_id, source_commitment_id);
CREATE INDEX IF NOT EXISTS ix_dep_target        ON dependency(workspace_id, target_kind, target_id);
CREATE INDEX IF NOT EXISTS ix_milestone_commit  ON milestone(workspace_id, commitment_id);
CREATE INDEX IF NOT EXISTS ix_ctheme_commit     ON commitment_theme(workspace_id, commitment_id);
CREATE INDEX IF NOT EXISTS ix_link_commit       ON external_link(workspace_id, commitment_id);
`;

/**
 * Signal dispositions.
 *
 * Keyed by signal *and* actor, so one lead's "reviewed — no change" never hides
 * another's signal in a shared workspace. There is no DISMISSED state: the
 * check constraint is the schema-level statement of that product decision.
 */
const V3_SQL = `
CREATE TABLE IF NOT EXISTS signal_disposition (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  signal_key      TEXT NOT NULL,
  disposition     TEXT NOT NULL CHECK (disposition IN ('REVIEWED', 'SNOOZED')),
  at_fingerprint  TEXT NOT NULL,
  at_severity     TEXT NOT NULL CHECK (at_severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH')),
  snooze_until    TEXT,
  actor_id        TEXT NOT NULL,
  note            TEXT,
  schema_version  INTEGER NOT NULL,
  entity_version  INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  archived_at     TEXT,
  archived_by     TEXT,
  deleted_at      TEXT,
  remote_version  TEXT
);

CREATE INDEX IF NOT EXISTS ix_disposition_key
  ON signal_disposition(workspace_id, signal_key, actor_id);
`;

/** Scenario command logs are local overlays, not baseline history. */
const V4_SQL = `
CREATE TABLE IF NOT EXISTS scenario (
  id                          TEXT PRIMARY KEY,
  workspace_id                TEXT NOT NULL,
  name                        TEXT NOT NULL,
  owner_user_id               TEXT NOT NULL,
  visibility                  TEXT NOT NULL CHECK (visibility IN ('PRIVATE', 'SHARED')),
  base_revision               INTEGER NOT NULL,
  commands_json               TEXT NOT NULL DEFAULT '[]',
  status                      TEXT NOT NULL CHECK (status IN ('DRAFT', 'SHARED', 'APPLIED', 'DISCARDED')),
  applied_at                  TEXT,
  applied_by                  TEXT,
  applied_command_ids_json    TEXT,
  schema_version              INTEGER NOT NULL,
  entity_version              INTEGER NOT NULL,
  created_at                  TEXT NOT NULL,
  created_by                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  updated_by                  TEXT NOT NULL,
  archived_at                 TEXT,
  archived_by                 TEXT,
  deleted_at                  TEXT,
  remote_version              TEXT
);

CREATE INDEX IF NOT EXISTS ix_scenario_workspace_status
  ON scenario(workspace_id, status, updated_at DESC);
`;

/** Barrier recovery points are local cache records, never synced artefacts. */
const V5_SQL = `
CREATE TABLE IF NOT EXISTS snapshot (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL,
  workspace_revision INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  command_name       TEXT NOT NULL,
  content_json       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_snapshot_workspace_created
  ON snapshot(workspace_id, created_at DESC);
`;

/** Local FTS only — never synchronised, exported or treated as a source of truth. */
const V6_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search USING fts5(
  workspace_id UNINDEXED,
  entity_id UNINDEXED,
  kind UNINDEXED,
  label,
  detail
);
`;

const V6_REINDEX: readonly [string, string][] = [
  [
    'commitment',
    "SELECT workspace_id, id, 'COMMITMENT', name, lifecycle FROM commitment WHERE archived_at IS NULL AND deleted_at IS NULL",
  ],
  [
    'team',
    "SELECT workspace_id, id, 'TEAM', name, description FROM team WHERE archived_at IS NULL AND deleted_at IS NULL",
  ],
  [
    'product_service',
    "SELECT workspace_id, id, 'PRODUCT_SERVICE', name, description FROM product_service WHERE archived_at IS NULL AND deleted_at IS NULL",
  ],
  [
    'person',
    "SELECT workspace_id, id, 'PERSON', display_name, role_label FROM person WHERE archived_at IS NULL AND deleted_at IS NULL",
  ],
  [
    'theme',
    "SELECT workspace_id, id, 'THEME', name, '' FROM theme WHERE archived_at IS NULL AND deleted_at IS NULL",
  ],
  [
    'milestone',
    "SELECT workspace_id, id, 'MILESTONE', name, status FROM milestone WHERE archived_at IS NULL AND deleted_at IS NULL",
  ],
  [
    'external_link',
    "SELECT workspace_id, id, 'EXTERNAL_LINK', label, type FROM external_link WHERE label IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL",
  ],
];

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    checksumSource: V1_SQL,
    up: async (ctx) => {
      // Every statement is `IF NOT EXISTS`, so a second run is a no-op.
      for (const statement of V1_SQL.split(';')) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await ctx.exec(trimmed);
      }
    },
  },
  {
    version: 2,
    // Everything a commitment relates to. M1 stored only the capacity
    // skeleton — teams, quarters, commitments, footprints — so the detail
    // panel had nothing to read and the fixture's impacts, dependencies,
    // milestones and links could not be seeded at all.
    name: 'relations',
    checksumSource: V2_SQL,
    up: async (ctx) => {
      for (const statement of V2_SQL.split(';')) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await ctx.exec(trimmed);
      }
    },
  },
  {
    version: 3,
    // Radar dispositions. Added with M3; nothing before it could produce a
    // signal, so there is no backfill — an absent row means "not disposed",
    // which is exactly the default the suppression rule already assumes.
    name: 'signal-dispositions',
    checksumSource: V3_SQL,
    up: async (ctx) => {
      for (const statement of V3_SQL.split(';')) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await ctx.exec(trimmed);
      }
    },
  },
  {
    version: 4,
    name: 'scenario-overlays',
    checksumSource: V4_SQL,
    up: async (ctx) => {
      for (const statement of V4_SQL.split(';')) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await ctx.exec(trimmed);
      }
    },
  },
  {
    version: 5,
    name: 'barrier-snapshots',
    checksumSource: V5_SQL,
    up: async (ctx) => {
      for (const statement of V5_SQL.split(';')) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await ctx.exec(trimmed);
      }
    },
  },
  {
    version: 6,
    name: 'local-search-index',
    checksumSource: V6_SQL,
    up: async (ctx) => {
      for (const statement of V6_SQL.split(';')) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await ctx.exec(trimmed);
      }
      // Each migration is independently idempotence-tested against an empty
      // database. Backfill only the entity tables present at this point.
      for (const [table, select] of V6_REINDEX) {
        const exists = await ctx.get<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          [table],
        );
        if (exists) {
          await ctx.exec(
            `INSERT INTO workspace_search (workspace_id, entity_id, kind, label, detail) ${select}`,
          );
        }
      }
    },
  },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;
