/**
 * Persisted entity shapes.
 *
 * Normative definitions live in docs/spec/01-domain-model.md. Where a comment
 * here cites a rule, the spec is the source of truth and this file follows it.
 */

import type {
  ActorId,
  CapacityUnits,
  Confidence,
  EntityId,
  IsoDate,
  IsoDateTime,
  OwnerRef,
  RelativeSize,
  Timezone,
  WorkspaceId,
} from './primitives.js';
import type { QuarterId } from './quarter.js';

/** Carried by every synchronised entity. */
export type EntityEnvelope = {
  readonly id: EntityId;
  readonly workspaceId: WorkspaceId;
  readonly schemaVersion: number;
  /** Monotonic per entity; incremented by every accepted mutation. */
  readonly entityVersion: number;
  readonly createdAt: IsoDateTime;
  readonly createdBy: ActorId;
  readonly updatedAt: IsoDateTime;
  readonly updatedBy: ActorId;
  /** Presence means archived — the normal user-facing removal. Links and history survive. */
  readonly archivedAt?: IsoDateTime;
  readonly archivedBy?: ActorId;
  /** Presence means tombstoned. Admin only. */
  readonly deletedAt?: IsoDateTime;
  /** Provider concurrency token (ETag). Local cache only; never exported. */
  readonly remoteVersion?: string;
};

export function isActive(entity: EntityEnvelope): boolean {
  return entity.archivedAt === undefined && entity.deletedAt === undefined;
}

// ── Workspace ──────────────────────────────────────────────────────────────

export type SizeMapping = Readonly<Record<'XS' | 'S' | 'M' | 'L', CapacityUnits>>;

export const DEFAULT_SIZE_MAPPING: SizeMapping = { XS: 5, S: 10, M: 20, L: 35 };
export const DEFAULT_TEAM_QUARTER_CAPACITY: CapacityUnits = 100;

export type ReserveType = 'BAU_SUPPORT' | 'LCM' | 'OVERHEAD' | 'REFINEMENT' | 'HOLD' | 'OTHER';

export type DefaultReserve = {
  readonly type: ReserveType;
  readonly amount: CapacityUnits;
  readonly label: string;
};

/** 15 + 5 leaves 80 deliverable units out of 100 — docs/spec/02-capacity-model.md §5. */
export const DEFAULT_RESERVES: readonly DefaultReserve[] = [
  { type: 'BAU_SUPPORT', amount: 15, label: 'BAU & support' },
  { type: 'REFINEMENT', amount: 5, label: 'Refinement' },
];

export type CapacitySettings = {
  readonly defaultTeamQuarterCapacity: CapacityUnits;
  readonly sizeMapping: SizeMapping;
  readonly defaultReserves: readonly DefaultReserve[];
};

export type ChangeLoadSettings = {
  readonly impactBase: Readonly<Record<ProductImpactType, number>>;
  readonly referenceUnits: CapacityUnits;
  readonly mandatoryFactor: number;
  readonly thresholdMedium: number;
  readonly thresholdHigh: number;
};

export const DEFAULT_CHANGE_LOAD_SETTINGS: ChangeLoadSettings = {
  impactBase: { PRIMARY: 3.0, MAJOR: 2.0, MINOR: 0.5, DEPENDENCY: 0.25 },
  referenceUnits: 20,
  mandatoryFactor: 1.5,
  thresholdMedium: 6,
  thresholdHigh: 12,
};

export type WorkspaceSettings = {
  readonly capacity: CapacitySettings;
  readonly changeLoad: ChangeLoadSettings;
  readonly valueDrivers: readonly string[];
  readonly noteMaxLength: 2000;
  readonly milestonesPerCommitment: 6;
};

export const DEFAULT_VALUE_DRIVERS: readonly string[] = [
  'Revenue / Growth',
  'Client Experience',
  'Regulatory / Compliance',
  'Risk Reduction',
  'Resilience',
  'Cost / Efficiency',
  'Strategic Enablement',
  'Technology Health',
];

export type Workspace = EntityEnvelope & {
  readonly name: string;
  readonly timezone: Timezone;
  /** Advanced only by CloseQuarter. The calendar never rolls a workspace forward. */
  readonly currentQuarterId: QuarterId;
  readonly isSample: boolean;
  readonly settings: WorkspaceSettings;
  /** Baseline revision. Increments per applied baseline command batch; scenario rebase reads it. */
  readonly revision: number;
};

// ── Teams and capacity containers ──────────────────────────────────────────

export type Team = EntityEnvelope & {
  readonly name: string;
  readonly description?: string;
  readonly defaultQuarterCapacity: CapacityUnits;
  /** Alphabetical by default; Planner-reorderable. Pressure never reshuffles rows. */
  readonly displayOrder: number;
  readonly active: boolean;
};

