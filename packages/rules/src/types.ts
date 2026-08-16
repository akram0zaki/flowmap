/**
 * The evaluation contract.
 *
 * A rule takes state and a context and returns structured findings. It never
 * produces prose: `facts` + `threshold` + `ruleCode` render through the i18n
 * catalogue, which is what lets every signal show what happened, why it
 * matters, which threshold it crossed, and what to do — with no per-rule UI.
 *
 * Normative source: docs/spec/04-rules-radar.md §1.
 */

import type {
  ActorId,
  Clock,
  EntityId,
  EntityRef,
  IsoDate,
  ProjectionKey,
  Timezone,
  WorkspaceState,
} from '@flowmap/domain';

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';

/** Ascending, so a comparison is an index lookup rather than a switch. */
export const SEVERITY_ORDER: readonly Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH'];

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

export function compareSeverity(a: Severity, b: Severity): number {
  return severityRank(a) - severityRank(b);
}

export type RuleCategory =
  | 'CAPACITY'
  | 'DEPENDENCY'
  | 'TIMING'
  | 'HEALTH'
  | 'READINESS'
  | 'OWNERSHIP'
  | 'PRODUCT'
  | 'HISTORY'
  | 'INTEGRITY';

/**
 * Where a signal is allowed to appear.
 *
 * `HEALTH` is the one that carries a policy: health signals cannot be disposed
 * of by a user (spec 04 §2), so the surface is not cosmetic.
 */
export type Surface = 'RADAR' | 'HEALTH' | 'INLINE' | 'GATE' | 'INTEGRITY';

export type Fact = string | number | boolean;

export type SuggestedAction =
  | { readonly kind: 'OPEN'; readonly ref: EntityRef; readonly labelKey: string }
  | {
      readonly kind: 'COMMAND';
      readonly command: string;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly labelKey: string;
    }
  | {
      readonly kind: 'NAVIGATE';
      readonly lens: string;
      readonly labelKey: string;
      readonly focus?: EntityRef;
    };

export type RuleResult = {
  readonly signalKey: string;
  readonly ruleCode: RuleCode;
  readonly entityRef: EntityRef;
  readonly category: RuleCategory;
  readonly severity: Severity;
  readonly surfaces: readonly Surface[];
  /** The inputs that fired the rule. Rendered through i18n, never read as prose. */
  readonly facts: Readonly<Record<string, Fact>>;
  /** The settings that were compared against, when there were any. */
  readonly threshold?: Readonly<Record<string, number>>;
  readonly conditionFingerprint: string;
  readonly actions: readonly SuggestedAction[];
  /** Workspace-local evaluation date. */
  readonly occurredOn: IsoDate;
  /** Drives time-ordered grouping in Radar. */
  readonly dueOn?: IsoDate;
};

/**
 * Everything a rule may read beyond the workspace state. Nothing else — no
 * ambient clock, no locale, no network.
 */
export type RuleContext = {
  readonly clock: Clock;
  readonly timezone: Timezone;
  readonly settings: RuleSettings;
  readonly actorId: ActorId;
  /** Entities this user owns individually. Drives My Radar, nothing else. */
  readonly ownedRefs: ReadonlySet<string>;
  /** The person record linked to this user, when there is one. */
  readonly personId?: EntityId;
  /**
   * Counts the projection cannot answer, derived from the event log by the
   * caller.
   *
   * `WorkspaceState` is a snapshot: it knows where a commitment's target
   * quarter is now, not how many times it moved to get there. Rather than
   * denormalise a counter onto the entity — a second source of truth that sync
   * would have to keep honest — the one rule that needs history declares it,
   * and the caller supplies it from the events it already stores. Absent means
   * "not computed", and the rule stays silent rather than guessing zero.
   */
  readonly history?: {
    readonly quarterMovedLater: ReadonlyMap<EntityId, number>;
  };
};

export type RuleSettings = {
  /** Advisory rules only — see `canDisable`. */
  readonly enabled: Readonly<Partial<Record<RuleCode, boolean>>>;
  readonly thresholds: Readonly<Partial<Record<RuleCode, Readonly<Record<string, number>>>>>;
  /** May lower a severity, never raise it above the rule's declared level. */
  readonly severityOverrides: Readonly<Partial<Record<RuleCode, Severity>>>;
};

export const NO_RULE_SETTINGS: RuleSettings = {
  enabled: {},
  thresholds: {},
  severityOverrides: {},
};

/**
 * What a rule reads, as projection-key patterns.
 *
 * `capacity:*` matches every capacity key; `commitment:*` every commitment.
 * Incremental evaluation re-runs only the rules whose patterns intersect the
 * projections a command reported changing.
 */
export type ProjectionPattern =
  'capacity:*' | 'commitment:*' | 'changeLoad:*' | 'dependencyGraph' | 'radar';

