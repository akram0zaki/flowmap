/**
 * In-process repository.
 *
 * Two jobs:
 *   - browser development mode, where `node:sqlite` does not exist;
 *   - fast tests that do not need to exercise SQL.
 *
 * Implements exactly the same contract as the SQLite repository, so the app
 * cannot tell them apart. An optional persistence adapter (localStorage in the
 * browser) makes "reload the page" a genuine restart, which is what lets the
 * persistence workflow test run against the browser target.
 */

import type {
  CapacityFootprint,
  Commitment,
  CommitmentTheme,
  Decision,
  Dependency,
  DomainEvent,
  EntityId,
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
} from '@flowmap/domain';
import { DomainErrorException, domainError, refKey } from '@flowmap/domain';

import type { ApplyInput, OutboxEntry, OutboxState, SnapshotRecord, WorkspaceRepository } from './contracts.js';

type Snapshot = {
  workspaces: Record<string, Workspace>;
  teams: Record<string, Team>;
  teamQuarters: Record<string, TeamQuarter>;
  commitments: Record<string, Commitment>;
  footprints: Record<string, CapacityFootprint>;
  products: Record<string, ProductService>;
  productImpacts: Record<string, ProductImpact>;
  dependencies: Record<string, Dependency>;
  decisions: Record<string, Decision>;
  milestones: Record<string, Milestone>;
  themes: Record<string, Theme>;
  commitmentThemes: Record<string, CommitmentTheme>;
  externalLinks: Record<string, ExternalLink>;
  signalDispositions: Record<string, SignalDisposition>;
  scenarios: Record<string, Scenario>;
  people: Record<string, Person>;
  events: DomainEvent[];
  outbox: OutboxEntry[];
  snapshots: SnapshotRecord[];
  profile?: { id: string; displayName: string };
};

export type PersistenceAdapter = {
  read(): string | null;
  write(value: string): void;
  clear(): void;
};

/** Reload-surviving storage for browser dev mode. */
export function localStoragePersistence(key = 'flowmap.dev.workspace'): PersistenceAdapter {
  return {
    read: () => globalThis.localStorage?.getItem(key) ?? null,
    write: (value) => globalThis.localStorage?.setItem(key, value),
    clear: () => globalThis.localStorage?.removeItem(key),
  };
}

/**
 * Reads a persisted snapshot, forwards-compatibly.
 *
 * A snapshot written before a bucket existed does not have it, and reading one
 * straight into `#data` left `undefined` where a record was expected — which
 * `Object.values` then refused, on the very first load, with a blank page. New
 * buckets are additive by definition, so merging over an empty snapshot is the
 * whole migration: absent means empty.
 *
 * Anyone who already had a workspace open hit this the moment schema v2 shipped.
 * The tests never did, because every one of them starts by clearing storage.
 */
function readSnapshot(raw: string | null): Snapshot {
  if (raw === null) return emptySnapshot();
  try {
    return { ...emptySnapshot(), ...(JSON.parse(raw) as Partial<Snapshot>) };
  } catch {
    // Corrupt storage is not a reason to refuse to start. The workspace is
    // rebuildable from the provider or the sample; a blank page is not.
    return emptySnapshot();
  }
}

function emptySnapshot(): Snapshot {
  return {
    workspaces: {},
    teams: {},
    teamQuarters: {},
    commitments: {},
    footprints: {},
    products: {},
    productImpacts: {},
    dependencies: {},
    decisions: {},
    milestones: {},
    themes: {},
    commitmentThemes: {},
    externalLinks: {},
    signalDispositions: {},
    scenarios: {},
    people: {},
    events: [],
    outbox: [],
    snapshots: [],
  };
}

const KIND_TO_BUCKET = {
  WORKSPACE: 'workspaces',
  TEAM: 'teams',
  TEAM_QUARTER: 'teamQuarters',
  COMMITMENT: 'commitments',
  CAPACITY_FOOTPRINT: 'footprints',
  PRODUCT_SERVICE: 'products',
  PRODUCT_IMPACT: 'productImpacts',
  DEPENDENCY: 'dependencies',
  DECISION: 'decisions',
  MILESTONE: 'milestones',
  THEME: 'themes',
  COMMITMENT_THEME: 'commitmentThemes',
  EXTERNAL_LINK: 'externalLinks',
  SIGNAL_DISPOSITION: 'signalDispositions',
  SCENARIO: 'scenarios',
  PERSON: 'people',
} as const;

