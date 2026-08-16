/**
 * The one mutation model.
 *
 * UI edits, undo/redo, scenarios, import, sync, and restore all go through these
 * types and the handler pipeline. Nothing writes to a repository directly.
 *
 * Normative source: docs/spec/03-commands-permissions.md §1.
 */

import type {
  ActorId,
  Clock,
  EntityId,
  IdGenerator,
  IsoDateTime,
  WorkspaceId,
} from './primitives.js';
import type { EntityRef, ProjectionKey } from './refs.js';
import type { DomainError, SuggestedAction } from './errors.js';
import type {
  CapacityFootprint,
  Commitment,
  CommitmentTheme,
  Decision,
  Dependency,
  ExternalLink,
  Milestone,
  Person,
  ProductImpact,
  ProductService,
  Team,
  TeamQuarter,
  Theme,
  Workspace,
  WorkspaceRole,
} from './entities.js';

export type CommandName = string;

export type Command<N extends CommandName = CommandName, P = unknown> = {
  /** ULID. Also the idempotency key when this command reaches a provider. */
  readonly id: EntityId;
  readonly name: N;
  readonly workspaceId: WorkspaceId;
  readonly payload: P;
  readonly actorId: ActorId;
  readonly issuedAt: IsoDateTime;
  /** Groups commands that must apply atomically. */
  readonly batchId?: EntityId;
  /** Present => scenario overlay. MUST NOT reach a baseline write path. */
  readonly scenarioId?: EntityId;
  readonly reason?: string;
};

export type EntityChangeOp = 'CREATE' | 'UPDATE' | 'ARCHIVE' | 'RESTORE' | 'DELETE';

export type EntityChange = {
  readonly ref: EntityRef;
  readonly op: EntityChangeOp;
  readonly fromVersion?: number;
  readonly toVersion: number;
  readonly before?: unknown;
  readonly after?: unknown;
  /**
   * Exactly the fields whose value differs. Drives the sync engine's
   * non-overlapping field merge — getting this wrong causes false conflicts, so
   * it is asserted for every handler.
   */
  readonly changedFields: readonly string[];
};

export type DomainEvent = {
  readonly id: EntityId;
  readonly workspaceId: WorkspaceId;
  readonly sequence: number;
  readonly occurredAt: IsoDateTime;
  readonly actorId: ActorId;
  readonly commandName: CommandName;
  readonly eventType: string;
  readonly entityRefs: readonly EntityRef[];
  /** Rendered from `facts` through i18n, never authored as prose. */
  readonly summaryKey: string;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly scenarioId?: EntityId;
};

export type Consequence =
  | {
      readonly kind: 'CAPACITY';
      readonly teamId: EntityId;
      readonly quarterId: string;
      readonly loadDelta: number;
      readonly newOverflow?: number;
    }
  | { readonly kind: 'IRREVERSIBLE'; readonly noteKey: string };

export type CommandEffects = {
  readonly changes: readonly EntityChange[];
  readonly events: readonly DomainEvent[];
  /** Drives localised rule and view recalculation. */
  readonly affectedProjections: readonly ProjectionKey[];
  /** Present when the operation is safely undoable. */
  readonly inverse?: Command;
  readonly consequences?: readonly Consequence[];
  /** Advisory guardrail violations that did not block. */
  readonly warnings?: readonly Warning[];
};

export type Warning = {
  readonly code: string;
  readonly messageKey: string;
  readonly entityRef?: EntityRef;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly actions?: readonly SuggestedAction[];
};

export type CommandResult =
  | { readonly ok: true; readonly effects: CommandEffects }
  | { readonly ok: false; readonly error: DomainError };

/**
 * Everything a handler is allowed to depend on. No I/O, no ambient time, no
 * ambient ids — which is what makes every handler reproducible.
 */
export type CommandContext = {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly actorId: ActorId;
  readonly role: WorkspaceRole;
  /** Monotonic per workspace; the handler stamps events with `nextSequence + n`. */
  readonly nextSequence: number;
};

export type CommandHandler<P> = (
  state: WorkspaceState,
  command: Command<CommandName, P>,
  ctx: CommandContext,
) => CommandResult;

/**
 * The in-memory baseline projection a handler reads.
 *
 * Deliberately a plain readonly snapshot rather than a repository: a handler
 * that cannot perform I/O cannot accidentally depend on ordering, latency, or a
 * partially-applied write.
 */
export type WorkspaceState = {
  readonly workspace: Workspace;
  readonly teams: ReadonlyMap<EntityId, Team>;
  readonly teamQuarters: ReadonlyMap<EntityId, TeamQuarter>;
  readonly commitments: ReadonlyMap<EntityId, Commitment>;
  readonly footprints: ReadonlyMap<EntityId, CapacityFootprint>;

  // Everything a commitment relates to. Optional on the type because M1 code
  // paths and older tests build state without them, and a handler that needs a
  // relation should say so rather than assume the map is there.
  readonly products?: ReadonlyMap<EntityId, ProductService>;
  readonly productImpacts?: ReadonlyMap<EntityId, ProductImpact>;
  readonly dependencies?: ReadonlyMap<EntityId, Dependency>;
  readonly decisions?: ReadonlyMap<EntityId, Decision>;
  readonly milestones?: ReadonlyMap<EntityId, Milestone>;
  readonly themes?: ReadonlyMap<EntityId, Theme>;
  readonly commitmentThemes?: ReadonlyMap<EntityId, CommitmentTheme>;
  readonly externalLinks?: ReadonlyMap<EntityId, ExternalLink>;
  readonly people?: ReadonlyMap<EntityId, Person>;
};

export const ROLE_ORDER: readonly WorkspaceRole[] = ['VIEWER', 'CONTRIBUTOR', 'PLANNER', 'ADMIN'];

export function roleAtLeast(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_ORDER.indexOf(actual) >= ROLE_ORDER.indexOf(required);
}

/** Fields excluded from `changedFields` because every write touches them. */
const ALWAYS_CHANGED = new Set(['updatedAt', 'updatedBy', 'entityVersion']);

/**
 * Computes `changedFields` by structural comparison, so a handler cannot forget
 * to declare a field it changed.
 */
export function diffFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];

  for (const key of keys) {
    if (ALWAYS_CHANGED.has(key)) continue;
    if (!deepEqual(before[key], after[key])) changed.push(key);
  }
  return changed.sort();
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const key of keys) if (!deepEqual(ra[key], rb[key])) return false;
  return true;
}
