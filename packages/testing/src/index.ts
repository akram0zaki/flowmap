/**
 * Deterministic test capabilities and entity builders.
 *
 * Everything the domain injects — time and ids — has a deterministic
 * implementation here, so a fixture built twice is byte-identical and a rule
 * evaluated twice gives the same answer. See docs/spec/11-quality-performance.md §5.
 */

import type {
  ActorId,
  Clock,
  EntityId,
  IdGenerator,
  IsoDate,
  IsoDateTime,
  Timezone,
  WorkspaceId,
} from '@flowmap/domain';
import type { EntityEnvelope } from '@flowmap/domain';

/** The canonical fixture instant. Every fixture and golden test uses it. */
export const FIXTURE_NOW: IsoDateTime = '2026-08-15T09:00:00Z';
export const FIXTURE_TIMEZONE: Timezone = 'Europe/Amsterdam';
export const FIXTURE_WORKSPACE_ID: WorkspaceId = '01K0000000000000000WORKSP';
export const FIXTURE_ACTOR: ActorId = 'local:fixture-planner';

/** A clock frozen at a chosen instant, advanceable by whole seconds. */
export class FixedClock implements Clock {
  #instant: IsoDateTime;

  constructor(instant: IsoDateTime = FIXTURE_NOW) {
    this.#instant = instant;
  }

  now(): IsoDateTime {
    return this.#instant;
  }

  /**
   * Calendar date in `tz`. Uses Intl deliberately — this is test infrastructure,
   * not domain code, and the domain gets the resolved date handed to it.
   */
  today(tz: Timezone): IsoDate {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date(this.#instant)) as IsoDate;
  }

  set(instant: IsoDateTime): void {
    this.#instant = instant;
  }

  advanceDays(days: number): void {
    const next = new Date(this.#instant);
    next.setUTCDate(next.getUTCDate() + days);
    this.#instant = next.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
}

/**
 * ULID-shaped ids that are stable across runs.
 *
 * Real ULIDs sort by creation time; these preserve that property by encoding a
 * monotonic counter, so fixture ordering matches production ordering.
 */
export class SequentialIdGenerator implements IdGenerator {
  #counter = 0;

  constructor(private readonly prefix = '01K') {}

  next(): EntityId {
    this.#counter += 1;
    return `${this.prefix}${String(this.#counter).padStart(23, '0')}`;
  }

  reset(): void {
    this.#counter = 0;
  }
}

const ID_PREFIX = '01K';
const ID_BODY_LENGTH = 23; // ULID is 26 chars total
const HASH_LENGTH = 4;
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, as ULID uses

/** Deterministic FNV-1a, rendered in Crockford base32. No randomness, no clock. */
function shortHash(value: string, length: number): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out = BASE32[hash & 31] + out;
    hash >>>= 5;
  }
  return out;
}

/**
 * Builds a labelled, ULID-shaped id so fixture failures name the entity rather
 * than a hash.
 *
 * Long labels keep a readable prefix and gain a deterministic hash suffix.
 * Truncating alone silently collided — `FP…PAYMENTS2026Q3` and
 * `FP…PAYMENTS2026Q4` both lost their quarter — so the hash is not decoration.
 */
export function fixtureId(label: string): EntityId {
  const cleaned = label.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (cleaned.length <= ID_BODY_LENGTH) {
    return `${ID_PREFIX}${cleaned.padStart(ID_BODY_LENGTH, '0')}`;
  }

  const prefix = cleaned.slice(0, ID_BODY_LENGTH - HASH_LENGTH);
  return `${ID_PREFIX}${prefix}${shortHash(cleaned, HASH_LENGTH)}`;
}

export type EnvelopeOverrides = Partial<EntityEnvelope> & Pick<EntityEnvelope, 'id'>;

/** Envelope with fixture defaults. Keeps builders free of repeated boilerplate. */
export function envelope(overrides: EnvelopeOverrides): EntityEnvelope {
  return {
    workspaceId: FIXTURE_WORKSPACE_ID,
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: FIXTURE_NOW,
    createdBy: FIXTURE_ACTOR,
    updatedAt: FIXTURE_NOW,
    updatedBy: FIXTURE_ACTOR,
    ...overrides,
  };
}

/** Indexes any envelope-carrying collection by id. */
export function byId<T extends { readonly id: EntityId }>(items: readonly T[]): Map<EntityId, T> {
  return new Map(items.map((item) => [item.id, item]));
}