/** Every bucket that holds workspace-scoped entities, for load and clear. */
const ENTITY_BUCKETS = [
  'teams',
  'teamQuarters',
  'commitments',
  'footprints',
  'products',
  'productImpacts',
  'dependencies',
  'decisions',
  'milestones',
  'themes',
  'commitmentThemes',
  'externalLinks',
  'signalDispositions',
  'scenarios',
  'people',
] as const;

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  #data: Snapshot;

  constructor(private readonly persistence?: PersistenceAdapter) {
    this.#data = readSnapshot(persistence?.read() ?? null);
  }

  async listWorkspaces(): Promise<Array<{ id: WorkspaceId; name: string; updatedAt: string }>> {
    return Object.values(this.#data.workspaces)
      .filter((w) => w.deletedAt === undefined)
      .map((w) => ({ id: w.id, name: w.name, updatedAt: w.updatedAt }));
  }

  async load(workspaceId: WorkspaceId): Promise<WorkspaceState | null> {
    const workspace = this.#data.workspaces[workspaceId];
    if (!workspace || workspace.deletedAt !== undefined) return null;

    const scoped = <T extends { workspaceId: string; deletedAt?: string }>(
      bucket: Record<string, T> | undefined,
    ): Map<EntityId, T> =>
      new Map(
        Object.values(bucket ?? {})
          .filter((e) => e.workspaceId === workspaceId && e.deletedAt === undefined)
          .map((e) => [(e as unknown as { id: EntityId }).id, e]),
      );

    return {
      workspace,
      teams: scoped(this.#data.teams),
      teamQuarters: scoped(this.#data.teamQuarters),
      commitments: scoped(this.#data.commitments),
      footprints: scoped(this.#data.footprints),
      products: scoped(this.#data.products),
      productImpacts: scoped(this.#data.productImpacts),
      dependencies: scoped(this.#data.dependencies),
      decisions: scoped(this.#data.decisions),
      milestones: scoped(this.#data.milestones),
      themes: scoped(this.#data.themes),
      commitmentThemes: scoped(this.#data.commitmentThemes),
      externalLinks: scoped(this.#data.externalLinks),
      signalDispositions: scoped(this.#data.signalDispositions),
      scenarios: scoped(this.#data.scenarios),
      people: scoped(this.#data.people),
    };
  }

  /**
   * Applies to a copy first, so a throw part-way through leaves the previous
   * state untouched. Same guarantee as the SQLite transaction.
   */
  async apply(input: ApplyInput): Promise<void> {
    if (input.command.scenarioId !== undefined) {
      throw new DomainErrorException(
        domainError('SCENARIO_CANNOT_MUTATE_BASELINE', { params: { scenarioId: input.command.scenarioId } }),
      );
    }
    const draft: Snapshot = structuredClone(this.#data);

    if (input.preSnapshot) {
      draft.snapshots.push({
        id: input.preSnapshot.id,
        workspaceId: input.preSnapshot.workspaceId,
        workspaceRevision: input.preSnapshot.workspaceRevision,
        createdAt: input.preSnapshot.createdAt,
        commandName: input.preSnapshot.commandName,
        content: structuredClone(this.#data),
      });
    }

    for (const change of input.changes) {
      const bucket = KIND_TO_BUCKET[change.ref.kind as keyof typeof KIND_TO_BUCKET];
      if (!bucket) throw new Error(`No bucket for entity kind ${change.ref.kind}`);

      const id = (change.ref as { id: EntityId }).id;
      if (change.op === 'DELETE') {
        delete (draft[bucket] as Record<string, unknown>)[id];
      } else {
        (draft[bucket] as Record<string, unknown>)[id] = {
          ...(change.after as object),
          workspaceId: bucket === 'workspaces' ? id : input.workspaceId,
        };
      }

      draft.outbox.push({
          id: `${input.command.id}:${refKey(change.ref)}`,
          workspaceId: input.workspaceId,
          commandId: input.command.id,
          entityRef: change.ref,
          op: change.op,
          changedFields: change.changedFields,
          patch: change.after,
          createdAt: input.command.issuedAt,
          attempts: 0,
          state: 'PENDING',
          ...(input.command.batchId !== undefined ? { batchId: input.command.batchId } : {}),
          ...(change.fromVersion !== undefined ? { baseVersion: change.fromVersion } : {}),
          ...(change.before !== undefined ? { baseSnapshot: change.before } : {}),
      });
    }

    draft.events.push(...input.events);
    this.#commit(draft);
  }

  async listEvents(workspaceId: WorkspaceId, limit = 200): Promise<DomainEvent[]> {
    return this.#data.events
      .filter((e) => e.workspaceId === workspaceId)
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, limit);
  }

  async listSnapshots(workspaceId: WorkspaceId, limit = 50): Promise<SnapshotRecord[]> {
    return this.#data.snapshots
      .filter((snapshot) => snapshot.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((snapshot) => structuredClone(snapshot));
  }

  async listOutbox(workspaceId: WorkspaceId, state?: OutboxState): Promise<OutboxEntry[]> {
    return this.#data.outbox.filter(
      (e) => e.workspaceId === workspaceId && (state === undefined || e.state === state),
    );
  }

  async markOutbox(ids: readonly EntityId[], state: OutboxState, error?: string): Promise<void> {
    const draft = structuredClone(this.#data);
    draft.outbox = draft.outbox.map((entry) =>
      ids.includes(entry.id)
        ? { ...entry, state, attempts: entry.attempts + 1, ...(error ? { lastError: error } : {}) }
        : entry,
    );
    this.#commit(draft);
  }

  async nextSequence(workspaceId: WorkspaceId): Promise<number> {
    const highest = this.#data.events
      .filter((e) => e.workspaceId === workspaceId)
      .reduce((max, e) => Math.max(max, e.sequence), 0);
    return highest + 1;
  }

  async clearLocalData(workspaceId?: WorkspaceId): Promise<void> {
    if (!workspaceId) {
      this.#commit(emptySnapshot());
      this.persistence?.clear();
      return;
    }

    const draft = structuredClone(this.#data);
    delete draft.workspaces[workspaceId];
    for (const bucket of ENTITY_BUCKETS) {
      for (const [id, entity] of Object.entries(draft[bucket])) {
        if ((entity as { workspaceId: string }).workspaceId === workspaceId) {
          delete (draft[bucket] as Record<string, unknown>)[id];
        }
      }
    }
    draft.events = draft.events.filter((e) => e.workspaceId !== workspaceId);
    draft.outbox = draft.outbox.filter((e) => e.workspaceId !== workspaceId);
    this.#commit(draft);
  }

  async ensureLocalProfile(
    id: EntityId,
    displayName: string,
  ): Promise<{ id: EntityId; displayName: string }> {
    if (this.#data.profile) return this.#data.profile;
    const draft = structuredClone(this.#data);
    draft.profile = { id, displayName };
    this.#commit(draft);
    return draft.profile;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }

  #commit(draft: Snapshot): void {
    this.#data = draft;
    this.persistence?.write(JSON.stringify(draft));
  }
}
