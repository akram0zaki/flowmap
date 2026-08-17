/**
 * Background reconciliation with a WorkspaceProvider.
 *
 * The UI never reads the provider. This engine pulls remote facts into the
 * local cache, pushes the outbox, and records field-level conflicts. Time and
 * ids are injected so the loop is reproducible in tests.
 *
 * See docs/spec/07-persistence-sync.md §4–§7.
 */

import type { EntityId, EntityRef, WorkspaceId } from '@flowmap/domain';
import { refKey } from '@flowmap/domain';

import type {
  ConflictCopy,
  ConflictRecord,
  MutationOperation,
  OutboxEntry,
  ProviderHealth,
  RemoteEntityChange,
  ShareMode,
  SyncStatus,
  WorkspaceProvider,
  WorkspaceRepository,
} from './contracts.js';
import { ProviderError } from './contracts.js';
import { mergeEntity } from './merge.js';

const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const DEFAULT_PAGE = 200;

export type SyncClock = { now(): string };
export type SyncIds = { next(): string };
export type SyncSleep = (ms: number) => Promise<void>;

export type SyncEngineOptions = {
  readonly repository: WorkspaceRepository;
  readonly provider: WorkspaceProvider;
  readonly clock: SyncClock;
  readonly ids: SyncIds;
  readonly sleep?: SyncSleep;
  readonly random?: () => number;
};

export class SyncEngine {
  readonly #repository: WorkspaceRepository;
  readonly #provider: WorkspaceProvider;
  readonly #clock: SyncClock;
  readonly #ids: SyncIds;
  readonly #sleep: SyncSleep;
  readonly #random: () => number;
  #backoffMs = BACKOFF_START_MS;

  constructor(options: SyncEngineOptions) {
    this.#repository = options.repository;
    this.#provider = options.provider;
    this.#clock = options.clock;
    this.#ids = options.ids;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#random = options.random ?? (() => 0.5);
  }

  async status(workspaceId: WorkspaceId): Promise<SyncStatus> {
    const stored = await this.#repository.getSyncState(workspaceId);
    const pending = await this.#repository.listOutbox(workspaceId, 'PENDING');
    const inFlight = await this.#repository.listOutbox(workspaceId, 'IN_FLIGHT');
    const conflicts = (await this.#repository.listConflicts(workspaceId)).filter(
      (row) => row.resolvedAt === undefined,
    );
    let health: ProviderHealth;
    try {
      health = await this.#provider.health();
    } catch (error) {
      health = {
        reachable: false,
        lastCheckedAt: this.#clock.now(),
        detail: error instanceof Error ? error.message : String(error),
        shareMode: stored?.shareMode ?? 'VANISHED',
      };
    }
    return toStatus(stored, this.#provider, health, pending.length + inFlight.length, conflicts);
  }

  /**
   * One pull-then-push cycle. An interrupted pull leaves the cursor on the last
   * fully applied page, so the next call resumes without gaps or duplicates.
   */
  async sync(workspaceId: WorkspaceId): Promise<SyncStatus> {
    const stored = await this.#repository.getSyncState(workspaceId);
    let health: ProviderHealth;
    try {
      health = await this.#provider.health();
    } catch (error) {
      await this.#persistState(workspaceId, stored, {
        shareMode: 'VANISHED',
        detail: error instanceof Error ? error.message : String(error),
      });
      return this.status(workspaceId);
    }

