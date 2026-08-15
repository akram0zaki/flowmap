/**
 * Repository and provider contracts.
 *
 * The domain and UI never know which provider is in use; they know only what the
 * capability flags permit. See docs/spec/07-persistence-sync.md and 08-providers.md.
 */

import type {
  Command,
  DomainEvent,
  EntityChange,
  EntityId,
  EntityRef,
  WorkspaceId,
  WorkspaceState,
} from '@flowmap/domain';

// ── Repository ─────────────────────────────────────────────────────────────

export type OutboxState = 'PENDING' | 'IN_FLIGHT' | 'ACKED' | 'CONFLICT' | 'FAILED';

export type OutboxEntry = {
  readonly id: EntityId;
  readonly workspaceId: WorkspaceId;
  /** The command id — also the idempotency key when this reaches a provider. */
  readonly commandId: EntityId;
  readonly batchId?: EntityId;
  readonly entityRef: EntityRef;
  readonly op: EntityChange['op'];
  readonly baseVersion?: number;
  /** The entity as it was when the local mutation was recorded. Drives field-level merge. */
  readonly baseSnapshot?: unknown;
  readonly changedFields: readonly string[];
  readonly patch: unknown;
  readonly createdAt: string;
  readonly attempts: number;
  readonly lastError?: string;
  readonly state: OutboxState;
};

export type ApplyInput = {
  readonly workspaceId: WorkspaceId;
  readonly changes: readonly EntityChange[];
  readonly events: readonly DomainEvent[];
  readonly command: Command;
};

/**
 * The single transactional boundary.
 *
 * `apply` writes entity changes, domain events, AND outbox entries together.
 * There is deliberately no way to write one without the others — that window is
 * how local-first applications lose data.
 */
export interface WorkspaceRepository {
  listWorkspaces(): Promise<Array<{ id: WorkspaceId; name: string; updatedAt: string }>>;
  load(workspaceId: WorkspaceId): Promise<WorkspaceState | null>;
  apply(input: ApplyInput): Promise<void>;
  listEvents(workspaceId: WorkspaceId, limit?: number): Promise<DomainEvent[]>;
  listOutbox(workspaceId: WorkspaceId, state?: OutboxState): Promise<OutboxEntry[]>;
  markOutbox(ids: readonly EntityId[], state: OutboxState, error?: string): Promise<void>;
  nextSequence(workspaceId: WorkspaceId): Promise<number>;
  clearLocalData(workspaceId?: WorkspaceId): Promise<void>;
  close(): Promise<void>;
}

// ── Provider ───────────────────────────────────────────────────────────────

export type ProviderId = 'LOCAL' | 'FILE';

export type ProviderCapabilities = {
  readonly shared: boolean;
  readonly serverVersioning: boolean;
  /** false => whole-document read-modify-write */
  readonly entityLevelWrites: boolean;
  readonly deltaQuery: boolean;
  readonly tombstones: boolean;
  readonly transactional: boolean;
  readonly maxBatchOperations: number;
  readonly provisioning: 'AUTOMATIC' | 'MANUAL' | 'NONE';
};

export type SyncCursor = string;

export type RemoteEntityChange = {
  readonly entityRef: EntityRef;
  readonly entityVersion: number;
  readonly remoteVersion: string;
  readonly deleted: boolean;
  readonly payload?: unknown;
};

export type PullPage = {
  readonly changes: readonly RemoteEntityChange[];
  readonly cursor: SyncCursor;
  readonly hasMore: boolean;
};

export type MutationOperation = {
  /** == command id. Makes push idempotent. */
  readonly operationId: EntityId;
  readonly entityRef: EntityRef;
  readonly op: EntityChange['op'];
  readonly baseVersion?: string;
  readonly changedFields: readonly string[];
  readonly patch: unknown;
};

export type MutationBatch = {
  readonly batchId: EntityId;
  readonly operations: readonly MutationOperation[];
};

export type PushOperationResult =
  | { readonly operationId: EntityId; readonly status: 'APPLIED'; readonly newVersion: string }
  /** Already applied — treat as success. This is what makes retries safe. */
  | { readonly operationId: EntityId; readonly status: 'DUPLICATE'; readonly newVersion: string }
  | {
      readonly operationId: EntityId;
      readonly status: 'CONFLICT';
      readonly remoteVersion: string;
      readonly remoteEntity: unknown;
    }
  | {
      readonly operationId: EntityId;
      readonly status: 'REJECTED';
      readonly code: string;
      readonly message: string;
    };

export type PushResult = { readonly results: readonly PushOperationResult[] };

export type ProviderHealth = {
  readonly reachable: boolean;
  readonly lastCheckedAt: string;
  readonly detail?: string;
};

/**
 * Note the absence of `authenticate`. Flowmap holds no credentials and makes no
 * authenticated calls — reaching a shared document is the sync client's job.
 * See docs/spec/08-providers.md §4.
 */
export interface WorkspaceProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  health(): Promise<ProviderHealth>;
  listWorkspaces(): Promise<Array<{ id: WorkspaceId; name: string }>>;
  provision(
    workspaceId: WorkspaceId,
    schemaVersion: number,
  ): Promise<{ ok: boolean; detail?: string }>;
  pull(
    workspaceId: WorkspaceId,
    cursor: SyncCursor | null,
    opts?: { pageSize?: number },
  ): Promise<PullPage>;
  push(workspaceId: WorkspaceId, batch: MutationBatch): Promise<PushResult>;
}

export class ProviderError extends Error {
  constructor(
    readonly code:
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'PAYLOAD_TOO_LARGE'
      | 'PROVIDER_UNAVAILABLE'
      | 'CURSOR_EXPIRED'
      | 'SCHEMA_VERSION_TOO_NEW',
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
