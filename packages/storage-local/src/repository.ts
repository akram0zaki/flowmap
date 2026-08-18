/**
 * The SQLite-backed workspace repository.
 *
 * `apply` writes entity changes, domain events, and outbox entries in a single
 * transaction. There is no code path that writes one without the others.
 *
 * See docs/spec/07-persistence-sync.md §3.
 */

import type {
  CapacityFootprint,
  Commitment,
  CommitmentTheme,
  Decision,
  Dependency,
  DomainEvent,
  EntityChange,
  EntityId,
  EntityRef,
  ExternalLink,
  SignalDisposition,
  Scenario,
  Milestone,
  Person,
  ProductImpact,
  ProductService,
  Team,
  TeamQuarter,
  Theme,
  Workspace,
  WorkspaceId,
  WorkspaceState,
  WorkspaceUser,
} from '@flowmap/domain';
import { DomainErrorException, domainError, refKey } from '@flowmap/domain';
import {
  runMigrations,
  type ApplyInput,
  type ApplyRemoteInput,
  type ConflictRecord,
  type ConflictResolution,
  type MigrationHost,
  type MigrationRecord,
  type MigrationReport,
  type OutboxEntry,
  type OutboxState,
  type SnapshotRecord,
  type SearchHit,
  type SyncStateRecord,
  type WorkspaceRepository,
} from '@flowmap/storage';

import type { SqlDriver, SqlValue } from './driver.js';
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from './schema.js';

type Json = string | null;

const j = (value: unknown): Json => (value === undefined ? null : JSON.stringify(value));
const p = <T>(value: SqlValue | undefined): T | undefined =>
  value === null || value === undefined ? undefined : (JSON.parse(String(value)) as T);
const s = (value: SqlValue | undefined): string | undefined =>
  value === null || value === undefined ? undefined : String(value);
const n = (value: SqlValue | undefined): number | undefined =>
  value === null || value === undefined ? undefined : Number(value);

/** Drops undefined entries so `exactOptionalPropertyTypes` stays satisfied. */
function defined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

const TABLE_BY_KIND: Partial<Record<EntityRef['kind'], string>> = {
  WORKSPACE: 'workspace',
  TEAM: 'team',
  TEAM_QUARTER: 'team_quarter',
  COMMITMENT: 'commitment',
  CAPACITY_FOOTPRINT: 'capacity_footprint',
  PRODUCT_SERVICE: 'product_service',
  PRODUCT_IMPACT: 'product_impact',
  DEPENDENCY: 'dependency',
  DECISION: 'decision',
  MILESTONE: 'milestone',
  THEME: 'theme',
  COMMITMENT_THEME: 'commitment_theme',
  EXTERNAL_LINK: 'external_link',
  SIGNAL_DISPOSITION: 'signal_disposition',
  PERSON: 'person',
  SCENARIO: 'scenario',
  WORKSPACE_USER: 'workspace_user',
};

