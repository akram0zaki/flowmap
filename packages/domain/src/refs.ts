/**
 * Entity references and projection keys.
 *
 * ProjectionKey is what makes localised recalculation possible: every command
 * reports the projections it invalidated, and the rules engine re-evaluates only
 * the rules that read them. See docs/spec/03-commands-permissions.md §1.
 */

import type { EntityId, WorkspaceId } from './primitives.js';
import type { QuarterId } from './quarter.js';

export type EntityKind =
  | 'WORKSPACE'
  | 'TEAM'
  | 'TEAM_QUARTER'
  | 'COMMITMENT'
  | 'CAPACITY_FOOTPRINT'
  | 'PRODUCT_SERVICE'
  | 'PRODUCT_IMPACT'
  | 'DEPENDENCY'
  | 'DECISION'
  | 'MILESTONE'
  | 'THEME'
  // The join between a commitment and a theme is its own entity because it
  // carries an envelope, and sync needs to reference it like any other row.
  | 'COMMITMENT_THEME'
  | 'PERSON'
  | 'WORKSPACE_USER'
  | 'EXTERNAL_LINK'
  | 'SCENARIO'
  | 'SNAPSHOT'
  | 'SAVED_VIEW';

export type EntityRef =
  | { readonly kind: Exclude<EntityKind, 'WORKSPACE'>; readonly id: EntityId }
  | { readonly kind: 'WORKSPACE'; readonly id: WorkspaceId }
  | {
      readonly kind: 'PRODUCT_QUARTER';
      readonly productServiceId: EntityId;
      readonly quarterId: QuarterId;
    };

export function entityRef(kind: EntityKind, id: EntityId): EntityRef {
  return { kind, id } as EntityRef;
}

/** Stable string form, used as a map key and in signal identity. */
export function refKey(ref: EntityRef): string {
  return ref.kind === 'PRODUCT_QUARTER'
    ? `PRODUCT_QUARTER:${ref.productServiceId}:${ref.quarterId}`
    : `${ref.kind}:${ref.id}`;
}

export type ProjectionKey =
  | `capacity:${string}:${QuarterId}`
  | `changeLoad:${string}:${QuarterId}`
  | `commitment:${string}`
  | 'dependencyGraph'
  | 'radar';

export function capacityKey(teamId: EntityId, quarterId: QuarterId): ProjectionKey {
  return `capacity:${teamId}:${quarterId}`;
}

export function changeLoadKey(productServiceId: EntityId, quarterId: QuarterId): ProjectionKey {
  return `changeLoad:${productServiceId}:${quarterId}`;
}

export function commitmentKey(commitmentId: EntityId): ProjectionKey {
  return `commitment:${commitmentId}`;
}
