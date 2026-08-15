/**
 * Shared machinery for command handlers.
 *
 * Extracted so every handler validates in the same order and builds changes and
 * events the same way. A handler that hand-rolls one of these is a handler that
 * will eventually forget `changedFields`.
 *
 * See docs/spec/03-commands-permissions.md §1.
 */

import type {
  Command,
  CommandContext,
  CommandEffects,
  CommandResult,
  DomainEvent,
  EntityChange,
  WorkspaceState,
} from './command.js';
import { diffFields, roleAtLeast } from './command.js';
import { domainError, type DomainErrorCode } from './errors.js';
import type { EntityId } from './primitives.js';
import type { WorkspaceRole } from './entities.js';

export const SCHEMA_VERSION = 1;

/**
 * The projection a handler reads, plus optional lookups for facts that live
 * outside the core five collections.
 *
 * They are optional because most handlers do not need them, and a handler that
 * does should degrade to the permissive answer rather than fail — an advisory
 * check is not worth blocking a command over.
 */
export type HandlerState = WorkspaceState & {
  readonly hasProductImpact?: (commitmentId: EntityId) => boolean;
  readonly everInDelivery?: (commitmentId: EntityId) => boolean;
};

export function domainFail(
  code: DomainErrorCode,
  detail: Parameters<typeof domainError>[1] = {},
): CommandResult {
  return { ok: false, error: domainError(code, detail) };
}

export function succeed(effects: CommandEffects): CommandResult {
  return { ok: true, effects };
}

export function authorise(ctx: CommandContext, required: WorkspaceRole): CommandResult | null {
  return roleAtLeast(ctx.role, required)
    ? null
    : domainFail('UNAUTHORISED', { params: { required, actual: ctx.role } });
}

export function requireName(name: unknown, max: number): CommandResult | null {
  if (typeof name !== 'string' || name.trim().length === 0) return domainFail('NAME_REQUIRED');
  if (name.length > max) {
    return domainFail('NAME_TOO_LONG', { params: { max, actual: name.length } });
  }
  return null;
}

export function requireText(
  value: string | undefined,
  max: number,
  code: DomainErrorCode = 'NOTE_TOO_LONG',
): CommandResult | null {
  if (value === undefined) return null;
  if (value.length > max) return domainFail(code, { params: { max, actual: value.length } });
  return null;
}

/** External links are referenced, never embedded — and never over plain HTTP. */
export function requireHttps(url: string): CommandResult | null {
  return url.startsWith('https://') ? null : domainFail('INSECURE_URL', { params: { url } });
}

export type Envelope = {
  id: EntityId;
  workspaceId: string;
  schemaVersion: number;
  entityVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export function newEnvelope(id: EntityId, cmd: Command, ctx: CommandContext): Envelope {
  return {
    id,
    workspaceId: cmd.workspaceId,
    schemaVersion: SCHEMA_VERSION,
    entityVersion: 1,
    createdAt: ctx.clock.now(),
    createdBy: ctx.actorId,
    updatedAt: ctx.clock.now(),
    updatedBy: ctx.actorId,
  };
}

export function bumped<T extends { entityVersion: number }>(entity: T, ctx: CommandContext): T {
  return {
    ...entity,
    entityVersion: entity.entityVersion + 1,
    updatedAt: ctx.clock.now(),
    updatedBy: ctx.actorId,
  };
}

export function created(ref: EntityChange['ref'], after: object): EntityChange {
  return { ref, op: 'CREATE', toVersion: 1, after, changedFields: Object.keys(after).sort() };
}

export function updated(
  ref: EntityChange['ref'],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): EntityChange {
  return {
    ref,
    op: 'UPDATE',
    fromVersion: before['entityVersion'] as number,
    toVersion: after['entityVersion'] as number,
    before,
    after,
    changedFields: diffFields(before, after),
  };
}

export function archivedChange(
  ref: EntityChange['ref'],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): EntityChange {
  return { ...updated(ref, before, after), op: 'ARCHIVE' };
}

export function event(
  cmd: Command,
  ctx: CommandContext,
  offset: number,
  eventType: string,
  refs: EntityChange['ref'][],
  facts: Record<string, unknown>,
): DomainEvent {
  return {
    id: ctx.ids.next(),
    workspaceId: cmd.workspaceId,
    sequence: ctx.nextSequence + offset,
    occurredAt: ctx.clock.now(),
    actorId: ctx.actorId,
    commandName: cmd.name,
    eventType,
    entityRefs: refs,
    summaryKey: `event.${eventType}`,
    facts,
    ...(cmd.reason !== undefined ? { reason: cmd.reason } : {}),
    ...(cmd.scenarioId !== undefined ? { scenarioId: cmd.scenarioId } : {}),
  };
}

/** Drops undefined entries so `exactOptionalPropertyTypes` stays satisfied. */
export function withoutUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}
