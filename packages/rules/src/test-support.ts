/**
 * Builders for rule tests.
 *
 * Lives in this package rather than `@flowmap/testing` because the boundary
 * rules let `rules` import `domain` and nothing else — and that constraint is
 * worth more than the small duplication it costs here.
 *
 * Everything is deterministic: fixed ids, a fixed clock, no ambient time.
 */

import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_VALUE_DRIVERS,
  type CapacityFootprint,
  type Commitment,
  type Decision,
  type Dependency,
  type EntityId,
  type ExternalLink,
  type Milestone,
  type Person,
  type ProductImpact,
  type ProductService,
  type QuarterId,
  type Team,
  type TeamQuarter,
  type Workspace,
  type WorkspaceState,
} from '@flowmap/domain';

import { NO_RULE_SETTINGS, type RuleContext, type RuleSettings } from './types.js';

export const NOW = '2026-08-15T09:00:00Z';
export const TODAY = '2026-08-15';
export const WS = 'ws-1';
export const Q: QuarterId = '2026-Q3';
export const NEXT_Q: QuarterId = '2026-Q4';

export function env(id: string) {
  return {
    id,
    workspaceId: WS,
    schemaVersion: 1,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'actor-1',
    updatedAt: NOW,
    updatedBy: 'actor-1',
  };
}

export const workspace: Workspace = {
  ...env(WS),
  name: 'Test',
  timezone: 'Europe/Amsterdam',
  currentQuarterId: Q,
  isSample: false,
  revision: 1,
  settings: {
    capacity: {
      defaultTeamQuarterCapacity: 100,
      sizeMapping: DEFAULT_SIZE_MAPPING,
      defaultReserves: [],
    },
    changeLoad: DEFAULT_CHANGE_LOAD_SETTINGS,
    valueDrivers: DEFAULT_VALUE_DRIVERS,
    noteMaxLength: 2000,
    milestonesPerCommitment: 6,
  },
};

export function team(id: string, over: Partial<Team> = {}): Team {
  return {
    ...env(id),
    name: id,
    defaultQuarterCapacity: 100,
    displayOrder: 0,
    active: true,
    ...over,
  };
}

export function teamQuarter(
  id: string,
  teamId: string,
  quarterId: QuarterId,
  over: Partial<TeamQuarter> = {},
): TeamQuarter {
  return {
    ...env(id),
    teamId,
    quarterId,
    capacityBaseline: 100,
    capacityAdjustment: 0,
    reserves: [],
    ...over,
  };
}

export function commitment(id: string, over: Partial<Commitment> = {}): Commitment {
  return {
    ...env(id),
    name: id,
    lifecycle: 'COMMITTED',
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    valueDrivers: [],
    ...over,
  };
}

export function footprint(
  id: string,
  commitmentId: string,
  teamId: string,
  quarterId: QuarterId,
  units: number,
  over: Partial<CapacityFootprint> = {},
): CapacityFootprint {
  return {
    ...env(id),
    commitmentId,
    teamId,
    quarterId,
    units,
    unitsSource: 'EXPLICIT',
    isPrimary: false,
    ...over,
  };
}

export function dependency(id: string, over: Partial<Dependency> = {}): Dependency {
  return {
    ...env(id),
    sourceCommitmentId: 'c-1',
    target: { kind: 'COMMITMENT', id: 'c-2' },
    type: 'REQUIRES',
    status: 'OPEN',
    isHard: false,
    ...over,
  };
}

export function decision(id: string, over: Partial<Decision> = {}): Decision {
  return { ...env(id), kind: 'DECISION', name: id, status: 'OPEN', ...over };
}

export function milestone(id: string, over: Partial<Milestone> = {}): Milestone {
  return {
    ...env(id),
    commitmentId: 'c-1',
    name: id,
    status: 'PLANNED',
    displayOrder: 0,
    ...over,
  };
}

export function product(id: string, over: Partial<ProductService> = {}): ProductService {
  return { ...env(id), name: id, active: true, ...over };
}

export function impact(id: string, over: Partial<ProductImpact> = {}): ProductImpact {
  return {
    ...env(id),
    commitmentId: 'c-1',
    productServiceId: 'p-1',
    type: 'MAJOR',
    ...over,
  };
}

export function person(id: string, over: Partial<Person> = {}): Person {
  return { ...env(id), displayName: id, ...over };
}

export function link(id: string, over: Partial<ExternalLink> = {}): ExternalLink {
  return {
    ...env(id),
    commitmentId: 'c-1',
    type: 'GENERIC',
    url: 'https://example.com',
    ...over,
  };
}

function index<T extends { id: EntityId }>(rows: readonly T[]): Map<EntityId, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export type StateParts = {
  teams?: readonly Team[];
  teamQuarters?: readonly TeamQuarter[];
  commitments?: readonly Commitment[];
  footprints?: readonly CapacityFootprint[];
  dependencies?: readonly Dependency[];
  decisions?: readonly Decision[];
  milestones?: readonly Milestone[];
  products?: readonly ProductService[];
  productImpacts?: readonly ProductImpact[];
  people?: readonly Person[];
  externalLinks?: readonly ExternalLink[];
  workspace?: Workspace;
};

export function state(parts: StateParts = {}): WorkspaceState {
  return {
    workspace: parts.workspace ?? workspace,
    teams: index(parts.teams ?? [team('t-1')]),
    teamQuarters: index(parts.teamQuarters ?? []),
    commitments: index(parts.commitments ?? []),
    footprints: index(parts.footprints ?? []),
    dependencies: index(parts.dependencies ?? []),
    decisions: index(parts.decisions ?? []),
    milestones: index(parts.milestones ?? []),
    products: index(parts.products ?? []),
    productImpacts: index(parts.productImpacts ?? []),
    people: index(parts.people ?? []),
    externalLinks: index(parts.externalLinks ?? []),
  };
}

/** A clock frozen at the fixture instant. Advanceable, never ambient. */
export function fixedClock(today = TODAY) {
  return { now: () => `${today}T09:00:00Z`, today: () => today };
}

export function ctx(
  over: Partial<RuleContext> = {},
  settings: RuleSettings = NO_RULE_SETTINGS,
): RuleContext {
  return {
    clock: fixedClock(),
    timezone: 'Europe/Amsterdam',
    settings,
    actorId: 'actor-1',
    ownedRefs: new Set(),
    ...over,
  };
}
