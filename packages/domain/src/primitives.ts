/**
 * Primitive value types and the injected capabilities the domain depends on.
 *
 * Nothing in this package reads ambient time, generates ids, or formats for a
 * locale. Those three capabilities are injected, which is what makes every
 * command handler and every rule reproducible.
 *
 * See docs/spec/01-domain-model.md §1.
 */

/** ULID: 26 chars, Crockford base32, lexicographically sortable by creation time. */
export type EntityId = string;
export type WorkspaceId = EntityId;

/** A local profile id, or `entra:<oid>` once linked to a Microsoft identity. */
export type ActorId = string;

/** 'YYYY-MM-DD', interpreted in the workspace timezone. */
export type IsoDate = string;

/** RFC 3339 UTC instant, e.g. '2026-08-15T09:00:00Z'. */
export type IsoDateTime = string;

/** IANA timezone, e.g. 'Europe/Amsterdam'. */
export type Timezone = string;

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export const CONFIDENCE_VALUES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type RelativeSize = 'XS' | 'S' | 'M' | 'L' | 'XL';

export const RELATIVE_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;

/**
 * Relative planning units. A normal team quarter is 100.
 *
 * Always a non-negative integer — all capacity arithmetic is integer arithmetic.
 * Not person-days, not hours, not story points. See docs/spec/00-overview.md §6.
 */
export type CapacityUnits = number;

export type OwnerRef =
  | { readonly kind: 'PERSON'; readonly personId: EntityId }
  | { readonly kind: 'TEAM'; readonly teamId: EntityId };

/** Reads ambient time so that nothing else has to. Tests inject a fixed clock. */
export interface Clock {
  /** Current instant, UTC. */
  now(): IsoDateTime;
  /** Calendar date in the given timezone — the unit every date rule compares in. */
  today(tz: Timezone): IsoDate;
}

/** Generates entity ids. Tests inject a deterministic sequence. */
export interface IdGenerator {
  next(): EntityId;
}

export function isCapacityUnits(value: unknown): value is CapacityUnits {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isOwnerRef(value: unknown): value is OwnerRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Partial<OwnerRef>;
  if (ref.kind === 'PERSON') return typeof (ref as { personId?: unknown }).personId === 'string';
  if (ref.kind === 'TEAM') return typeof (ref as { teamId?: unknown }).teamId === 'string';
  return false;
}

/** Stable key for an owner, used for grouping and for My Radar resolution. */
export function ownerKey(ref: OwnerRef): string {
  return ref.kind === 'PERSON' ? `person:${ref.personId}` : `team:${ref.teamId}`;
}
