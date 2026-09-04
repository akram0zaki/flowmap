/**
 * The closed set of domain error codes.
 *
 * Every code is a stable i18n key (`error.<CODE>`) and every code has at least
 * one test that provokes it — see docs/spec/03-commands-permissions.md §2.
 */

import type { EntityRef } from './refs.js';

export const DOMAIN_ERROR_CODES = [
  // authorisation and identity
  'UNAUTHORISED',
  'WORKSPACE_NOT_FOUND',
  'ENTITY_NOT_FOUND',
  'ENTITY_ARCHIVED',
  'STALE_VERSION',
  'ENTITY_HAS_UNRESOLVED_CONFLICT',

  // lifecycle
  'ILLEGAL_LIFECYCLE_TRANSITION',
  'COMMIT_GATE_PRIMARY_TEAM_REQUIRED',
  'COMMIT_GATE_FOOTPRINT_REQUIRED',
  'COMMIT_GATE_PRIMARY_FOOTPRINT_MISMATCH',
  'MANDATORY_TARGET_DATE_REQUIRED',

  // capacity
  'RESERVES_EXCEED_CAPACITY',
  'XL_REQUIRES_EXPLICIT_UNITS',
  'FOOTPRINT_UNITS_MUST_BE_POSITIVE',
  'DUPLICATE_FOOTPRINT',
  'SPLIT_UNITS_MISMATCH',
  'RESERVE_IS_SYSTEM_MANAGED',
  'REFINEMENT_LINK_NOT_PERMITTED',

  // relationships
  'MULTIPLE_PRIMARY_IMPACTS',
  'TOO_MANY_MILESTONES',
  'SELF_DEPENDENCY',
  'DUPLICATE_DEPENDENCY',
  'TEAM_HAS_ACTIVE_FOOTPRINTS',

  // content
  'NOTE_TOO_LONG',
  'NAME_REQUIRED',
  'NAME_TOO_LONG',
  'INSECURE_URL',
  'DUPLICATE_NAME',
  'INVALID_VALUE',

  // quarter close
  'QUARTER_CLOSED',
  'QUARTER_ALREADY_CLOSED',
  'CARRY_OVER_NOT_REVIEWED',

  // scenarios
  'SCENARIO_STALE',
  'SCENARIO_CONFLICT_UNRESOLVED',
  'SCENARIO_CANNOT_MUTATE_BASELINE',
  'SCENARIO_COMMAND_NOT_ALLOWED',
  'SCENARIO_SELECTION_INCOMPLETE',

  // import and schema
  'IMPORT_MISSING_EXTERNAL_KEY',
  'IMPORT_UNRESOLVED_REFERENCE',
  'IMPORT_INVALID_ENUM_VALUE',
  'SCHEMA_VERSION_TOO_NEW',
  'MIGRATION_CHECKSUM_MISMATCH',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export type SuggestedAction = {
  readonly kind: 'OPEN' | 'COMMAND' | 'NAVIGATE';
  readonly labelKey: string;
  readonly payload?: Readonly<Record<string, unknown>>;
};

export type DomainError = {
  readonly code: DomainErrorCode;
  /** i18n key, always `error.<code>`. Held explicitly so consumers never build it by hand. */
  readonly messageKey: `error.${DomainErrorCode}`;
  readonly entityRef?: EntityRef;
  readonly field?: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly recovery?: readonly SuggestedAction[];
};

export function domainError(
  code: DomainErrorCode,
  detail: Omit<DomainError, 'code' | 'messageKey'> = {},
): DomainError {
  return { code, messageKey: `error.${code}`, ...detail };
}

/** Thrown only at boundaries that cannot return a Result — handlers return errors instead. */
export class DomainErrorException extends Error {
  constructor(readonly error: DomainError) {
    super(error.code);
    this.name = 'DomainErrorException';
  }
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DomainError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: DomainErrorCode,
  detail?: Omit<DomainError, 'code' | 'messageKey'>,
): Result<T> {
  return { ok: false, error: domainError(code, detail) };
}
