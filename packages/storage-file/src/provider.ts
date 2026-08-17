/**
 * File provider — the shared WorkspaceProvider.
 *
 * A versioned `.flowmap` document in a folder the team can already reach.
 * Write protocol: read → version check → serialise → fsync → atomic replace.
 * Never a shared SQLite file.
 *
 * See docs/spec/08-providers.md §3.
 */

import type { EntityRef, WorkspaceId } from '@flowmap/domain';
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
} from '@flowmap/storage';
import { ProviderError } from '@flowmap/storage';

import { detectConflictCopies, isConflictCopyName } from './conflict-copies.js';
import {
  decodeDocument,
  emptyDocument,
  encodeDocument,
  upsertEntity,
  type FileDocument,
  type StoredEntity,
} from './document.js';
import { readMaterialised, type FileSystemAdapter } from './filesystem.js';

export type FileProviderOptions = {
  readonly fs: FileSystemAdapter;
  readonly path: string;
  readonly writerId: string;
  readonly clock?: () => string;
};

export class FileProvider implements WorkspaceProvider {
  readonly id = 'FILE' as const;

  readonly capabilities: ProviderCapabilities = {
    shared: true,
    serverVersioning: true,
    entityLevelWrites: false,
    deltaQuery: false,
    tombstones: true,
    transactional: true,
    maxBatchOperations: 500,
    maxRequestsPerMinute: null,
    provisioning: 'AUTOMATIC',
  };

  readonly #fs: FileSystemAdapter;
  readonly #path: string;
  readonly #writerId: string;
  readonly #clock: () => string;
  #seen = false;

  constructor(options: FileProviderOptions) {
    this.#fs = options.fs;
    this.#path = options.path;
    this.#writerId = options.writerId;
    this.#clock = options.clock ?? (() => options.fs.now());
  }