export type Rule = {
  readonly code: RuleCode;
  readonly category: RuleCategory;
  /** The declared level. A workspace may lower it, never raise it. */
  readonly severity: Severity;
  readonly surfaces: readonly Surface[];
  readonly reads: readonly ProjectionPattern[];
  /**
   * Default thresholds, keyed as the catalogue names them. Absent for rules
   * that compare against nothing configurable.
   */
  readonly defaults?: Readonly<Record<string, number>>;
  /**
   * Permitted range per threshold, so a setting is rejected with the range in
   * the error rather than silently clamped.
   */
  readonly ranges?: Readonly<Record<string, readonly [number, number]>>;
  /**
   * Whether a workspace may switch this rule off. Integrity and high-severity
   * capacity rules may not — spec 04 §7.
   */
  readonly canDisable: boolean;
  /** Facts whose change means "this is now a different situation". */
  readonly materialFacts: readonly string[];
  readonly evaluate: (input: RuleInput) => readonly RuleFinding[];
};

/**
 * What a rule returns, before the engine stamps identity on it.
 *
 * Rules do not compute their own `signalKey` or fingerprint: doing that in one
 * place is what guarantees the two are derived the same way everywhere, and
 * that `materialFacts` is actually honoured rather than re-declared per rule.
 */
export type RuleFinding = {
  readonly entityRef: EntityRef;
  /** Which instance of the condition this is. Empty when the ref already says. */
  readonly discriminator?: string;
  readonly facts: Readonly<Record<string, Fact>>;
  readonly actions?: readonly SuggestedAction[];
  readonly dueOn?: IsoDate;
  /** Lowers severity for this finding only — never raises it. */
  readonly severity?: Severity;
};

export type RuleInput = {
  readonly state: WorkspaceState;
  readonly ctx: RuleContext;
  /** Today's calendar date in the workspace timezone. Resolved once per run. */
  readonly today: IsoDate;
  /** Effective thresholds: the rule's defaults with workspace overrides applied. */
  readonly threshold: Readonly<Record<string, number>>;
};

export type RuleDelta = {
  readonly added: readonly RuleResult[];
  readonly updated: readonly RuleResult[];
  readonly removed: readonly string[];
};

/** The closed set of rule codes. Every one has a positive and a negative test. */
export const RULE_CODES = [
  // capacity
  'CAP_OVERFLOW',
  'CAP_NEAR_LIMIT',
  'CAP_NO_DELIVERABLE',
  'CAP_PRIMARY_FOOTPRINT_MISSING',
  'CAP_NO_FOOTPRINT',
  'CAP_SPAN_LONG',
  'CAP_ADJUSTMENT_UNEXPLAINED',

  // dependency
  'DEP_OVERDUE',
  'DEP_DUE_SOON',
  'DEP_AT_RISK',
  'DEP_NO_NEEDED_BY',
  'DEP_TARGET_MOVED_LATE',
  'DEP_TARGET_AFTER_NEEDED_BY',
  'DEP_CYCLE',
  'DEP_HUB',
  'DEP_HUB_CONSTRAINED',
  'DEP_DECISION_OVERDUE',
  'DEP_DECISION_UNOWNED',
  'DEP_TARGET_ARCHIVED',
  'DEP_BLOCKED_IN_DELIVERY',

  // timing
  'ATT_DATE_REACHED',
  'ACT_OVERDUE',
  'ACT_DUE_SOON',
  'ACT_MISSING',
  'TGT_MISSED',
  'TGT_APPROACHING',
  'TGT_QUARTER_OVERRUN',
  'LSS_PASSED',
  'LSS_APPROACHING',
  'MS_OVERDUE',
  'MS_DUE_SOON',
  'MS_MISSED_FLAGGED',

  // readiness and governance
  'RDY_NO_PRIMARY_TEAM',
  'RDY_NO_FOOTPRINT',
  'RDY_NO_OUTCOME',
  'RDY_NO_PRODUCT_IMPACT',
  'RDY_NO_DEPENDENCIES_REVIEWED',
  'RDY_LOW_CONFIDENCE_LARGE',
  'RDY_IDEA_UNREFINED',
  'RDY_MANDATORY_NO_TARGET',
  'OWN_MISSING',
  'OWN_TEAM_ONLY_ACTION_DUE',
  'OWN_DEPENDENCY_MISSING',
  'OWN_ARCHIVED',

  // health
  'HLT_STALE_DELIVERY',
  'HLT_STALE_COMMITTED',
  'HLT_STALE_HELD',
  'HLT_MOVED_REPEATEDLY',
  'HLT_GROWN',

  // product
  'PRD_CHANGE_LOAD_HIGH',
  'PRD_CONCENTRATION',
  'PRD_MANDATORY_STACK',
  'PRD_NO_OWNER',

  // integrity
  'INT_DANGLING_REF',
  'INT_SCHEMA_AHEAD',
  'SEC_SECRET_SUSPECTED',
] as const;

export type RuleCode = (typeof RULE_CODES)[number];

/** Health level, derived from HEALTH-surfacing signals. Never a merged score. */
export type HealthLevel = 'OK' | 'WATCH' | 'AT_RISK';

export type Disposition = {
  readonly signalKey: string;
  readonly disposition: 'REVIEWED' | 'SNOOZED';
  readonly atFingerprint: string;
  readonly atSeverity: Severity;
  readonly snoozeUntil?: IsoDate;
  readonly actorId: ActorId;
};

export type { ProjectionKey };
