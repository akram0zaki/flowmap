/**
 * In-memory WorkspaceProvider with injectable faults.
 *
 * Used by the contract suite and the multi-client harness. It is a complete
 * provider — not a stub — so the same tests run against Local, File, and this.
 *
 * See docs/spec/08-providers.md §1.
 */

import type { EntityId, EntityRef, WorkspaceId } from '@flowmap/domain';
import { refKey } from '@flowmap/domain';

import type {
  MutationBatch,
  PortableWorkspaceBytes,
  ProviderCapabilities,
  ProviderHealth,
  PullPage,
  PushOperationResult,
  PushResult,
  SyncCursor,
  VersionedEntity,
  WorkspaceProvider,
} from './contracts.js';
import { ProviderError } from './contracts.js';

export type FakeProviderFaults = {
  throttle?: boolean;
  unavailable?: boolean;
  cursorExpired?: boolean;
  forbidden?: boolean;
  schemaAhead?: boolean;
  retryAfterMs?: number;
};

type Stored = {
  entityRef: EntityRef;
  entityVersion: number;
  remoteVersion: string;
  deleted: boolean;
  payload?: unknown;
  seq: number;
};

export class FakeProvider implements WorkspaceProvider {
  readonly id = 'LOCAL' as const;

  readonly capabilities: ProviderCapabilities = {
    shared: true,
    serverVersioning: true,
    entityLevelWrites: true,
    deltaQuery: true,
    tombstones: true,
    transactional: true,
    maxBatchOperations: 200,
    maxRequestsPerMinute: null,
    provisioning: 'AUTOMATIC',
  };

  faults: FakeProviderFaults = {};

  #seq = 0;
  #entities = new Map<string, Stored>();
  #operations = new Map<EntityId, string>();
  #names = new Map<WorkspaceId, string>();
  #clock: () => string;

  constructor(clock: () => string = () => '2026-08-17T09:00:00Z') {
    this.#clock = clock;
  }

  async health(): Promise<ProviderHealth> {
    this.#failIf();
    return { reachable: true, lastCheckedAt: this.#clock(), shareMode: 'WRITABLE' };
  }

  async listWorkspaces(): Promise<Array<{ id: WorkspaceId; name: string }>> {
    this.#failIf();
    return [...this.#names].map(([id, name]) => ({ id, name }));
  }

  async provision(workspaceId: WorkspaceId, _schemaVersion?: number): Promise<{ ok: boolean }> {
    this.#failIf();
    if (!this.#names.has(workspaceId)) this.#names.set(workspaceId, workspaceId);
    return { ok: true };
  }

  async pull(
    workspaceId: WorkspaceId,
    cursor: SyncCursor | null,
    opts: { pageSize?: number } = {},
  ): Promise<PullPage> {
    this.#failIf();
    if (this.faults.cursorExpired && cursor !== null) {
      throw new ProviderError('CURSOR_EXPIRED', 'The pull cursor is no longer valid.');
    }
    const pageSize = opts.pageSize ?? 200;
    const after = cursor === null ? 0 : Number(cursor);
    const prefix = `${workspaceId}:`;
    const rows = [...this.#entities.entries()]
      .filter(([key, row]) => key.startsWith(prefix) && row.seq > after)
      .map(([, row]) => row)
      .sort((a, b) => a.seq - b.seq);
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    return {
      changes: page.map((row) => ({
        entityRef: row.entityRef,
        entityVersion: row.entityVersion,
        remoteVersion: row.remoteVersion,
        deleted: row.deleted,
        ...(row.payload !== undefined ? { payload: row.payload } : {}),
      })),
      cursor: String(page.at(-1)?.seq ?? after),
      hasMore,
      serverTime: this.#clock(),
    };
  }

  async push(workspaceId: WorkspaceId, batch: MutationBatch): Promise<PushResult> {
    this.#failIf();
    const results: PushOperationResult[] = [];
    for (const op of batch.operations) {
      const seen = this.#operations.get(op.operationId);
      if (seen !== undefined) {
        results.push({ operationId: op.operationId, status: 'DUPLICATE', newVersion: seen });
        continue;
      }
      const key = `${workspaceId}:${refKey(op.entityRef)}`;
      const current = this.#entities.get(key);
      if (current && op.baseVersion !== undefined && current.remoteVersion !== op.baseVersion) {
        results.push({
          operationId: op.operationId,
          status: 'CONFLICT',
          remoteVersion: current.remoteVersion,
          remoteEntity: current.payload ?? null,
        });
        continue;
      }
      this.#seq += 1;
      const version = `v${this.#seq}`;
      const entityVersion =
        typeof (op.patch as { entityVersion?: number } | null)?.entityVersion === 'number'
          ? (op.patch as { entityVersion: number }).entityVersion
          : (current?.entityVersion ?? 0) + 1;
      this.#entities.set(key, {
        entityRef: op.entityRef,
        entityVersion,
        remoteVersion: version,
        deleted: op.op === 'DELETE',
        ...(op.op === 'DELETE' ? {} : { payload: op.patch }),
        seq: this.#seq,
      });
      this.#operations.set(op.operationId, version);
      results.push({ operationId: op.operationId, status: 'APPLIED', newVersion: version });
    }
    return { results };
  }

  async getEntity(workspaceId: WorkspaceId, ref: EntityRef): Promise<VersionedEntity | null> {
    this.#failIf();
    const row = this.#entities.get(`${workspaceId}:${refKey(ref)}`);
    return row === undefined
      ? null
      : {
          entityRef: row.entityRef,
          entityVersion: row.entityVersion,
          remoteVersion: row.remoteVersion,
          deleted: row.deleted,
          ...(row.payload !== undefined ? { payload: row.payload } : {}),
        };
  }

  async exportPortable(workspaceId: WorkspaceId): Promise<PortableWorkspaceBytes> {
    this.#failIf();
    const rows = [...this.#entities.entries()]
      .filter(([key]) => key.startsWith(`${workspaceId}:`))
      .map(([, row]) => row);
    const bytes = new TextEncoder().encode(JSON.stringify({ workspaceId, rows }));
    return { bytes, workspaceId, formatVersion: 1, schemaVersion: 1 };
  }

  async importPortable(pkg: PortableWorkspaceBytes): Promise<WorkspaceId> {
    this.#failIf();
    const parsed = JSON.parse(new TextDecoder().decode(pkg.bytes)) as {
      workspaceId: WorkspaceId;
      rows: Stored[];
    };
    await this.provision(parsed.workspaceId);
    for (const row of parsed.rows) {
      this.#seq = Math.max(this.#seq, row.seq);
      this.#entities.set(`${parsed.workspaceId}:${refKey(row.entityRef)}`, row);
    }
    return parsed.workspaceId;
  }

  #failIf(): void {
    if (this.faults.unavailable) {
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'The shared store is not reachable.');
    }
    if (this.faults.forbidden) {
      throw new ProviderError('FORBIDDEN', 'The shared file is not writable.');
    }
    if (this.faults.schemaAhead) {
      throw new ProviderError('SCHEMA_VERSION_TOO_NEW', 'Remote schema is newer than this build.');
    }
    if (this.faults.throttle) {
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        'The provider asked us to wait.',
        this.faults.retryAfterMs !== undefined ? { retryAfterMs: this.faults.retryAfterMs } : {},
      );
    }
  }
}