    if (!health.reachable || health.shareMode === 'VANISHED') {
      await this.#persistState(workspaceId, stored, {
        shareMode: health.shareMode ?? 'VANISHED',
        ...(health.detail !== undefined ? { detail: health.detail } : {}),
      });
      return this.status(workspaceId);
    }

    try {
      await this.#pullAll(workspaceId, stored?.pullCursor ?? null);
      await this.#persistState(workspaceId, stored, {
        lastPullAt: this.#clock.now(),
        lastKnownRemoteAt: this.#clock.now(),
        shareMode: health.shareMode ?? 'WRITABLE',
      });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'CURSOR_EXPIRED') {
        await this.#pullAll(workspaceId, null);
      } else {
        await this.#persistState(workspaceId, stored, {
          shareMode: health.shareMode ?? 'WRITABLE',
          detail: error instanceof Error ? error.message : String(error),
        });
        return this.status(workspaceId);
      }
    }

    if (health.shareMode !== 'READ_ONLY') {
      try {
        await this.#pushPending(workspaceId);
        const latest = await this.#repository.getSyncState(workspaceId);
        await this.#persistState(workspaceId, latest, {
          lastPushAt: this.#clock.now(),
          lastKnownRemoteAt: this.#clock.now(),
          shareMode: 'WRITABLE',
        });
        this.#backoffMs = BACKOFF_START_MS;
      } catch (error) {
        if (isUnavailable(error)) {
          const retryAfter = retryAfterMs(error);
          await this.#sleep(retryAfter ?? this.#nextBackoff());
        }
        const latest = await this.#repository.getSyncState(workspaceId);
        await this.#persistState(workspaceId, latest, {
          shareMode: health.shareMode ?? 'WRITABLE',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      await this.#persistState(workspaceId, stored, { shareMode: 'READ_ONLY' });
    }

    return this.status(workspaceId);
  }

  async #pullAll(workspaceId: WorkspaceId, start: string | null): Promise<void> {
    let cursor = start;
    let hasMore = true;
    while (hasMore) {
      const page = await this.#provider.pull(workspaceId, cursor, { pageSize: DEFAULT_PAGE });
      await this.#applyPage(workspaceId, page.changes);
      cursor = page.cursor;
      hasMore = page.hasMore;
      const stored = await this.#repository.getSyncState(workspaceId);
      await this.#persistState(workspaceId, stored, {
        pullCursor: cursor,
        lastKnownRemoteAt: page.serverTime,
      });
    }
  }

  async #applyPage(
    workspaceId: WorkspaceId,
    changes: readonly RemoteEntityChange[],
  ): Promise<void> {
    const pending = [
      ...(await this.#repository.listOutbox(workspaceId, 'PENDING')),
      ...(await this.#repository.listOutbox(workspaceId, 'IN_FLIGHT')),
      ...(await this.#repository.listOutbox(workspaceId, 'CONFLICT')),
    ];
    const pendingByRef = new Map<string, OutboxEntry[]>();
    for (const entry of pending) {
      const key = refKey(entry.entityRef);
      const list = pendingByRef.get(key) ?? [];
      list.push(entry);
      pendingByRef.set(key, list);
    }

    const apply: RemoteEntityChange[] = [];
    const conflicts: ConflictRecord[] = [];
    const failed: EntityId[] = [];
    const now = this.#clock.now();

    for (const change of changes) {
      const locals = pendingByRef.get(refKey(change.entityRef)) ?? [];
      if (locals.length === 0) {
        apply.push(change);
        continue;
      }
      for (const local of locals) {
        const decision = mergeEntity({
          baseSnapshot: local.baseSnapshot,
          localPatch: local.patch,
          localChanged: local.changedFields,
          remoteEntity: change.payload,
          remoteDeleted: change.deleted,
        });
        if (decision.kind === 'AUTO') {
          apply.push({
            ...change,
            payload: decision.merged,
            deleted: false,
          });
          await this.#repository.rebaseOutbox([local.id], change.remoteVersion, decision.merged);
        } else if (decision.kind === 'TOMBSTONE') {
          apply.push({ ...change, deleted: true });
          failed.push(local.id);
          conflicts.push(
            conflictRow(
              this.#ids.next(),
              workspaceId,
              local.entityRef,
              '*',
              local.patch,
              null,
              now,
              {
                remoteVersion: change.remoteVersion,
                ...(local.baseVersion !== undefined ? { localVersion: local.baseVersion } : {}),
              },
            ),
          );
        } else {
          for (const field of decision.fields) {
            conflicts.push(
              conflictRow(
                this.#ids.next(),
                workspaceId,
                local.entityRef,
                field.field,
                field.localValue,
                field.remoteValue,
                now,
                {
                  remoteVersion: change.remoteVersion,
                  ...(local.baseVersion !== undefined ? { localVersion: local.baseVersion } : {}),
                },
              ),
            );
          }
          await this.#repository.markOutbox([local.id], 'CONFLICT', 'Overlapping field change');
        }
      }
    }

    if (apply.length > 0) await this.#repository.applyRemote({ workspaceId, changes: apply });
    if (conflicts.length > 0) await this.#repository.saveConflicts(workspaceId, conflicts);
    if (failed.length > 0) {
      await this.#repository.markOutbox(
        failed,
        'FAILED',
        'The entity was deleted on the shared document.',
      );
    }
  }

  async #pushPending(workspaceId: WorkspaceId): Promise<void> {
    const pending = await this.#repository.listOutbox(workspaceId, 'PENDING');
    if (pending.length === 0) return;

    const grouped = groupByEntity(pending);
    const operations: MutationOperation[] = [];
    for (const entries of grouped.values()) {
      for (const entry of entries) {
        operations.push({
          operationId: entry.commandId,
          entityRef: entry.entityRef,
          op: entry.op,
          changedFields: entry.changedFields,
          patch: entry.patch,
          ...(entry.baseRemoteVersion !== undefined
            ? { baseVersion: entry.baseRemoteVersion }
            : entry.baseVersion !== undefined
              ? { baseVersion: String(entry.baseVersion) }
              : {}),
        });
      }
    }

    const limit = this.#provider.capabilities.maxBatchOperations;
    for (let index = 0; index < operations.length; index += limit) {
      const slice = operations.slice(index, index + limit);
      const ids = slice.map((op) => matchingOutboxId(pending, op.operationId, op.entityRef));
      await this.#repository.markOutbox(ids, 'IN_FLIGHT');
      const result = await this.#provider.push(workspaceId, {
        batchId: this.#ids.next(),
        operations: slice,
      });
      for (const item of result.results) {
        const id = matchingOutboxId(pending, item.operationId, findRef(slice, item.operationId));
        if (item.status === 'APPLIED' || item.status === 'DUPLICATE') {
          await this.#repository.markOutbox([id], 'ACKED');
        } else if (item.status === 'REJECTED') {
          await this.#repository.markOutbox([id], 'FAILED', item.message);
        } else {
          const local = pending.find((entry) => entry.id === id);
          if (!local) continue;
          const decision = mergeEntity({
            baseSnapshot: local.baseSnapshot,
            localPatch: local.patch,
            localChanged: local.changedFields,
            remoteEntity: item.remoteEntity,
            remoteDeleted: item.remoteEntity === null,
          });
          if (decision.kind === 'AUTO') {
            await this.#repository.applyRemote({
              workspaceId,
              changes: [
                {
                  entityRef: local.entityRef,
                  entityVersion:
                    typeof (decision.merged['entityVersion'] as number | undefined) === 'number'
                      ? (decision.merged['entityVersion'] as number)
                      : 1,
                  remoteVersion: item.remoteVersion,
                  deleted: false,
                  payload: decision.merged,
                },
              ],
            });
            await this.#repository.rebaseOutbox([id], item.remoteVersion, decision.merged);
            await this.#repository.markOutbox([id], 'PENDING');
          } else if (decision.kind === 'TOMBSTONE') {
            await this.#repository.applyRemote({
              workspaceId,
              changes: [
                {
                  entityRef: local.entityRef,
                  entityVersion: 0,
                  remoteVersion: item.remoteVersion,
                  deleted: true,
                },
              ],
            });
            await this.#repository.markOutbox(
              [id],
              'FAILED',
              'The entity was deleted on the shared document.',
            );
          } else {
            await this.#repository.saveConflicts(
              workspaceId,
              decision.fields.map((field) =>
                conflictRow(
                  this.#ids.next(),
                  workspaceId,
                  local.entityRef,
                  field.field,
                  field.localValue,
                  field.remoteValue,
                  this.#clock.now(),
                  {
                    remoteVersion: item.remoteVersion,
                    ...(local.baseVersion !== undefined ? { localVersion: local.baseVersion } : {}),
                  },
                ),
              ),
            );
            await this.#repository.markOutbox([id], 'CONFLICT', 'Overlapping field change');
          }
        }
      }
    }
  }

  async #persistState(
    workspaceId: WorkspaceId,
    previous: Awaited<ReturnType<WorkspaceRepository['getSyncState']>>,
    patch: {
      pullCursor?: string;
      lastPullAt?: string;
      lastPushAt?: string;
      lastKnownRemoteAt?: string;
      shareMode?: ShareMode;
      detail?: string;
    },
  ): Promise<void> {
    const latest = (await this.#repository.getSyncState(workspaceId)) ?? previous;
    const pullCursor = patch.pullCursor ?? latest?.pullCursor;
    const lastPullAt = patch.lastPullAt ?? latest?.lastPullAt;
    const lastPushAt = patch.lastPushAt ?? latest?.lastPushAt;
    const lastKnownRemoteAt = patch.lastKnownRemoteAt ?? latest?.lastKnownRemoteAt;
    const shareMode = patch.shareMode ?? latest?.shareMode;
    await this.#repository.setSyncState({
      workspaceId,
      providerId: this.#provider.id,
      ...(pullCursor !== undefined ? { pullCursor } : {}),
      ...(lastPullAt !== undefined ? { lastPullAt } : {}),
      ...(lastPushAt !== undefined ? { lastPushAt } : {}),
      ...(lastKnownRemoteAt !== undefined ? { lastKnownRemoteAt } : {}),
      ...(latest?.documentPath !== undefined ? { documentPath: latest.documentPath } : {}),
      ...(shareMode !== undefined ? { shareMode } : {}),
    });
    void patch.detail;
  }

  #nextBackoff(): number {
    const jitter = 0.5 + this.#random();
    const wait = Math.min(this.#backoffMs, BACKOFF_MAX_MS) * jitter;
    this.#backoffMs = Math.min(this.#backoffMs * 2, BACKOFF_MAX_MS);
    return wait;
  }
}