export type CapacityReserve = {
  readonly id: EntityId;
  readonly type: ReserveType;
  readonly label: string;
  readonly amount: CapacityUnits;
  /** REFINEMENT only. Qualitative: explains what the bucket supports, allocates no units. */
  readonly linkedIdeaIds?: readonly EntityId[];
  /** HOLD reserves are created and removed only by hold/resume. */
  readonly systemManaged?: boolean;
};

export type TeamQuarter = EntityEnvelope & {
  readonly teamId: EntityId;
  readonly quarterId: QuarterId;
  readonly capacityBaseline: CapacityUnits;
  /** Signed: vacancies, ramp-up, extended leave. */
  readonly capacityAdjustment: number;
  readonly adjustmentNote?: string;
  readonly reserves: readonly CapacityReserve[];
  /** Set by CloseQuarter. A closed team-quarter rejects every mutation. */
  readonly closedAt?: IsoDateTime;
  readonly overflowAccepted?: {
    readonly acceptedBy: ActorId;
    readonly acceptedAt: IsoDateTime;
    readonly reason?: string;
  };
};

// ── Commitment ─────────────────────────────────────────────────────────────

export type Lifecycle = 'IDEA' | 'COMMITTED' | 'IN_DELIVERY' | 'ON_HOLD' | 'DONE' | 'DROPPED';

export type CommitmentClass = 'MANDATORY' | 'STRATEGIC' | 'OPERATIONAL' | 'DISCRETIONARY';

export type Importance = 'HIGH' | 'MEDIUM' | 'LOW';

export type Commitment = EntityEnvelope & {
  readonly name: string;
  readonly lifecycle: Lifecycle;
  /** Set only while ON_HOLD; ResumeCommitment returns here. */
  readonly priorActiveLifecycle?: 'COMMITTED' | 'IN_DELIVERY';
  readonly class: CommitmentClass;
  readonly importance: Importance;

  readonly primaryTeamId?: EntityId;
  readonly ownerRef?: OwnerRef;

  readonly targetQuarterId?: QuarterId;
  /** Optional precision. Setting it derives targetQuarterId. */
  readonly targetDate?: IsoDate;

  readonly sizeConfidence?: Confidence;
  readonly timingConfidence?: Confidence;
  readonly scopeConfidence?: Confidence;

  readonly outcome?: string;
  readonly valueDrivers: readonly string[];

  readonly attentionDate?: IsoDate;
  readonly latestSafeStart?: IsoDate;
  readonly nextAction?: string;
  readonly nextActionOwnerRef?: OwnerRef;
  readonly nextActionDueDate?: IsoDate;

  readonly managementNote?: string;

  readonly recurrence?: {
    readonly pattern: 'QUARTERLY' | 'ANNUAL' | 'CUSTOM';
    readonly intervalQuarters?: number;
  };
  readonly renewedFromCommitmentId?: EntityId;

  readonly committedAt?: IsoDateTime;
  readonly committedBy?: ActorId;
  /** Units at Commit Gate, for the HLT_GROWN rule. */
  readonly unitsAtCommit?: CapacityUnits;
  readonly lastMeaningfulUpdateAt?: IsoDateTime;
  /** Set only by `Reviewed — no change`. */
  readonly lastReviewedAt?: IsoDateTime;
};

/**
 * R5: capacity comes only from footprint units. There is no stored commitment
 * size — `sizeSummary` is derived. See docs/spec/01-domain-model.md §5.1.
 */
export type CapacityFootprint = EntityEnvelope & {
  readonly commitmentId: EntityId;
  readonly teamId: EntityId;
  readonly quarterId: QuarterId;
  readonly units: CapacityUnits;
  /** The band chosen when units were first resolved. Display metadata only. */
  readonly sizeAtCreation?: RelativeSize;
  readonly unitsSource: 'SIZE_MAPPING' | 'EXPLICIT' | 'MIGRATED' | 'CARRY_OVER';
  readonly confidence?: Confidence;
  /** Exactly one per commitment once committed, on the primary team. */
  readonly isPrimary: boolean;
  readonly carryOverFromQuarterId?: QuarterId;
  readonly carryOverFromFootprintId?: EntityId;
  /** Set at quarter close on the origin footprint. Preserves the original plan. */
  readonly closedAsUnfinished?: boolean;
};

// ── Products and impact ────────────────────────────────────────────────────

export type ProductService = EntityEnvelope & {
  readonly name: string;
  readonly description?: string;
  readonly ownerRef?: OwnerRef;
  readonly active: boolean;
};

export type ProductImpactType = 'PRIMARY' | 'MAJOR' | 'MINOR' | 'DEPENDENCY';

export type ProductImpact = EntityEnvelope & {
  readonly commitmentId: EntityId;
  readonly productServiceId: EntityId;
  readonly type: ProductImpactType;
  readonly note?: string;
};