  async health(): Promise<ProviderHealth> {
    const info = await this.#fs.stat(this.#path);
    const copies = detectConflictCopies(
      this.#path,
      await this.#fs.list(dirname(this.#path)),
      this.#clock(),
    );
    if (!info.exists) {
      return {
        reachable: this.#seen ? false : true,
        lastCheckedAt: this.#clock(),
        shareMode: this.#seen ? 'VANISHED' : 'WRITABLE',
        conflictCopies: copies,
        ...(this.#seen ? { detail: 'The shared file is no longer in this folder.' } : {}),
      };
    }
    this.#seen = true;
    if (info.placeholder) {
      try {
        await this.#fs.materialize(this.#path);
      } catch (error) {
        return {
          reachable: false,
          lastCheckedAt: this.#clock(),
          shareMode: 'WRITABLE',
          conflictCopies: copies,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      reachable: true,
      lastCheckedAt: this.#clock(),
      shareMode: info.writable ? 'WRITABLE' : 'READ_ONLY',
      conflictCopies: copies,
      ...(info.writable
        ? {
            detail:
              'Changes appear for others after each save and may take a few minutes to propagate.',
          }
        : { detail: 'This shared file is read-only. Local work is kept and can be exported.' }),
    };
  }

  async listWorkspaces(): Promise<Array<{ id: WorkspaceId; name: string }>> {
    const listing = await this.#fs.list(dirname(this.#path));
    const found: Array<{ id: WorkspaceId; name: string }> = [];
    for (const file of listing) {
      if (!file.name.endsWith('.flowmap') || isConflictCopyName(file.name)) continue;
      try {
        const { bytes } = await readMaterialised(this.#fs, file.path);
        const doc = decodeDocument(bytes);
        found.push({ id: doc.workspaceId, name: file.name.replace(/\.flowmap$/i, '') });
      } catch {
        // A half-written or unrelated zip is not a workspace.
      }
    }
    return found;
  }

  async provision(workspaceId: WorkspaceId, _schemaVersion?: number): Promise<{ ok: boolean }> {
    const info = await this.#fs.stat(this.#path);
    if (!info.exists) {
      await this.#fs.writeAtomic(
        this.#path,
        encodeDocument(emptyDocument(workspaceId, this.#clock())),
      );
    }
    this.#seen = true;
    return { ok: true };
  }

  async pull(
    workspaceId: WorkspaceId,
    cursor: SyncCursor | null,
    opts: { pageSize?: number } = {},
  ): Promise<PullPage> {
    const { doc, token } = await this.#load();
    if (doc.workspaceId !== workspaceId) {
      throw new ProviderError('NOT_FOUND', 'The shared document belongs to a different workspace.');
    }
    const pageSize = opts.pageSize ?? 200;
    const parsed = parseCursor(cursor);
    if (parsed && parsed.token !== token) {
      throw new ProviderError(
        'CURSOR_EXPIRED',
        'The shared document changed; starting a full pull.',
      );
    }
    const rows = entitiesAsChanges(doc, token);
    const offset = parsed?.offset ?? 0;
    const slice = rows.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < rows.length;
    return {
      changes: slice,
      cursor: `${token}:${nextOffset}`,
      hasMore,
      serverTime: doc.sync.writtenAt || this.#clock(),
    };
  }

  async push(workspaceId: WorkspaceId, batch: MutationBatch): Promise<PushResult> {
    const health = await this.health();
    if (health.shareMode === 'READ_ONLY') {
      throw new ProviderError('FORBIDDEN', 'The shared file is not writable.');
    }
    if (health.shareMode === 'VANISHED') {
      throw new ProviderError('NOT_FOUND', 'The shared file is no longer in this folder.');
    }

    const { doc, token } = await this.#load();
    if (doc.workspaceId !== workspaceId) {
      throw new ProviderError('NOT_FOUND', 'The shared document belongs to a different workspace.');
    }

    const results: PushOperationResult[] = [];
    let next = doc;
    const now = this.#clock();

    for (const op of batch.operations) {
      const seen = next.sync.appliedOperations[op.operationId];
      if (seen !== undefined) {
        results.push({ operationId: op.operationId, status: 'DUPLICATE', newVersion: seen });
        continue;
      }
      const key = refKey(op.entityRef);
      const current = next.entities[key];
      if (current && op.baseVersion !== undefined && op.baseVersion !== token) {
        results.push({
          operationId: op.operationId,
          status: 'CONFLICT',
          remoteVersion: token,
          remoteEntity: current.deleted ? null : (current.payload ?? null),
        });
        continue;
      }
      const version = `doc:${next.sync.revision + 1}`;
      const entityVersion =
        typeof (op.patch as { entityVersion?: number } | null)?.entityVersion === 'number'
          ? (op.patch as { entityVersion: number }).entityVersion
          : (current?.entityVersion ?? 0) + 1;
      const stored: StoredEntity = {
        entityRef: op.entityRef,
        entityVersion,
        deleted: op.op === 'DELETE',
        ...(op.op === 'DELETE' ? {} : { payload: op.patch }),
      };
      next = upsertEntity(next, stored, op.operationId, version, this.#writerId, now);
      results.push({ operationId: op.operationId, status: 'APPLIED', newVersion: token });
    }

    const applied = results.some((item) => item.status === 'APPLIED');
    if (applied) {
      try {
        const newToken = await this.#fs.writeAtomic(this.#path, encodeDocument(next), token);
        return {
          results: results.map((item) =>
            item.status === 'APPLIED' ? { ...item, newVersion: newToken } : item,
          ),
        };
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'CONFLICT') {
          return {
            results: batch.operations.map((op) => ({
              operationId: op.operationId,
              status: 'CONFLICT' as const,
              remoteVersion: token,
              remoteEntity: next.entities[refKey(op.entityRef)]?.payload ?? null,
            })),
          };
        }
        throw error;
      }
    }

    return { results };
  }

  async getEntity(workspaceId: WorkspaceId, ref: EntityRef): Promise<VersionedEntity | null> {
    const { doc, token } = await this.#load();
    if (doc.workspaceId !== workspaceId) return null;
    const row = doc.entities[refKey(ref)];
    if (!row) return null;
    return {
      entityRef: row.entityRef,
      entityVersion: row.entityVersion,
      remoteVersion: token,
      deleted: row.deleted,
      ...(row.payload !== undefined ? { payload: row.payload } : {}),
    };
  }

  async exportPortable(workspaceId: WorkspaceId): Promise<PortableWorkspaceBytes> {
    const { bytes } = await readMaterialised(this.#fs, this.#path);
    const doc = decodeDocument(bytes);
    return {
      bytes,
      workspaceId: doc.workspaceId || workspaceId,
      formatVersion: doc.formatVersion,
      schemaVersion: doc.sync.schemaVersion,
    };
  }

  async importPortable(pkg: PortableWorkspaceBytes): Promise<WorkspaceId> {
    await this.#fs.writeAtomic(this.#path, pkg.bytes);
    this.#seen = true;
    return decodeDocument(pkg.bytes).workspaceId;
  }

  async mergeConflictCopy(copyPath: string): Promise<FileDocument> {
    const main = await this.#load();
    const copy = decodeDocument((await readMaterialised(this.#fs, copyPath)).bytes);
    let merged = main.doc;
    const now = this.#clock();
    for (const [key, entity] of Object.entries(copy.entities)) {
      if (merged.entities[key] === undefined) {
        merged = upsertEntity(
          merged,
          entity,
          `copy:${key}`,
          `doc:${merged.sync.revision + 1}`,
          this.#writerId,
          now,
        );
      }
    }
    await this.#fs.writeAtomic(this.#path, encodeDocument(merged), main.token);
    return merged;
  }

  async discardConflictCopy(copyPath: string): Promise<void> {
    await this.#fs.writeAtomic(copyPath, new Uint8Array(), undefined);
  }

  async #load(): Promise<{ doc: FileDocument; token: string }> {
    const info = await this.#fs.stat(this.#path);
    if (!info.exists) {
      throw new ProviderError('NOT_FOUND', 'The shared document has not been provisioned.');
    }
    const { bytes, token } = await readMaterialised(this.#fs, this.#path);
    this.#seen = true;
    return { doc: decodeDocument(bytes), token };
  }
}

function entitiesAsChanges(doc: FileDocument, token: string): VersionedEntity[] {
  const rows = Object.values(doc.entities)
    .map((row) => ({
      entityRef: row.entityRef,
      entityVersion: row.entityVersion,
      remoteVersion: token,
      deleted: row.deleted,
      ...(row.payload !== undefined ? { payload: row.payload } : {}),
    }))
    .sort((a, b) => refKey(a.entityRef).localeCompare(refKey(b.entityRef)));
  return rows;
}

function parseCursor(cursor: SyncCursor | null): { token: string; offset: number } | null {
  if (cursor === null) return null;
  const split = cursor.lastIndexOf(':');
  if (split <= 0) return { token: cursor, offset: 0 };
  return { token: cursor.slice(0, split), offset: Number(cursor.slice(split + 1)) || 0 };
}

function dirname(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '.';
}