function toStatus(
  stored: Awaited<ReturnType<WorkspaceRepository['getSyncState']>>,
  provider: WorkspaceProvider,
  health: ProviderHealth,
  pendingCount: number,
  conflicts: readonly ConflictRecord[],
): SyncStatus {
  const copies: readonly ConflictCopy[] = health.conflictCopies ?? [];
  return {
    providerId: provider.id,
    lastKnownRemoteAt: stored?.lastKnownRemoteAt ?? null,
    lastPullAt: stored?.lastPullAt ?? null,
    lastPushAt: stored?.lastPushAt ?? null,
    pendingCount,
    conflictCount: conflicts.length,
    reachable: health.reachable,
    shareMode: health.shareMode ?? stored?.shareMode ?? 'WRITABLE',
    conflictCopies: copies,
    ...(health.detail !== undefined ? { detail: health.detail } : {}),
  };
}

function conflictRow(
  id: EntityId,
  workspaceId: WorkspaceId,
  entityRef: EntityRef,
  field: string,
  localValue: unknown,
  remoteValue: unknown,
  detectedAt: string,
  versions: { remoteVersion?: string; localVersion?: number },
): ConflictRecord {
  return {
    id,
    workspaceId,
    entityRef,
    field,
    localValue,
    remoteValue,
    detectedAt,
    ...(versions.remoteVersion !== undefined ? { remoteVersion: versions.remoteVersion } : {}),
    ...(versions.localVersion !== undefined ? { localVersion: versions.localVersion } : {}),
  };
}

function groupByEntity(entries: readonly OutboxEntry[]): Map<string, OutboxEntry[]> {
  const grouped = new Map<string, OutboxEntry[]>();
  for (const entry of [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const key = refKey(entry.entityRef);
    const list = grouped.get(key) ?? [];
    list.push(entry);
    grouped.set(key, list);
  }
  return grouped;
}

function matchingOutboxId(
  pending: readonly OutboxEntry[],
  operationId: EntityId,
  ref: EntityRef,
): EntityId {
  const match = pending.find(
    (entry) => entry.commandId === operationId && refKey(entry.entityRef) === refKey(ref),
  );
  return match?.id ?? `${operationId}:${refKey(ref)}`;
}

function findRef(operations: readonly MutationOperation[], operationId: EntityId): EntityRef {
  return operations.find((op) => op.operationId === operationId)!.entityRef;
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ProviderError && error.code === 'PROVIDER_UNAVAILABLE';
}

function retryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof ProviderError) || error.detail === undefined) return undefined;
  if (typeof error.detail !== 'object' || error.detail === null) return undefined;
  const value = (error.detail as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === 'number' ? value : undefined;
}
