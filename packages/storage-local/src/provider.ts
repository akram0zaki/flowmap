/**
 * The Local provider.
 *
 * Backed by a separate `origin_*` schema in the same database, so a single-user
 * local workspace exercises the *full* sync path — outbox, push, pull, cursor,
 * conflict — from M1 onward.
 *
 * That is deliberate. The alternative is a sync engine whose first real exercise
 * is the day a second person opens a shared folder, which is the worst possible
 * moment to discover it is wrong.
 */

import type { WorkspaceId } from '@flowmap/domain';
import { refKey } from '@flowmap/domain';
import type {
  MutationBatch,
  ProviderCapabilities,
  ProviderHealth,
  PullPage,
  PushOperationResult,
  PushResult,
  SyncCursor,
  WorkspaceProvider,
} from '@flowmap/storage';

import type { SqlDriver, SqlValue } from './driver.js';

const ORIGIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS origin_entity (
  workspace_id   TEXT NOT NULL,
  ref_key        TEXT NOT NULL,
  entity_ref_json TEXT NOT NULL,
  entity_version INTEGER NOT NULL,
  remote_version TEXT NOT NULL,
  deleted        INTEGER NOT NULL DEFAULT 0,
  payload_json   TEXT,
  updated_seq    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, ref_key)
);

CREATE TABLE IF NOT EXISTS origin_operation (
  operation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ref_key      TEXT NOT NULL,
  new_version  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS origin_seq (
  workspace_id TEXT PRIMARY KEY,
  value        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_origin_seq ON origin_entity(workspace_id, updated_seq);
`;

export class LocalProvider implements WorkspaceProvider {
  readonly id = 'LOCAL' as const;

  readonly capabilities: ProviderCapabilities = {
    shared: false,
    serverVersioning: true,
    entityLevelWrites: true,
    deltaQuery: true,
    tombstones: true,
    transactional: true,
    maxBatchOperations: 500,
    provisioning: 'AUTOMATIC',
  };

  private constructor(private readonly db: SqlDriver) {}

  static async open(db: SqlDriver): Promise<LocalProvider> {
    for (const statement of ORIGIN_SCHEMA.split(';')) {
      const trimmed = statement.trim();
      if (trimmed) await db.exec(trimmed);
    }
    return new LocalProvider(db);
  }

  async health(): Promise<ProviderHealth> {
    return { reachable: true, lastCheckedAt: new Date(0).toISOString(), detail: 'local' };
  }

  async listWorkspaces(): Promise<Array<{ id: WorkspaceId; name: string }>> {
    return (
      await this.db.all<{ id: string; name: string }>(
        'SELECT id, name FROM workspace WHERE deleted_at IS NULL',
      )
    ).map((row) => ({ id: String(row.id), name: String(row.name) }));
  }

  async provision(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async pull(
    workspaceId: WorkspaceId,
    cursor: SyncCursor | null,
    opts: { pageSize?: number } = {},
  ): Promise<PullPage> {
    const pageSize = opts.pageSize ?? 200;
    const after = cursor === null ? 0 : Number(cursor);

    const rows = await this.db.all(
      `SELECT entity_ref_json, entity_version, remote_version, deleted, payload_json, updated_seq
       FROM origin_entity
       WHERE workspace_id = ? AND updated_seq > ?
       ORDER BY updated_seq
       LIMIT ?`,
      [workspaceId, after, pageSize + 1],
    );

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;

    return {
      changes: page.map((row) => ({
        entityRef: JSON.parse(String(row['entity_ref_json'])),
        entityVersion: Number(row['entity_version']),
        remoteVersion: String(row['remote_version']),
        deleted: Number(row['deleted']) === 1,
        ...(row['payload_json'] ? { payload: JSON.parse(String(row['payload_json'])) } : {}),
      })),
      // The cursor advances only across a fully applied page, so an interrupted
      // pull resumes with no gap and no duplicate.
      cursor: String(page.at(-1)?.['updated_seq'] ?? after),
      hasMore,
    };
  }

  /**
   * Idempotent by `operationId`: a retried batch after a timeout returns
   * `DUPLICATE`, which the sync engine treats as success. Repeated pushes never
   * double-apply.
   */
  async push(workspaceId: WorkspaceId, batch: MutationBatch): Promise<PushResult> {
    const results: PushOperationResult[] = [];

    await this.db.transaction(async () => {
      for (const op of batch.operations) {
        const key = refKey(op.entityRef);

        const seen = await this.db.get<{ new_version: string }>(
          'SELECT new_version FROM origin_operation WHERE operation_id = ?',
          [op.operationId],
        );
        if (seen) {
          results.push({
            operationId: op.operationId,
            status: 'DUPLICATE',
            newVersion: String(seen.new_version),
          });
          continue;
        }

        const current = await this.db.get<{ remote_version: string; payload_json: string | null }>(
          'SELECT remote_version, payload_json FROM origin_entity WHERE workspace_id = ? AND ref_key = ?',
          [workspaceId, key],
        );

        if (
          current &&
          op.baseVersion !== undefined &&
          String(current.remote_version) !== op.baseVersion
        ) {
          results.push({
            operationId: op.operationId,
            status: 'CONFLICT',
            remoteVersion: String(current.remote_version),
            remoteEntity: current.payload_json ? JSON.parse(String(current.payload_json)) : null,
          });
          continue;
        }

        const seq = await this.#nextSeq(workspaceId);
        const version = `v${seq}`;
        const entityVersion =
          typeof (op.patch as { entityVersion?: number })?.entityVersion === 'number'
            ? (op.patch as { entityVersion: number }).entityVersion
            : 1;

        await this.db.run(
          `INSERT OR REPLACE INTO origin_entity
           (workspace_id, ref_key, entity_ref_json, entity_version, remote_version, deleted, payload_json, updated_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            workspaceId,
            key,
            JSON.stringify(op.entityRef),
            entityVersion,
            version,
            op.op === 'DELETE' ? 1 : 0,
            op.op === 'DELETE' ? null : JSON.stringify(op.patch),
            seq,
          ] as SqlValue[],
        );
        await this.db.run(
          'INSERT INTO origin_operation (operation_id, workspace_id, ref_key, new_version) VALUES (?, ?, ?, ?)',
          [op.operationId, workspaceId, key, version],
        );

        results.push({ operationId: op.operationId, status: 'APPLIED', newVersion: version });
      }
    });

    return { results };
  }

  async #nextSeq(workspaceId: WorkspaceId): Promise<number> {
    const row = await this.db.get<{ value: number }>(
      'SELECT value FROM origin_seq WHERE workspace_id = ?',
      [workspaceId],
    );
    const next = Number(row?.value ?? 0) + 1;
    await this.db.run('INSERT OR REPLACE INTO origin_seq (workspace_id, value) VALUES (?, ?)', [
      workspaceId,
      next,
    ]);
    return next;
  }
}