// ── Dependencies and decisions ─────────────────────────────────────────────

export type DependencyType =
  | 'REQUIRES'
  | 'BLOCKED_BY'
  | 'DEPENDS_ON_DELIVERY'
  | 'NEEDS_CAPACITY_FROM'
  | 'NEEDS_DECISION_APPROVAL_FROM';

export type DependencyStatus = 'OPEN' | 'AT_RISK' | 'RESOLVED';

export type DependencyTarget =
  | { readonly kind: 'COMMITMENT'; readonly id: EntityId }
  | { readonly kind: 'MILESTONE'; readonly id: EntityId }
  | { readonly kind: 'TEAM'; readonly id: EntityId }
  | { readonly kind: 'DECISION'; readonly id: EntityId };

/** Direction is invariant across all types: `source` waits, `target` unblocks. */
export type Dependency = EntityEnvelope & {
  readonly sourceCommitmentId: EntityId;
  readonly target: DependencyTarget;
  readonly type: DependencyType;
  readonly ownerRef?: OwnerRef;
  readonly neededBy?: IsoDate;
  readonly status: DependencyStatus;
  readonly isHard: boolean;
  readonly note?: string;
};

export const HARD_BY_DEFAULT: readonly DependencyType[] = [
  'BLOCKED_BY',
  'NEEDS_DECISION_APPROVAL_FROM',
];

export type Decision = EntityEnvelope & {
  readonly kind: 'DECISION' | 'APPROVAL';
  readonly name: string;
  readonly ownerRef?: OwnerRef;
  readonly neededBy?: IsoDate;
  readonly status: DependencyStatus;
  readonly resolutionNote?: string;
  readonly resolvedAt?: IsoDateTime;
};

// ── Milestones, themes, people, links ──────────────────────────────────────

export type Milestone = EntityEnvelope & {
  readonly commitmentId: EntityId;
  readonly name: string;
  readonly targetDate?: IsoDate;
  /** MISSED is set explicitly by a human, never derived. */
  readonly status: 'PLANNED' | 'DONE' | 'MISSED';
  readonly note?: string;
  readonly displayOrder: number;
};

export type Theme = EntityEnvelope & {
  readonly name: string;
  /** Design-token name only, never a raw colour value. */
  readonly colorToken?: string;
};

export type CommitmentTheme = EntityEnvelope & {
  readonly commitmentId: EntityId;
  readonly themeId: EntityId;
};

export type Person = EntityEnvelope & {
  readonly displayName: string;
  readonly email?: string;
  readonly roleLabel?: string;
  readonly teamId?: EntityId;
  /** Links a stakeholder record to an authenticated user without rewriting history. */
  readonly linkedUserId?: EntityId;
};

export type WorkspaceRole = 'VIEWER' | 'CONTRIBUTOR' | 'PLANNER' | 'ADMIN';

export type WorkspaceUser = EntityEnvelope & {
  /** 'local:<profileId>' or 'entra:<oid>'. */
  readonly identitySubject: string;
  readonly displayName: string;
  readonly personId?: EntityId;
  readonly role: WorkspaceRole;
};

export type ExternalLinkType =
  'AZURE_DEVOPS' | 'SERVICENOW' | 'SERVICENOW_PPM' | 'CONFLUENCE' | 'FORGE' | 'TEAMS' | 'GENERIC';

export type ExternalLink = EntityEnvelope & {
  readonly commitmentId: EntityId;
  readonly type: ExternalLinkType;
  /** HTTPS only. Enterprise systems are referenced, never embedded. */
  readonly url: string;
  readonly label?: string;
};

// ── Signals ────────────────────────────────────────────────────────────────

/**
 * Declared here rather than in `@flowmap/rules` because a disposition persists
 * one, and the domain may not depend on the rules package (spec 12 §2). The
 * evaluator imports this definition; nothing defines a second one.
 */
export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';

export const SEVERITIES: readonly Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH'];

/**
 * A user's decision about a signal.
 *
 * Keyed by `signalKey` **and** `actorId`, so a Planner's review never silently
 * hides a Contributor's signal in a shared workspace. There is deliberately no
 * `DISMISSED`: the only dispositions are "I have seen this and nothing has
 * changed" and "not now, ask me again on this date". Both lapse when the
 * situation changes or worsens — see docs/spec/04-rules-radar.md §3.3.
 */
export type SignalDisposition = EntityEnvelope & {
  readonly signalKey: string;
  readonly disposition: 'REVIEWED' | 'SNOOZED';
  /** The condition fingerprint when the decision was taken. */
  readonly atFingerprint: string;
  readonly atSeverity: Severity;
  /** SNOOZED only. A snooze without a return date would be a dismissal. */
  readonly snoozeUntil?: IsoDate;
  readonly actorId: ActorId;
  readonly note?: string;
};