export class SqliteWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: SqlDriver) {}

  /** Runs pending migrations. Safe to call on every open. */
  async migrate(
    options: { backup?: (version: number) => Promise<string | undefined>; now?: () => string } = {},
  ): Promise<MigrationReport> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS migration_log (
        version     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        checksum    TEXT NOT NULL,
        applied_at  TEXT NOT NULL,
        duration_ms INTEGER NOT NULL
      )
    `);

    const host: MigrationHost = {
      currentVersion: async () =>
        Number(
          (
            await this.db.get<{ v: number }>(
              'SELECT COALESCE(MAX(version), 0) AS v FROM migration_log',
            )
          )?.v ?? 0,
        ),
      appliedMigrations: async () =>
        (
          await this.db.all<{
            version: number;
            name: string;
            checksum: string;
            applied_at: string;
            duration_ms: number;
          }>(
            'SELECT version, name, checksum, applied_at, duration_ms FROM migration_log ORDER BY version',
          )
        ).map((row): MigrationRecord => ({
          version: Number(row.version),
          name: String(row.name),
          checksum: String(row.checksum),
          appliedAt: String(row.applied_at),
          durationMs: Number(row.duration_ms),
        })),
      transaction: (fn) =>
        this.db.transaction(() =>
          fn({
            exec: (sql) => this.db.exec(sql),
            get: (sql, params) => this.db.get(sql, params as readonly SqlValue[]) as never,
          }),
        ),
      record: (entry) =>
        this.db.run(
          'INSERT OR REPLACE INTO migration_log (version, name, checksum, applied_at, duration_ms) VALUES (?, ?, ?, ?, ?)',
          [entry.version, entry.name, entry.checksum, entry.appliedAt, entry.durationMs],
        ),
      now: options.now ?? (() => new Date().toISOString()),
      ...(options.backup ? { backup: options.backup } : {}),
    };

    return runMigrations(host, MIGRATIONS);
  }

  async listWorkspaces(options: { includeArchived?: boolean } = {}): Promise<
    Array<{
      id: WorkspaceId;
      name: string;
      updatedAt: string;
      archivedAt?: string;
      isSample: boolean;
    }>
  > {
    return (
      await this.db.all<{
        id: string;
        name: string;
        updated_at: string;
        archived_at: string | null;
        is_sample: number | null;
      }>(
        `SELECT id, name, updated_at, archived_at, is_sample FROM workspace WHERE deleted_at IS NULL${options.includeArchived ? '' : ' AND archived_at IS NULL'} ORDER BY updated_at DESC`,
      )
    ).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      updatedAt: String(row.updated_at),
      isSample: Number(row.is_sample) === 1,
      ...(row.archived_at ? { archivedAt: String(row.archived_at) } : {}),
    }));
  }

  async load(workspaceId: WorkspaceId): Promise<WorkspaceState | null> {
    const row = await this.db.get('SELECT * FROM workspace WHERE id = ? AND deleted_at IS NULL', [
      workspaceId,
    ]);
    if (!row) return null;

    return {
      workspace: this.#toWorkspace(row),
      teams: await this.#loadMap('team', workspaceId, (r) => this.#toTeam(r)),
      teamQuarters: await this.#loadMap('team_quarter', workspaceId, (r) => this.#toTeamQuarter(r)),
      commitments: await this.#loadMap('commitment', workspaceId, (r) => this.#toCommitment(r)),
      footprints: await this.#loadMap('capacity_footprint', workspaceId, (r) =>
        this.#toFootprint(r),
      ),
      products: await this.#loadMap('product_service', workspaceId, (r) => this.#toProduct(r)),
      productImpacts: await this.#loadMap('product_impact', workspaceId, (r) => this.#toImpact(r)),
      dependencies: await this.#loadMap('dependency', workspaceId, (r) => this.#toDependency(r)),
      decisions: await this.#loadMap('decision', workspaceId, (r) => this.#toDecision(r)),
      milestones: await this.#loadMap('milestone', workspaceId, (r) => this.#toMilestone(r)),
      themes: await this.#loadMap('theme', workspaceId, (r) => this.#toTheme(r)),
      commitmentThemes: await this.#loadMap('commitment_theme', workspaceId, (r) =>
        this.#toCommitmentTheme(r),
      ),
      externalLinks: await this.#loadMap('external_link', workspaceId, (r) => this.#toLink(r)),
      signalDispositions: await this.#loadMap('signal_disposition', workspaceId, (r) =>
        this.#toDisposition(r),
      ),
      people: await this.#loadMap('person', workspaceId, (r) => this.#toPerson(r)),
      scenarios: await this.#loadMap('scenario', workspaceId, (r) => this.#toScenario(r)),
      workspaceUsers: await this.#loadMap('workspace_user', workspaceId, (r) =>
        this.#toWorkspaceUser(r),
      ),
    };
  }

  /**
   * The single transactional boundary. Changes, events, and outbox entries land
   * together or not at all.
   */
  async apply(input: ApplyInput): Promise<void> {
    if (input.command.scenarioId !== undefined) {
      throw new DomainErrorException(
        domainError('SCENARIO_CANNOT_MUTATE_BASELINE', {
          params: { scenarioId: input.command.scenarioId },
        }),
      );
    }
    await this.db.transaction(async () => {
      if (input.preSnapshot) await this.#writeSnapshot(input.preSnapshot);
      for (const change of input.changes) await this.#writeChange(input.workspaceId, change);
      for (const event of input.events) await this.#writeEvent(event);
      for (const change of input.changes) await this.#writeOutbox(input, change);
    });
  }

  async listEvents(workspaceId: WorkspaceId, limit = 200): Promise<DomainEvent[]> {
    return (
      await this.db.all(
        'SELECT * FROM domain_event WHERE workspace_id = ? ORDER BY sequence DESC LIMIT ?',
        [workspaceId, limit],
      )
    ).map(
      (row): DomainEvent =>
        defined({
          id: String(row['id']),
          workspaceId: String(row['workspace_id']),
          sequence: Number(row['sequence']),
          occurredAt: String(row['occurred_at']),
          actorId: String(row['actor_id']),
          commandName: String(row['command_name']),
          eventType: String(row['event_type']),
          entityRefs: p<EntityRef[]>(row['entity_refs_json']) ?? [],
          summaryKey: String(row['summary_key']),
          facts: p<Record<string, unknown>>(row['facts_json']) ?? {},
          reason: s(row['reason']),
          scenarioId: s(row['scenario_id']),
        }) as DomainEvent,
    );
  }

  async listSnapshots(workspaceId: WorkspaceId, limit = 50): Promise<SnapshotRecord[]> {
    return (
      await this.db.all(
        'SELECT * FROM snapshot WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?',
        [workspaceId, limit],
      )
    ).map((row) => ({
      id: String(row['id']),
      workspaceId: String(row['workspace_id']),
      workspaceRevision: Number(row['workspace_revision']),
      createdAt: String(row['created_at']),
      commandName: String(row['command_name']),
      content: p(row['content_json']) ?? {},
    }));
  }

  async search(workspaceId: WorkspaceId, query: string, limit = 30): Promise<SearchHit[]> {
    const terms = query
      .trim()
      .split(/\s+/)
      .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ''))
      .filter(Boolean);
    if (terms.length === 0) return [];
    const expression = terms.map((term) => `${term}*`).join(' AND ');
    return (
      await this.db.all<{ entity_id: string; kind: string; label: string; detail: string | null }>(
        'SELECT entity_id, kind, label, detail FROM workspace_search WHERE workspace_id = ? AND workspace_search MATCH ? ORDER BY rank LIMIT ?',
        [workspaceId, expression, limit],
      )
    ).map(
      (row) =>
        defined({
          kind: String(row.entity_id === undefined ? '' : row.kind),
          id: String(row.entity_id),
          label: String(row.label),
          detail: s(row.detail),
        }) as SearchHit,
    );
  }

  async listOutbox(workspaceId: WorkspaceId, state?: OutboxState): Promise<OutboxEntry[]> {
    const sql = state
      ? 'SELECT * FROM outbox WHERE workspace_id = ? AND state = ? ORDER BY created_at'
      : 'SELECT * FROM outbox WHERE workspace_id = ? ORDER BY created_at';
    const params: SqlValue[] = state ? [workspaceId, state] : [workspaceId];

    return (await this.db.all(sql, params)).map(
      (row): OutboxEntry =>
        defined({
          id: String(row['id']),
          workspaceId: String(row['workspace_id']),
          commandId: String(row['command_id']),
          batchId: s(row['batch_id']),
          entityRef: p<EntityRef>(row['entity_ref_json'])!,
          op: String(row['op']) as EntityChange['op'],
          baseVersion: n(row['base_version']),
          baseSnapshot: p(row['base_snapshot_json']),
          changedFields: p<string[]>(row['changed_fields_json']) ?? [],
          patch: p(row['patch_json']),
          createdAt: String(row['created_at']),
          attempts: Number(row['attempts']),
          lastError: s(row['last_error']),
          state: String(row['state']) as OutboxState,
          baseRemoteVersion: s(row['base_remote_version']),
        }) as OutboxEntry,
    );
  }

  async rebaseOutbox(
    ids: readonly EntityId[],
    baseRemoteVersion: string,
    patch?: unknown,
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.db.transaction(async () => {
      for (const id of ids) {
        if (patch !== undefined) {
          await this.db.run(
            'UPDATE outbox SET base_remote_version = ?, patch_json = ? WHERE id = ?',
            [baseRemoteVersion, JSON.stringify(patch), id],
          );
        } else {
          await this.db.run('UPDATE outbox SET base_remote_version = ? WHERE id = ?', [
            baseRemoteVersion,
            id,
          ]);
        }
      }
    });
  }

  async applyRemote(input: ApplyRemoteInput): Promise<void> {
    await this.db.transaction(async () => {
      for (const change of input.changes) {
        const op = change.deleted ? 'DELETE' : 'UPDATE';
        const after = change.deleted
          ? undefined
          : {
              ...((change.payload as object | undefined) ?? {}),
              remoteVersion: change.remoteVersion,
            };
        await this.#writeChange(input.workspaceId, {
          ref: change.entityRef,
          op,
          toVersion: change.entityVersion,
          ...(after !== undefined ? { after } : {}),
          changedFields: [],
        });
      }
    });
  }

  async listConflicts(workspaceId: WorkspaceId): Promise<readonly ConflictRecord[]> {
    return (
      await this.db.all('SELECT * FROM conflict WHERE workspace_id = ? ORDER BY detected_at', [
        workspaceId,
      ])
    ).map(
      (row): ConflictRecord =>
        defined({
          id: String(row['id']),
          workspaceId: String(row['workspace_id']),
          entityRef: p<EntityRef>(row['entity_ref_json'])!,
          field: String(row['field']),
          localValue: p(row['local_value_json']),
          remoteValue: p(row['remote_value_json']),
          localVersion: n(row['local_version']),
          remoteVersion: s(row['remote_version']),
          detectedAt: String(row['detected_at']),
          resolvedAt: s(row['resolved_at']),
          resolution: s(row['resolution']) as ConflictRecord['resolution'],
        }) as ConflictRecord,
    );
  }

  async saveConflicts(
    workspaceId: WorkspaceId,
    conflicts: readonly ConflictRecord[],
  ): Promise<void> {
    await this.db.transaction(async () => {
      for (const row of conflicts) {
        await this.db.run(
          `INSERT OR REPLACE INTO conflict
           (id, workspace_id, entity_ref_json, field, local_value_json, remote_value_json,
            local_version, remote_version, detected_at, resolved_at, resolution)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            workspaceId,
            j(row.entityRef)!,
            row.field,
            j(row.localValue),
            j(row.remoteValue),
            row.localVersion ?? null,
            row.remoteVersion ?? null,
            row.detectedAt,
            row.resolvedAt ?? null,
            row.resolution ?? null,
          ],
        );
      }
    });
  }

  async resolveConflict(
    id: EntityId,
    resolution: ConflictResolution,
    resolvedAt: string,
  ): Promise<void> {
    await this.db.run('UPDATE conflict SET resolved_at = ?, resolution = ? WHERE id = ?', [
      resolvedAt,
      resolution.action,
      id,
    ]);
  }

  async getSyncState(workspaceId: WorkspaceId): Promise<SyncStateRecord | null> {
    const row = await this.db.get('SELECT * FROM sync_state WHERE workspace_id = ?', [workspaceId]);
    if (!row) return null;
    return defined({
      workspaceId: String(row['workspace_id']),
      providerId: String(row['provider_id']) as SyncStateRecord['providerId'],
      pullCursor: s(row['pull_cursor']),
      lastPullAt: s(row['last_pull_at']),
      lastPushAt: s(row['last_push_at']),
      lastKnownRemoteAt: s(row['last_known_remote_at']),
      documentPath: s(row['document_path']),
      shareMode: s(row['share_mode']) as SyncStateRecord['shareMode'],
    }) as SyncStateRecord;
  }

  async setSyncState(state: SyncStateRecord): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO sync_state
       (workspace_id, provider_id, pull_cursor, last_pull_at, last_push_at,
        last_known_remote_at, document_path, share_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.workspaceId,
        state.providerId,
        state.pullCursor ?? null,
        state.lastPullAt ?? null,
        state.lastPushAt ?? null,
        state.lastKnownRemoteAt ?? null,
        state.documentPath ?? null,
        state.shareMode ?? null,
      ],
    );
  }

  async markOutbox(ids: readonly EntityId[], state: OutboxState, error?: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.transaction(async () => {
      for (const id of ids) {
        await this.db.run(
          'UPDATE outbox SET state = ?, last_error = ?, attempts = attempts + 1 WHERE id = ?',
          [state, error ?? null, id],
        );
      }
    });
  }

  async nextSequence(workspaceId: WorkspaceId): Promise<number> {
    const row = await this.db.get<{ next: number }>(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM domain_event WHERE workspace_id = ?',
      [workspaceId],
    );
    return Number(row?.next ?? 1);
  }

  async clearLocalData(workspaceId?: WorkspaceId): Promise<void> {
    const tables = [
      'capacity_footprint',
      'commitment',
      'team_quarter',
      'team',
      'domain_event',
      'outbox',
      'sync_state',
      'scenario',
      'conflict',
      'workspace_user',
      'workspace',
    ];
    await this.db.transaction(async () => {
      for (const table of tables) {
        if (workspaceId && table !== 'workspace') {
          await this.db.run(`DELETE FROM ${table} WHERE workspace_id = ?`, [workspaceId]);
        } else if (workspaceId) {
          await this.db.run('DELETE FROM workspace WHERE id = ?', [workspaceId]);
        } else {
          await this.db.run(`DELETE FROM ${table}`);
        }
      }
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  // ── Local profile (M1-VS-8) ──────────────────────────────────────────────

  /**
   * The self-declared identity that names changes in history. It survives
   * restarts and can later be linked to a verified identity without rewriting
   * anything — see docs/spec/08-providers.md §4.1.
   */
  async ensureLocalProfile(
    id: EntityId,
    displayName: string,
    createdAt: string,
  ): Promise<{ id: EntityId; displayName: string }> {
    const existing = await this.db.get<{ id: string; display_name: string }>(
      'SELECT id, display_name FROM local_profile LIMIT 1',
    );
    if (existing) return { id: String(existing.id), displayName: String(existing.display_name) };

    await this.db.run('INSERT INTO local_profile (id, display_name, created_at) VALUES (?, ?, ?)', [
      id,
      displayName,
      createdAt,
    ]);
    return { id, displayName };
  }

  // ── Writers ──────────────────────────────────────────────────────────────

  async #writeSnapshot(snapshot: NonNullable<ApplyInput['preSnapshot']>): Promise<void> {
    const content = Object.fromEntries(
      Object.entries(snapshot.state).map(([key, value]) => [
        key,
        value instanceof Map ? Object.fromEntries(value) : value,
      ]),
    );
    await this.db.run(
      'INSERT INTO snapshot (id, workspace_id, workspace_revision, created_at, command_name, content_json) VALUES (?, ?, ?, ?, ?, ?)',
      [
        snapshot.id,
        snapshot.workspaceId,
        snapshot.workspaceRevision,
        snapshot.createdAt,
        snapshot.commandName,
        JSON.stringify(content),
      ],
    );
  }

  async #writeChange(workspaceId: WorkspaceId, change: EntityChange): Promise<void> {
    const table = TABLE_BY_KIND[change.ref.kind];
    if (!table) throw new Error(`No table for entity kind ${change.ref.kind}`);
    if (change.op === 'DELETE') {
      await this.db.run(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, [
        new Date(0).toISOString(),
        (change.ref as { id: string }).id,
      ]);
      await this.#writeSearch(workspaceId, change.ref.kind, (change.ref as { id: string }).id);
      return;
    }

    const entity = change.after as Record<string, unknown>;
    const columns = this.#columnsFor(table, workspaceId, entity);
    const names = Object.keys(columns);
    const placeholders = names.map(() => '?').join(', ');

    await this.db.run(
      `INSERT OR REPLACE INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`,
      names.map((name) => columns[name] as SqlValue),
    );
    await this.#writeSearch(
      workspaceId,
      change.ref.kind,
      (change.ref as { id: string }).id,
      entity,
    );
  }

  async #writeSearch(
    workspaceId: WorkspaceId,
    kind: EntityRef['kind'],
    id: string,
    entity?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.run(
      'DELETE FROM workspace_search WHERE workspace_id = ? AND entity_id = ? AND kind = ?',
      [workspaceId, id, kind],
    );
    if (!entity || entity['archivedAt'] !== undefined || entity['deletedAt'] !== undefined) return;
    const label = entity['name'] ?? entity['displayName'] ?? entity['label'];
    if (typeof label !== 'string' || label.trim().length === 0) return;
    const detail =
      entity['lifecycle'] ?? entity['description'] ?? entity['roleLabel'] ?? entity['type'];
    await this.db.run(
      'INSERT INTO workspace_search (workspace_id, entity_id, kind, label, detail) VALUES (?, ?, ?, ?, ?)',
      [workspaceId, id, kind, label, typeof detail === 'string' ? detail : null],
    );
  }

  #columnsFor(
    table: string,
    workspaceId: WorkspaceId,
    e: Record<string, unknown>,
  ): Record<string, SqlValue> {
    const envelope: Record<string, SqlValue> = {
      id: String(e['id']),
      schema_version: Number(e['schemaVersion'] ?? CURRENT_SCHEMA_VERSION),
      entity_version: Number(e['entityVersion'] ?? 1),
      created_at: String(e['createdAt']),
      created_by: String(e['createdBy']),
      updated_at: String(e['updatedAt']),
      updated_by: String(e['updatedBy']),
      archived_at: (e['archivedAt'] as string) ?? null,
      deleted_at: (e['deletedAt'] as string) ?? null,
      remote_version: (e['remoteVersion'] as string) ?? null,
    };
    if (table !== 'workspace') {
      envelope['workspace_id'] = workspaceId;
      envelope['archived_by'] = (e['archivedBy'] as string) ?? null;
    }

    switch (table) {
      case 'workspace':
        return {
          ...envelope,
          name: String(e['name']),
          timezone: String(e['timezone']),
          current_quarter_id: String(e['currentQuarterId']),
          is_sample: e['isSample'] ? 1 : 0,
          revision: Number(e['revision'] ?? 1),
          settings_json: j(e['settings'])!,
        };
      case 'team':
        return {
          ...envelope,
          name: String(e['name']),
          description: (e['description'] as string) ?? null,
          default_quarter_capacity: Number(e['defaultQuarterCapacity']),
          display_order: Number(e['displayOrder']),
          active: e['active'] ? 1 : 0,
        };
      case 'team_quarter':
        return {
          ...envelope,
          team_id: String(e['teamId']),
          quarter_id: String(e['quarterId']),
          capacity_baseline: Number(e['capacityBaseline']),
          capacity_adjustment: Number(e['capacityAdjustment'] ?? 0),
          adjustment_note: (e['adjustmentNote'] as string) ?? null,
          reserves_json: j(e['reserves'] ?? [])!,
          closed_at: (e['closedAt'] as string) ?? null,
          overflow_accepted_json: j(e['overflowAccepted']),
        };
      case 'commitment':
        return {
          ...envelope,
          name: String(e['name']),
          lifecycle: String(e['lifecycle']),
          prior_active_lifecycle: (e['priorActiveLifecycle'] as string) ?? null,
          class: String(e['class']),
          importance: String(e['importance']),
          primary_team_id: (e['primaryTeamId'] as string) ?? null,
          owner_json: j(e['ownerRef']),
          target_quarter_id: (e['targetQuarterId'] as string) ?? null,
          target_date: (e['targetDate'] as string) ?? null,
          size_confidence: (e['sizeConfidence'] as string) ?? null,
          timing_confidence: (e['timingConfidence'] as string) ?? null,
          scope_confidence: (e['scopeConfidence'] as string) ?? null,
          outcome: (e['outcome'] as string) ?? null,
          value_drivers_json: j(e['valueDrivers'] ?? [])!,
          attention_date: (e['attentionDate'] as string) ?? null,
          latest_safe_start: (e['latestSafeStart'] as string) ?? null,
          next_action: (e['nextAction'] as string) ?? null,
          next_action_owner_json: j(e['nextActionOwnerRef']),
          next_action_due_date: (e['nextActionDueDate'] as string) ?? null,
          management_note: (e['managementNote'] as string) ?? null,
          recurrence_json: j(e['recurrence']),
          renewed_from_commitment_id: (e['renewedFromCommitmentId'] as string) ?? null,
          committed_at: (e['committedAt'] as string) ?? null,
          committed_by: (e['committedBy'] as string) ?? null,
          units_at_commit: (e['unitsAtCommit'] as number) ?? null,
          last_meaningful_update_at: (e['lastMeaningfulUpdateAt'] as string) ?? null,
          last_reviewed_at: (e['lastReviewedAt'] as string) ?? null,
        };
      case 'product_service':
        return {
          ...envelope,
          name: String(e['name']),
          description: (e['description'] as string) ?? null,
          owner_json: j(e['ownerRef']),
          active: e['active'] ? 1 : 0,
        };
      case 'product_impact':
        return {
          ...envelope,
          commitment_id: String(e['commitmentId']),
          product_service_id: String(e['productServiceId']),
          type: String(e['type']),
          note: (e['note'] as string) ?? null,
        };
      case 'decision':
        return {
          ...envelope,
          kind: String(e['kind']),
          name: String(e['name']),
          owner_json: j(e['ownerRef']),
          needed_by: (e['neededBy'] as string) ?? null,
          status: String(e['status']),
          resolution_note: (e['resolutionNote'] as string) ?? null,
          resolved_at: (e['resolvedAt'] as string) ?? null,
        };
      case 'dependency': {
        // The target is a tagged union; stored as two columns so it can be
        // indexed, which a JSON blob could not be.
        const target = (e['target'] ?? {}) as { kind?: string; id?: string };
        return {
          ...envelope,
          source_commitment_id: String(e['sourceCommitmentId']),
          target_kind: String(target.kind),
          target_id: String(target.id),
          type: String(e['type']),
          owner_json: j(e['ownerRef']),
          needed_by: (e['neededBy'] as string) ?? null,
          status: String(e['status']),
          is_hard: e['isHard'] ? 1 : 0,
          note: (e['note'] as string) ?? null,
        };
      }
      case 'milestone':
        return {
          ...envelope,
          commitment_id: String(e['commitmentId']),
          name: String(e['name']),
          target_date: (e['targetDate'] as string) ?? null,
          status: String(e['status']),
          note: (e['note'] as string) ?? null,
          display_order: Number(e['displayOrder'] ?? 0),
        };
      case 'theme':
        return {
          ...envelope,
          name: String(e['name']),
          color_token: (e['colorToken'] as string) ?? null,
        };
      case 'commitment_theme':
        return {
          ...envelope,
          commitment_id: String(e['commitmentId']),
          theme_id: String(e['themeId']),
        };
      case 'person':
        return {
          ...envelope,
          display_name: String(e['displayName']),
          email: (e['email'] as string) ?? null,
          role_label: (e['roleLabel'] as string) ?? null,
          team_id: (e['teamId'] as string) ?? null,
          linked_user_id: (e['linkedUserId'] as string) ?? null,
        };
      case 'external_link':
        return {
          ...envelope,
          commitment_id: String(e['commitmentId']),
          type: String(e['type']),
          url: String(e['url']),
          label: (e['label'] as string) ?? null,
        };
      case 'signal_disposition':
        return {
          ...envelope,
          signal_key: String(e['signalKey']),
          disposition: String(e['disposition']),
          at_fingerprint: String(e['atFingerprint']),
          at_severity: String(e['atSeverity']),
          snooze_until: (e['snoozeUntil'] as string) ?? null,
          actor_id: String(e['actorId']),
          note: (e['note'] as string) ?? null,
        };
      case 'workspace_user':
        return {
          ...envelope,
          identity_subject: String(e['identitySubject']),
          display_name: String(e['displayName']),
          person_id: (e['personId'] as string) ?? null,
          role: String(e['role']),
        };
      case 'scenario':
        return {
          ...envelope,
          owner_user_id: String(e['ownerUserId']),
          name: String(e['name']),
          visibility: String(e['visibility']),
          base_revision: Number(e['baseRevision']),
          commands_json: j(e['commands'] ?? [])!,
          status: String(e['status']),
          applied_at: (e['appliedAt'] as string) ?? null,
          applied_by: (e['appliedBy'] as string) ?? null,
          applied_command_ids_json: j(e['appliedCommandIds']),
        };
      case 'capacity_footprint':
        return {
          ...envelope,
          commitment_id: String(e['commitmentId']),
          team_id: String(e['teamId']),
          quarter_id: String(e['quarterId']),
          units: Number(e['units']),
          size_at_creation: (e['sizeAtCreation'] as string) ?? null,
          units_source: String(e['unitsSource']),
          confidence: (e['confidence'] as string) ?? null,
          is_primary: e['isPrimary'] ? 1 : 0,
          carry_over_from_quarter_id: (e['carryOverFromQuarterId'] as string) ?? null,
          carry_over_from_footprint_id: (e['carryOverFromFootprintId'] as string) ?? null,
          closed_as_unfinished:
            e['closedAsUnfinished'] === undefined ? null : e['closedAsUnfinished'] ? 1 : 0,
        };
      default:
        throw new Error(`Unknown table ${table}`);
    }
  }

  async #writeEvent(event: DomainEvent): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO domain_event
       (id, workspace_id, sequence, occurred_at, actor_id, command_name, event_type,
        entity_refs_json, summary_key, facts_json, reason, scenario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.workspaceId,
        event.sequence,
        event.occurredAt,
        event.actorId,
        event.commandName,
        event.eventType,
        j(event.entityRefs)!,
        event.summaryKey,
        j(event.facts)!,
        event.reason ?? null,
        event.scenarioId ?? null,
      ],
    );
  }

  async #writeOutbox(input: ApplyInput, change: EntityChange): Promise<void> {
    const after = change.after as { visibility?: string } | undefined;
    if (change.ref.kind === 'SCENARIO' && after?.visibility === 'PRIVATE') return;
    await this.db.run(
      `INSERT OR IGNORE INTO outbox
       (id, workspace_id, command_id, batch_id, entity_ref_json, op, base_version,
        base_snapshot_json, changed_fields_json, patch_json, created_at, attempts, state,
        base_remote_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', ?)`,
      [
        `${input.command.id}:${refKey(change.ref)}`,
        input.workspaceId,
        input.command.id,
        input.command.batchId ?? null,
        j(change.ref)!,
        change.op,
        change.fromVersion ?? null,
        j(change.before),
        j(change.changedFields)!,
        j(change.after),
        input.command.issuedAt,
        (change.before as { remoteVersion?: string } | undefined)?.remoteVersion ?? null,
      ],
    );
  }

  // ── Readers ──────────────────────────────────────────────────────────────

  async #loadMap<T extends { id: string }>(
    table: string,
    workspaceId: WorkspaceId,
    map: (row: Record<string, SqlValue>) => T,
  ): Promise<Map<EntityId, T>> {
    const rows = await this.db.all(
      `SELECT * FROM ${table} WHERE workspace_id = ? AND deleted_at IS NULL`,
      [workspaceId],
    );
    return new Map(rows.map((row) => [String(row['id']), map(row)]));
  }

  #envelope(row: Record<string, SqlValue>) {
    return defined({
      id: String(row['id']),
      workspaceId: String(row['workspace_id'] ?? row['id']),
      schemaVersion: Number(row['schema_version']),
      entityVersion: Number(row['entity_version']),
      createdAt: String(row['created_at']),
      createdBy: String(row['created_by']),
      updatedAt: String(row['updated_at']),
      updatedBy: String(row['updated_by']),
      archivedAt: s(row['archived_at']),
      archivedBy: s(row['archived_by']),
      deletedAt: s(row['deleted_at']),
      remoteVersion: s(row['remote_version']),
    });
  }

  #toWorkspace(row: Record<string, SqlValue>): Workspace {
    return {
      ...this.#envelope(row),
      workspaceId: String(row['id']),
      name: String(row['name']),
      timezone: String(row['timezone']),
      currentQuarterId: String(row['current_quarter_id']) as Workspace['currentQuarterId'],
      isSample: Number(row['is_sample']) === 1,
      revision: Number(row['revision']),
      settings: p<Workspace['settings']>(row['settings_json'])!,
    } as Workspace;
  }

  #toTeam(row: Record<string, SqlValue>): Team {
    return defined({
      ...this.#envelope(row),
      name: String(row['name']),
      description: s(row['description']),
      defaultQuarterCapacity: Number(row['default_quarter_capacity']),
      displayOrder: Number(row['display_order']),
      active: Number(row['active']) === 1,
    }) as Team;
  }

  #toScenario(row: Record<string, SqlValue>): Scenario {
    return defined({
      ...this.#envelope(row),
      name: String(row['name']),
      ownerUserId: String(row['owner_user_id']),
      visibility: String(row['visibility']) as Scenario['visibility'],
      baseRevision: Number(row['base_revision']),
      commands: p<Scenario['commands']>(row['commands_json']) ?? [],
      status: String(row['status']) as Scenario['status'],
      appliedAt: s(row['applied_at']),
      appliedBy: s(row['applied_by']),
      appliedCommandIds: p<Scenario['appliedCommandIds']>(row['applied_command_ids_json']),
    }) as Scenario;
  }

  #toWorkspaceUser(row: Record<string, SqlValue>): WorkspaceUser {
    return defined({
      ...this.#envelope(row),
      identitySubject: String(row['identity_subject']),
      displayName: String(row['display_name']),
      personId: s(row['person_id']),
      role: String(row['role']) as WorkspaceUser['role'],
    }) as WorkspaceUser;
  }

  #toTeamQuarter(row: Record<string, SqlValue>): TeamQuarter {
    return defined({
      ...this.#envelope(row),
      teamId: String(row['team_id']),
      quarterId: String(row['quarter_id']) as TeamQuarter['quarterId'],
      capacityBaseline: Number(row['capacity_baseline']),
      capacityAdjustment: Number(row['capacity_adjustment']),
      adjustmentNote: s(row['adjustment_note']),
      reserves: p<TeamQuarter['reserves']>(row['reserves_json']) ?? [],
      closedAt: s(row['closed_at']),
      overflowAccepted: p<TeamQuarter['overflowAccepted']>(row['overflow_accepted_json']),
    }) as TeamQuarter;
  }

  #toCommitment(row: Record<string, SqlValue>): Commitment {
    return defined({
      ...this.#envelope(row),
      name: String(row['name']),
      lifecycle: String(row['lifecycle']) as Commitment['lifecycle'],
      priorActiveLifecycle: s(row['prior_active_lifecycle']) as Commitment['priorActiveLifecycle'],
      class: String(row['class']) as Commitment['class'],
      importance: String(row['importance']) as Commitment['importance'],
      primaryTeamId: s(row['primary_team_id']),
      ownerRef: p<Commitment['ownerRef']>(row['owner_json']),
      targetQuarterId: s(row['target_quarter_id']) as Commitment['targetQuarterId'],
      targetDate: s(row['target_date']),
      sizeConfidence: s(row['size_confidence']) as Commitment['sizeConfidence'],
      timingConfidence: s(row['timing_confidence']) as Commitment['timingConfidence'],
      scopeConfidence: s(row['scope_confidence']) as Commitment['scopeConfidence'],
      outcome: s(row['outcome']),
      valueDrivers: p<string[]>(row['value_drivers_json']) ?? [],
      attentionDate: s(row['attention_date']),
      latestSafeStart: s(row['latest_safe_start']),
      nextAction: s(row['next_action']),
      nextActionOwnerRef: p<Commitment['nextActionOwnerRef']>(row['next_action_owner_json']),
      nextActionDueDate: s(row['next_action_due_date']),
      managementNote: s(row['management_note']),
      recurrence: p<Commitment['recurrence']>(row['recurrence_json']),
      renewedFromCommitmentId: s(row['renewed_from_commitment_id']),
      committedAt: s(row['committed_at']),
      committedBy: s(row['committed_by']),
      unitsAtCommit: n(row['units_at_commit']),
      lastMeaningfulUpdateAt: s(row['last_meaningful_update_at']),
      lastReviewedAt: s(row['last_reviewed_at']),
    }) as Commitment;
  }

  #toFootprint(row: Record<string, SqlValue>): CapacityFootprint {
    return defined({
      ...this.#envelope(row),
      commitmentId: String(row['commitment_id']),
      teamId: String(row['team_id']),
      quarterId: String(row['quarter_id']) as CapacityFootprint['quarterId'],
      units: Number(row['units']),
      sizeAtCreation: s(row['size_at_creation']) as CapacityFootprint['sizeAtCreation'],
      unitsSource: String(row['units_source']) as CapacityFootprint['unitsSource'],
      confidence: s(row['confidence']) as CapacityFootprint['confidence'],
      isPrimary: Number(row['is_primary']) === 1,
      carryOverFromQuarterId: s(
        row['carry_over_from_quarter_id'],
      ) as CapacityFootprint['carryOverFromQuarterId'],
      carryOverFromFootprintId: s(row['carry_over_from_footprint_id']),
      closedAsUnfinished:
        row['closed_as_unfinished'] === null || row['closed_as_unfinished'] === undefined
          ? undefined
          : Number(row['closed_as_unfinished']) === 1,
    }) as CapacityFootprint;
  }

  // ── Relations ────────────────────────────────────────────────────────────

  #toProduct(row: Record<string, SqlValue>): ProductService {
    return defined({
      ...this.#envelope(row),
      name: String(row['name']),
      description: s(row['description']),
      ownerRef: p(row['owner_json']) as ProductService['ownerRef'],
      active: Number(row['active']) === 1,
    }) as ProductService;
  }

  #toImpact(row: Record<string, SqlValue>): ProductImpact {
    return defined({
      ...this.#envelope(row),
      commitmentId: String(row['commitment_id']),
      productServiceId: String(row['product_service_id']),
      type: String(row['type']) as ProductImpact['type'],
      note: s(row['note']),
    }) as ProductImpact;
  }

  #toDecision(row: Record<string, SqlValue>): Decision {
    return defined({
      ...this.#envelope(row),
      kind: String(row['kind']) as Decision['kind'],
      name: String(row['name']),
      ownerRef: p(row['owner_json']) as Decision['ownerRef'],
      neededBy: s(row['needed_by']),
      status: String(row['status']) as Decision['status'],
      resolutionNote: s(row['resolution_note']),
      resolvedAt: s(row['resolved_at']),
    }) as Decision;
  }

  #toDependency(row: Record<string, SqlValue>): Dependency {
    return defined({
      ...this.#envelope(row),
      sourceCommitmentId: String(row['source_commitment_id']),
      target: {
        kind: String(row['target_kind']),
        id: String(row['target_id']),
      } as Dependency['target'],
      type: String(row['type']) as Dependency['type'],
      ownerRef: p(row['owner_json']) as Dependency['ownerRef'],
      neededBy: s(row['needed_by']),
      status: String(row['status']) as Dependency['status'],
      isHard: Number(row['is_hard']) === 1,
      note: s(row['note']),
    }) as Dependency;
  }

  #toMilestone(row: Record<string, SqlValue>): Milestone {
    return defined({
      ...this.#envelope(row),
      commitmentId: String(row['commitment_id']),
      name: String(row['name']),
      targetDate: s(row['target_date']),
      status: String(row['status']) as Milestone['status'],
      note: s(row['note']),
      displayOrder: Number(row['display_order']),
    }) as Milestone;
  }

  #toTheme(row: Record<string, SqlValue>): Theme {
    return defined({
      ...this.#envelope(row),
      name: String(row['name']),
      colorToken: s(row['color_token']),
    }) as Theme;
  }

  #toCommitmentTheme(row: Record<string, SqlValue>): CommitmentTheme {
    return defined({
      ...this.#envelope(row),
      commitmentId: String(row['commitment_id']),
      themeId: String(row['theme_id']),
    }) as CommitmentTheme;
  }

  #toPerson(row: Record<string, SqlValue>): Person {
    return defined({
      ...this.#envelope(row),
      displayName: String(row['display_name']),
      email: s(row['email']),
      roleLabel: s(row['role_label']),
      teamId: s(row['team_id']),
      linkedUserId: s(row['linked_user_id']),
    }) as Person;
  }

  #toDisposition(row: Record<string, SqlValue>): SignalDisposition {
    return defined({
      ...this.#envelope(row),
      signalKey: String(row['signal_key']),
      disposition: String(row['disposition']) as SignalDisposition['disposition'],
      atFingerprint: String(row['at_fingerprint']),
      atSeverity: String(row['at_severity']) as SignalDisposition['atSeverity'],
      snoozeUntil: s(row['snooze_until']),
      actorId: String(row['actor_id']),
      note: s(row['note']),
    }) as SignalDisposition;
  }

  #toLink(row: Record<string, SqlValue>): ExternalLink {
    return defined({
      ...this.#envelope(row),
      commitmentId: String(row['commitment_id']),
      type: String(row['type']) as ExternalLink['type'],
      url: String(row['url']),
      label: s(row['label']),
    }) as ExternalLink;
  }
}
