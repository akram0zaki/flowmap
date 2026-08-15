/**
 * Commitments, footprints, impacts, dependencies, decisions, milestones, links.
 *
 * Hand-authored so that the portfolio tells a coherent story rather than being
 * randomly generated noise: Payments is overloaded this quarter because a
 * regulatory item landed on a team that also lost a person; Security is a
 * dependency hub that is itself over capacity; Payments Hub absorbs a heavy
 * change quarter while its delivery teams still have headroom.
 */

import type {
  CapacityFootprint,
  Commitment,
  CommitmentClass,
  CommitmentTheme,
  Decision,
  Dependency,
  DependencyType,
  ExternalLink,
  ExternalLinkType,
  Importance,
  Lifecycle,
  Milestone,
  ProductImpact,
  ProductImpactType,
  QuarterId,
} from '@flowmap/domain';
import { envelope, fixtureId } from '@flowmap/testing';

import {
  Q_NEXT,
  Q_NOW,
  Q_PLUS2,
  Q_PLUS3,
  Q_PREV,
  commitmentId,
  decisionId,
  footprintId,
  person,
  productId,
  teamId,
  teamOwner as team,
  type ProductName,
  type TeamName,
} from './common.js';

type FootprintSpec = { team: TeamName; quarter: QuarterId; units: number; carriedFrom?: QuarterId };

type CommitmentSpec = {
  key: string;
  name: string;
  lifecycle: Lifecycle;
  class: CommitmentClass;
  importance: Importance;
  primaryTeam: TeamName;
  owner?: ReturnType<typeof person> | ReturnType<typeof team>;
  targetQuarter?: QuarterId;
  targetDate?: string;
  outcome?: string;
  footprints: readonly FootprintSpec[];
  impacts?: readonly (readonly [ProductName, ProductImpactType])[];
  themes?: readonly string[];
  attentionDate?: string;
  nextAction?: string;
  nextActionOwner?: string;
  nextActionDue?: string;
  latestSafeStart?: string;
  note?: string;
  priorActive?: 'COMMITTED' | 'IN_DELIVERY';
  lastMeaningfulUpdateAt?: string;
};

/**
 * 25 gated commitments (everything past IDEA) + 10 Ideas = 35 rows.
 *
 * Overload is engineered, not accidental:
 *  - Payments 2026-Q3: deliverable 62, load 75  → +13
 *  - Security 2026-Q3: deliverable 70, load 80  → +10
 */
const GATED: readonly CommitmentSpec[] = [
  // ── COMMITTED (9) ────────────────────────────────────────────────────────
  {
    key: 'IP-REG',
    name: 'Instant payments regulation',
    lifecycle: 'COMMITTED',
    class: 'MANDATORY',
    importance: 'HIGH',
    primaryTeam: 'Payments',
    owner: person('Ada Okafor'),
    targetQuarter: Q_NEXT,
    targetDate: '2026-12-15',
    outcome: 'Meet the instant-payments mandate without a supervisory finding.',
    footprints: [
      { team: 'Payments', quarter: Q_NOW, units: 35 },
      { team: 'Payments', quarter: Q_NEXT, units: 35 },
      { team: 'Security', quarter: Q_NOW, units: 10 },
      { team: 'Platform', quarter: Q_NEXT, units: 20 },
    ],
    impacts: [
      ['Payments Hub', 'PRIMARY'],
      ['Account & Cash Management', 'MAJOR'],
    ],
    themes: ['Regulatory'],
    attentionDate: '2026-08-20',
    nextAction: 'Confirm scope of the reachability change with the scheme',
    nextActionOwner: 'Ada Okafor',
    nextActionDue: '2026-08-18',
    latestSafeStart: '2026-08-01',
  },
  {
    key: 'FRAUD-UPLIFT',
    name: 'Fraud rules uplift',
    lifecycle: 'COMMITTED',
    class: 'STRATEGIC',
    importance: 'HIGH',
    primaryTeam: 'Security',
    owner: person('Dalia Haddad'),
    targetQuarter: Q_NEXT,
    footprints: [
      { team: 'Security', quarter: Q_NOW, units: 35 },
      { team: 'Data', quarter: Q_NEXT, units: 20 },
    ],
    impacts: [['Fraud & Screening', 'PRIMARY']],
    themes: ['Client Experience'],
  },
  {
    key: 'ONB-KYC',
    name: 'Onboarding KYC refresh',
    lifecycle: 'COMMITTED',
    class: 'MANDATORY',
    importance: 'HIGH',
    primaryTeam: 'Channels',
    owner: person('Bram de Vries'),
    targetQuarter: Q_NEXT,
    targetDate: '2026-11-30',
    footprints: [
      { team: 'Channels', quarter: Q_NEXT, units: 35 },
      { team: 'Data', quarter: Q_NEXT, units: 10 },
    ],
    impacts: [['Client Onboarding', 'PRIMARY']],
    themes: ['Regulatory'],
  },
  {
    key: 'HUB-MIGR',
    name: 'Payments hub migration wave 2',
    lifecycle: 'COMMITTED',
    class: 'STRATEGIC',
    importance: 'HIGH',
    primaryTeam: 'Platform',
    owner: person('Chen Wei'),
    targetQuarter: Q_PLUS2,
    footprints: [
      { team: 'Platform', quarter: Q_NEXT, units: 30 },
      { team: 'Platform', quarter: Q_PLUS2, units: 30 },
      { team: 'Payments', quarter: Q_PLUS2, units: 20 },
    ],
    impacts: [
      ['Payments Hub', 'MAJOR'],
      ['Account & Cash Management', 'MINOR'],
    ],
    themes: ['Resilience'],
  },
  {
    key: 'STMT-REDESIGN',
    name: 'Statement redesign',
    lifecycle: 'COMMITTED',
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    primaryTeam: 'Channels',
    owner: person('Hana Sato'),
    targetQuarter: Q_NEXT,
    footprints: [{ team: 'Channels', quarter: Q_NEXT, units: 20 }],
    impacts: [
      ['Reporting & Statements', 'PRIMARY'],
      ['Payments Hub', 'MAJOR'],
    ],
    themes: ['Client Experience'],
  },
  {
    key: 'DATA-LINEAGE',
    name: 'Regulatory data lineage',
    lifecycle: 'COMMITTED',
    class: 'MANDATORY',
    importance: 'MEDIUM',
    primaryTeam: 'Data',
    owner: team('Data'),
    targetQuarter: Q_PLUS2,
    targetDate: '2027-03-31',
    footprints: [{ team: 'Data', quarter: Q_PLUS2, units: 35 }],
    impacts: [['Reporting & Statements', 'MAJOR']],
    themes: ['Regulatory'],
  },
  {
    key: 'TLS-CURRENCY',
    name: 'TLS and cipher currency',
    lifecycle: 'COMMITTED',
    class: 'OPERATIONAL',
    importance: 'MEDIUM',
    primaryTeam: 'Security',
    owner: person('Dalia Haddad'),
    targetQuarter: Q_NEXT,
    footprints: [{ team: 'Security', quarter: Q_NEXT, units: 20 }],
    impacts: [['Payments Hub', 'DEPENDENCY']],
    themes: ['Resilience'],
  },
  {
    key: 'COST-ARCHIVE',
    name: 'Cold storage archiving',
    lifecycle: 'COMMITTED',
    class: 'DISCRETIONARY',
    importance: 'LOW',
    primaryTeam: 'Data',
    owner: person('Eli Novak'),
    targetQuarter: Q_PLUS3,
    footprints: [{ team: 'Data', quarter: Q_PLUS3, units: 20 }],
    impacts: [['Reporting & Statements', 'MINOR']],
    themes: ['Cost'],
  },
  {
    key: 'CHANNEL-A11Y',
    name: 'Channel accessibility conformance',
    lifecycle: 'COMMITTED',
    class: 'MANDATORY',
    importance: 'MEDIUM',
    primaryTeam: 'Channels',
    owner: person('Bram de Vries'),
    targetQuarter: Q_PLUS3,
    targetDate: '2027-06-30',
    footprints: [{ team: 'Channels', quarter: Q_PLUS3, units: 35 }],
    impacts: [['Client Onboarding', 'MAJOR']],
    themes: ['Regulatory', 'Client Experience'],
  },

  // ── IN_DELIVERY (7) ──────────────────────────────────────────────────────
  {
    key: 'SEPA-INST',
    name: 'SEPA instant payments',
    lifecycle: 'IN_DELIVERY',
    class: 'MANDATORY',
    importance: 'HIGH',
    primaryTeam: 'Payments',
    owner: person('Farah Rahman'),
    targetQuarter: Q_NOW,
    targetDate: '2026-09-30',
    outcome: 'Instant payment sending and receiving live for retail clients.',
    footprints: [
      { team: 'Payments', quarter: Q_NOW, units: 20 },
      { team: 'Platform', quarter: Q_NOW, units: 20 },
    ],
    impacts: [
      ['Payments Hub', 'PRIMARY'],
      ['Account & Cash Management', 'MAJOR'],
    ],
    themes: ['Regulatory'],
    nextAction: 'Sign off the scheme conformance run',
    nextActionOwner: 'Farah Rahman',
    nextActionDue: '2026-08-12',
  },
  {
    key: 'LEDGER-CORE',
    name: 'Core ledger consolidation',
    lifecycle: 'IN_DELIVERY',
    class: 'STRATEGIC',
    importance: 'HIGH',
    primaryTeam: 'Platform',
    owner: person('Chen Wei'),
    targetQuarter: Q_NEXT,
    footprints: [
      { team: 'Platform', quarter: Q_NOW, units: 25 },
      { team: 'Data', quarter: Q_NOW, units: 15 },
    ],
    impacts: [['Account & Cash Management', 'PRIMARY']],
    themes: ['Resilience'],
    lastMeaningfulUpdateAt: '2026-06-20T10:00:00Z',
  },
  {
    key: 'SCREEN-LATENCY',
    name: 'Screening latency remediation',
    lifecycle: 'IN_DELIVERY',
    class: 'OPERATIONAL',
    importance: 'HIGH',
    primaryTeam: 'Security',
    owner: person('Dalia Haddad'),
    targetQuarter: Q_NOW,
    targetDate: '2026-09-15',
    outcome: 'Screening no longer breaches the payment cut-off window.',
    footprints: [{ team: 'Security', quarter: Q_NOW, units: 35 }],
    impacts: [['Fraud & Screening', 'MAJOR']],
    themes: ['Resilience'],
    nextAction: 'Confirm the throughput fix in production',
    nextActionOwner: 'Dalia Haddad',
    nextActionDue: '2026-08-14',
  },
  {
    key: 'ONB-MOBILE',
    name: 'Mobile onboarding journey',
    lifecycle: 'IN_DELIVERY',
    class: 'STRATEGIC',
    importance: 'MEDIUM',
    primaryTeam: 'Channels',
    owner: person('Bram de Vries'),
    targetQuarter: Q_NOW,
    footprints: [{ team: 'Channels', quarter: Q_NOW, units: 30 }],
    impacts: [['Client Onboarding', 'PRIMARY']],
    themes: ['Client Experience'],
  },
  {
    key: 'RPT-REALTIME',
    name: 'Near-real-time reporting feed',
    lifecycle: 'IN_DELIVERY',
    class: 'DISCRETIONARY',
    importance: 'MEDIUM',
    primaryTeam: 'Data',
    owner: person('Eli Novak'),
    targetQuarter: Q_NEXT,
    footprints: [{ team: 'Data', quarter: Q_NOW, units: 20 }],
    impacts: [['Reporting & Statements', 'PRIMARY']],
    themes: ['Client Experience'],
  },
  {
    key: 'PAY-CARRY',
    name: 'Payment reference enrichment',
    lifecycle: 'IN_DELIVERY',
    class: 'DISCRETIONARY',
    importance: 'LOW',
    primaryTeam: 'Payments',
    owner: person('Farah Rahman'),
    targetQuarter: Q_NOW,
    // Carried over from the closed quarter — origin footprint preserved there.
    footprints: [
      { team: 'Payments', quarter: Q_PREV, units: 10 },
      { team: 'Payments', quarter: Q_NOW, units: 10, carriedFrom: Q_PREV },
    ],
    impacts: [['Payments Hub', 'MINOR']],
  },
  {
    key: 'PLAT-CARRY',
    name: 'Container platform upgrade',
    lifecycle: 'IN_DELIVERY',
    class: 'OPERATIONAL',
    importance: 'MEDIUM',
    primaryTeam: 'Platform',
    owner: person('Chen Wei'),
    targetQuarter: Q_NOW,
    footprints: [
      { team: 'Platform', quarter: Q_PREV, units: 15 },
      { team: 'Platform', quarter: Q_NOW, units: 15, carriedFrom: Q_PREV },
    ],
    themes: ['Resilience'],
  },

  // ── ON_HOLD (2) ──────────────────────────────────────────────────────────
  {
    key: 'CARD-TOKEN',
    name: 'Card tokenisation',
    lifecycle: 'ON_HOLD',
    class: 'STRATEGIC',
    importance: 'MEDIUM',
    primaryTeam: 'Payments',
    owner: person('Ada Okafor'),
    priorActive: 'COMMITTED',
    targetQuarter: Q_PLUS2,
    footprints: [{ team: 'Payments', quarter: Q_PLUS2, units: 20 }],
    impacts: [['Payments Hub', 'MAJOR']],
    note: 'On hold pending the scheme roadmap decision.',
  },
  {
    key: 'DATA-MESH',
    name: 'Data mesh pilot',
    lifecycle: 'ON_HOLD',
    class: 'DISCRETIONARY',
    importance: 'LOW',
    primaryTeam: 'Data',
    owner: team('Data'),
    priorActive: 'IN_DELIVERY',
    targetQuarter: Q_PLUS3,
    footprints: [{ team: 'Data', quarter: Q_PLUS3, units: 15 }],
  },

  // ── DONE (5) ─────────────────────────────────────────────────────────────
  {
    key: 'LEGACY-DECOM',
    name: 'Legacy gateway decommission',
    lifecycle: 'DONE',
    class: 'OPERATIONAL',
    importance: 'MEDIUM',
    primaryTeam: 'Payments',
    owner: person('Farah Rahman'),
    targetQuarter: Q_NOW,
    footprints: [{ team: 'Payments', quarter: Q_NOW, units: 10 }],
    impacts: [['Payments Hub', 'MINOR']],
    themes: ['Cost'],
  },
  {
    key: 'PSD2-UPLIFT',
    name: 'PSD2 consent uplift',
    lifecycle: 'DONE',
    class: 'MANDATORY',
    importance: 'HIGH',
    primaryTeam: 'Channels',
    owner: person('Bram de Vries'),
    targetQuarter: Q_PREV,
    targetDate: '2026-06-30',
    footprints: [{ team: 'Channels', quarter: Q_PREV, units: 30 }],
    impacts: [['Client Onboarding', 'MAJOR']],
    themes: ['Regulatory'],
  },
  {
    key: 'DR-EXERCISE',
    name: 'Disaster recovery exercise',
    lifecycle: 'DONE',
    class: 'OPERATIONAL',
    importance: 'MEDIUM',
    primaryTeam: 'Platform',
    owner: person('Chen Wei'),
    targetQuarter: Q_PREV,
    footprints: [{ team: 'Platform', quarter: Q_PREV, units: 15 }],
    themes: ['Resilience'],
  },
  {
    key: 'SANCTIONS-LIST',
    name: 'Sanctions list refresh automation',
    lifecycle: 'DONE',
    class: 'MANDATORY',
    importance: 'HIGH',
    primaryTeam: 'Security',
    owner: person('Dalia Haddad'),
    targetQuarter: Q_PREV,
    footprints: [{ team: 'Security', quarter: Q_PREV, units: 20 }],
    impacts: [['Fraud & Screening', 'MAJOR']],
    themes: ['Regulatory'],
  },
  {
    key: 'RPT-COST',
    name: 'Reporting cost reduction',
    lifecycle: 'DONE',
    class: 'DISCRETIONARY',
    importance: 'LOW',
    primaryTeam: 'Data',
    owner: person('Eli Novak'),
    targetQuarter: Q_PREV,
    footprints: [{ team: 'Data', quarter: Q_PREV, units: 10 }],
    themes: ['Cost'],
  },

  // ── DROPPED (2) ──────────────────────────────────────────────────────────
  {
    key: 'WALLET-PILOT',
    name: 'Third-party wallet pilot',
    lifecycle: 'DROPPED',
    class: 'DISCRETIONARY',
    importance: 'LOW',
    primaryTeam: 'Channels',
    owner: person('Hana Sato'),
    targetQuarter: Q_NEXT,
    footprints: [{ team: 'Channels', quarter: Q_NEXT, units: 20 }],
    note: 'Dropped at QBR — partner withdrew.',
  },
  {
    key: 'BATCH-REWRITE',
    name: 'Batch scheduler rewrite',
    lifecycle: 'DROPPED',
    class: 'OPERATIONAL',
    importance: 'MEDIUM',
    primaryTeam: 'Platform',
    owner: team('Platform'),
    targetQuarter: Q_PLUS2,
    footprints: [{ team: 'Platform', quarter: Q_PLUS2, units: 35 }],
    note: 'Superseded by the hub migration.',
  },
];

/** 10 Ideas in the demand lane. None occupies a capacity block. */
const IDEAS: readonly CommitmentSpec[] = [
  ['REQ-TO-PAY', 'Request to pay', 'Payments', 'STRATEGIC', 'HIGH'],
  ['FX-PRICING', 'FX pricing transparency', 'Payments', 'DISCRETIONARY', 'MEDIUM'],
  ['BIOMETRIC-AUTH', 'Biometric authentication', 'Channels', 'STRATEGIC', 'HIGH'],
  ['SME-DASHBOARD', 'SME cash dashboard', 'Channels', 'DISCRETIONARY', 'MEDIUM'],
  ['GRAPH-FRAUD', 'Graph-based fraud detection', 'Security', 'STRATEGIC', 'MEDIUM'],
  ['ZERO-TRUST', 'Zero-trust network segmentation', 'Security', 'OPERATIONAL', 'MEDIUM'],
  ['EVENT-BACKBONE', 'Event backbone consolidation', 'Platform', 'STRATEGIC', 'HIGH'],
  ['COST-OBS', 'Cost observability', 'Platform', 'DISCRETIONARY', 'LOW'],
  ['SELF-SERVE-RPT', 'Self-serve reporting', 'Data', 'DISCRETIONARY', 'MEDIUM'],
  ['DQ-SCORECARD', 'Data quality scorecard', 'Data', 'OPERATIONAL', 'LOW'],
].map(([key, name, primaryTeam, cls, importance]) => ({
  key: key as string,
  name: name as string,
  lifecycle: 'IDEA' as const,
  class: cls as CommitmentClass,
  importance: importance as Importance,
  primaryTeam: primaryTeam as TeamName,
  footprints: [],
}));

const ALL_SPECS: readonly CommitmentSpec[] = [...GATED, ...IDEAS];

// ── Materialisation ────────────────────────────────────────────────────────

export const commitments: readonly Commitment[] = ALL_SPECS.map((spec) => ({
  ...envelope({ id: commitmentId(spec.key) }),
  name: spec.name,
  lifecycle: spec.lifecycle,
  class: spec.class,
  importance: spec.importance,
  primaryTeamId: teamId(spec.primaryTeam),
  valueDrivers: [],
  ...(spec.owner ? { ownerRef: spec.owner } : {}),
  ...(spec.targetQuarter ? { targetQuarterId: spec.targetQuarter } : {}),
  ...(spec.targetDate ? { targetDate: spec.targetDate } : {}),
  ...(spec.outcome ? { outcome: spec.outcome } : {}),
  ...(spec.attentionDate ? { attentionDate: spec.attentionDate } : {}),
  ...(spec.nextAction ? { nextAction: spec.nextAction } : {}),
  ...(spec.nextActionOwner ? { nextActionOwnerRef: person(spec.nextActionOwner) } : {}),
  ...(spec.nextActionDue ? { nextActionDueDate: spec.nextActionDue } : {}),
  ...(spec.latestSafeStart ? { latestSafeStart: spec.latestSafeStart } : {}),
  ...(spec.note ? { managementNote: spec.note } : {}),
  ...(spec.priorActive ? { priorActiveLifecycle: spec.priorActive } : {}),
  ...(spec.lastMeaningfulUpdateAt ? { lastMeaningfulUpdateAt: spec.lastMeaningfulUpdateAt } : {}),
  ...(spec.lifecycle !== 'IDEA'
    ? { committedAt: '2026-04-01T09:00:00Z', committedBy: 'local:fixture-planner' }
    : {}),
}));

export const footprints: readonly CapacityFootprint[] = ALL_SPECS.flatMap((spec) =>
  spec.footprints.map((fp, index): CapacityFootprint => {
    const isPrimary =
      fp.team === spec.primaryTeam &&
      index === spec.footprints.findIndex((f) => f.team === spec.primaryTeam);
    return {
      ...envelope({ id: footprintId(spec.key, fp.team, fp.quarter) }),
      commitmentId: commitmentId(spec.key),
      teamId: teamId(fp.team),
      quarterId: fp.quarter,
      units: fp.units,
      unitsSource: fp.carriedFrom ? 'CARRY_OVER' : 'EXPLICIT',
      isPrimary,
      ...(fp.carriedFrom
        ? {
            carryOverFromQuarterId: fp.carriedFrom,
            carryOverFromFootprintId: footprintId(spec.key, fp.team, fp.carriedFrom),
          }
        : {}),
    };
  }),
);

export const productImpacts: readonly ProductImpact[] = ALL_SPECS.flatMap((spec) =>
  (spec.impacts ?? []).map(([product, type]) => ({
    ...envelope({ id: fixtureId(`IMP${spec.key}${product}`) }),
    commitmentId: commitmentId(spec.key),
    productServiceId: productId(product),
    type,
  })),
);

export const commitmentThemes: readonly CommitmentTheme[] = ALL_SPECS.flatMap((spec) =>
  (spec.themes ?? []).map((theme) => ({
    ...envelope({ id: fixtureId(`CT${spec.key}${theme}`) }),
    commitmentId: commitmentId(spec.key),
    themeId: fixtureId(`THEME${theme}`),
  })),
);

// ── Decisions ──────────────────────────────────────────────────────────────

const DECISION_SPECS = [
  ['ARCH-HUB', 'Hub target architecture sign-off', 'DECISION', 'Chen Wei', '2026-09-01', 'OPEN'],
  [
    'SCHEME-ROADMAP',
    'Card scheme roadmap decision',
    'DECISION',
    undefined,
    '2026-08-10',
    'AT_RISK',
  ],
  [
    'SEC-EXEMPTION',
    'Security exemption approval',
    'APPROVAL',
    'Dalia Haddad',
    '2026-08-25',
    'OPEN',
  ],
  ['DATA-RESIDENCY', 'Data residency approval', 'APPROVAL', 'Eli Novak', undefined, 'OPEN'],
] as const;

export const decisions: readonly Decision[] = DECISION_SPECS.map(
  ([key, name, kind, ownerName, neededBy, status]) => ({
    ...envelope({ id: decisionId(key) }),
    kind,
    name,
    status,
    ...(ownerName ? { ownerRef: person(ownerName) } : {}),
    ...(neededBy ? { neededBy } : {}),
  }),
);

// ── Dependencies — 30, with ARCH-HUB as a hub of in-degree 6 ───────────────

type DepSpec = {
  source: string;
  target: { kind: 'COMMITMENT' | 'DECISION' | 'TEAM' | 'MILESTONE'; key: string };
  type: DependencyType;
  status?: 'OPEN' | 'AT_RISK' | 'RESOLVED';
  neededBy?: string;
  owner?: string;
};

const DEPENDENCIES: readonly DepSpec[] = [
  // The decision hub: six commitments waiting on the hub architecture sign-off.
  {
    source: 'HUB-MIGR',
    target: { kind: 'DECISION', key: 'ARCH-HUB' },
    type: 'NEEDS_DECISION_APPROVAL_FROM',
    neededBy: '2026-09-01',
  },
  {
    source: 'LEDGER-CORE',
    target: { kind: 'DECISION', key: 'ARCH-HUB' },
    type: 'NEEDS_DECISION_APPROVAL_FROM',
    neededBy: '2026-09-01',
  },
  {
    source: 'IP-REG',
    target: { kind: 'DECISION', key: 'ARCH-HUB' },
    type: 'NEEDS_DECISION_APPROVAL_FROM',
    neededBy: '2026-08-25',
  },
  {
    source: 'SEPA-INST',
    target: { kind: 'DECISION', key: 'ARCH-HUB' },
    type: 'NEEDS_DECISION_APPROVAL_FROM',
    neededBy: '2026-08-20',
    status: 'AT_RISK',
  },
  { source: 'PAY-CARRY', target: { kind: 'DECISION', key: 'ARCH-HUB' }, type: 'REQUIRES' },
  {
    source: 'STMT-REDESIGN',
    target: { kind: 'DECISION', key: 'ARCH-HUB' },
    type: 'REQUIRES',
    neededBy: '2026-10-01',
  },

  // Other decisions
  {
    source: 'CARD-TOKEN',
    target: { kind: 'DECISION', key: 'SCHEME-ROADMAP' },
    type: 'NEEDS_DECISION_APPROVAL_FROM',
    neededBy: '2026-08-10',
  },
  {
    source: 'FRAUD-UPLIFT',
    target: { kind: 'DECISION', key: 'SEC-EXEMPTION' },
    type: 'NEEDS_DECISION_APPROVAL_FROM',
    neededBy: '2026-08-25',
  },
  { source: 'RPT-REALTIME', target: { kind: 'DECISION', key: 'DATA-RESIDENCY' }, type: 'REQUIRES' },
  {
    source: 'DATA-LINEAGE',
    target: { kind: 'DECISION', key: 'DATA-RESIDENCY' },
    type: 'REQUIRES',
    neededBy: '2026-11-01',
  },

  // Commitment-to-commitment
  {
    source: 'IP-REG',
    target: { kind: 'COMMITMENT', key: 'SEPA-INST' },
    type: 'DEPENDS_ON_DELIVERY',
    neededBy: '2026-09-30',
  },
  {
    source: 'IP-REG',
    target: { kind: 'COMMITMENT', key: 'LEDGER-CORE' },
    type: 'REQUIRES',
    neededBy: '2026-11-01',
  },
  {
    source: 'HUB-MIGR',
    target: { kind: 'COMMITMENT', key: 'LEDGER-CORE' },
    type: 'BLOCKED_BY',
    neededBy: '2026-12-01',
  },
  {
    source: 'STMT-REDESIGN',
    target: { kind: 'COMMITMENT', key: 'RPT-REALTIME' },
    type: 'DEPENDS_ON_DELIVERY',
    neededBy: '2026-11-15',
  },
  {
    source: 'ONB-KYC',
    target: { kind: 'COMMITMENT', key: 'ONB-MOBILE' },
    type: 'DEPENDS_ON_DELIVERY',
    neededBy: '2026-10-15',
  },
  {
    source: 'FRAUD-UPLIFT',
    target: { kind: 'COMMITMENT', key: 'SCREEN-LATENCY' },
    type: 'BLOCKED_BY',
    neededBy: '2026-09-15',
    status: 'AT_RISK',
  },
  { source: 'CHANNEL-A11Y', target: { kind: 'COMMITMENT', key: 'ONB-MOBILE' }, type: 'REQUIRES' },
  {
    source: 'COST-ARCHIVE',
    target: { kind: 'COMMITMENT', key: 'DATA-LINEAGE' },
    type: 'REQUIRES',
    neededBy: '2027-04-01',
  },
  {
    source: 'CARD-TOKEN',
    target: { kind: 'COMMITMENT', key: 'HUB-MIGR' },
    type: 'DEPENDS_ON_DELIVERY',
  },
  {
    source: 'PLAT-CARRY',
    target: { kind: 'COMMITMENT', key: 'DR-EXERCISE' },
    type: 'REQUIRES',
    status: 'RESOLVED',
  },
  {
    source: 'SEPA-INST',
    target: { kind: 'COMMITMENT', key: 'TLS-CURRENCY' },
    type: 'REQUIRES',
    neededBy: '2026-09-20',
  },
  {
    source: 'RPT-REALTIME',
    target: { kind: 'COMMITMENT', key: 'LEDGER-CORE' },
    type: 'DEPENDS_ON_DELIVERY',
    neededBy: '2026-10-31',
  },
  { source: 'DATA-MESH', target: { kind: 'COMMITMENT', key: 'RPT-REALTIME' }, type: 'REQUIRES' },
  {
    source: 'SME-DASHBOARD',
    target: { kind: 'COMMITMENT', key: 'RPT-REALTIME' },
    type: 'REQUIRES',
  },
  { source: 'BIOMETRIC-AUTH', target: { kind: 'COMMITMENT', key: 'ONB-MOBILE' }, type: 'REQUIRES' },

  // A deliberate two-node cycle: representable, warned about, never blocked.
  {
    source: 'EVENT-BACKBONE',
    target: { kind: 'COMMITMENT', key: 'GRAPH-FRAUD' },
    type: 'REQUIRES',
  },
  {
    source: 'GRAPH-FRAUD',
    target: { kind: 'COMMITMENT', key: 'EVENT-BACKBONE' },
    type: 'REQUIRES',
  },

  // Capacity dependencies onto teams
  {
    source: 'IP-REG',
    target: { kind: 'TEAM', key: 'Security' },
    type: 'NEEDS_CAPACITY_FROM',
    neededBy: '2026-09-01',
  },
  {
    source: 'ONB-KYC',
    target: { kind: 'TEAM', key: 'Data' },
    type: 'NEEDS_CAPACITY_FROM',
    neededBy: '2026-10-01',
  },
  {
    source: 'HUB-MIGR',
    target: { kind: 'TEAM', key: 'Payments' },
    type: 'NEEDS_CAPACITY_FROM',
    neededBy: '2027-01-15',
  },
];

const HARD_TYPES: readonly DependencyType[] = ['BLOCKED_BY', 'NEEDS_DECISION_APPROVAL_FROM'];

export const dependencies: readonly Dependency[] = DEPENDENCIES.map((spec, index) => ({
  ...envelope({ id: fixtureId(`DEP${index}`) }),
  sourceCommitmentId: commitmentId(spec.source),
  target:
    spec.target.kind === 'DECISION'
      ? { kind: 'DECISION', id: decisionId(spec.target.key) }
      : spec.target.kind === 'TEAM'
        ? { kind: 'TEAM', id: teamId(spec.target.key as TeamName) }
        : spec.target.kind === 'MILESTONE'
          ? { kind: 'MILESTONE', id: fixtureId(`MS${spec.target.key}`) }
          : { kind: 'COMMITMENT', id: commitmentId(spec.target.key) },
  type: spec.type,
  status: spec.status ?? 'OPEN',
  isHard: HARD_TYPES.includes(spec.type),
  ...(spec.neededBy ? { neededBy: spec.neededBy } : {}),
  ...(spec.owner ? { ownerRef: person(spec.owner) } : {}),
}));

// ── Milestones — 12 ────────────────────────────────────────────────────────

const MILESTONE_SPECS = [
  ['SEPA-INST', 'Scheme conformance passed', '2026-08-31', 'PLANNED'],
  ['SEPA-INST', 'Production go-live', '2026-09-30', 'PLANNED'],
  ['IP-REG', 'Regulatory gap analysis complete', '2026-08-01', 'DONE'],
  ['IP-REG', 'Reachability change live', '2026-11-15', 'PLANNED'],
  ['IP-REG', 'Supervisory submission', '2026-12-15', 'PLANNED'],
  ['HUB-MIGR', 'Wave 2 cutover plan approved', '2026-11-01', 'PLANNED'],
  ['HUB-MIGR', 'Wave 2 cutover', '2027-02-28', 'PLANNED'],
  ['LEDGER-CORE', 'Dual-run started', '2026-07-15', 'MISSED'],
  ['ONB-KYC', 'Refresh campaign launched', '2026-11-30', 'PLANNED'],
  ['SCREEN-LATENCY', 'Throughput fix in production', '2026-08-20', 'PLANNED'],
  ['CHANNEL-A11Y', 'External audit booked', '2027-04-01', 'PLANNED'],
  ['DATA-LINEAGE', 'Lineage catalogue populated', '2027-03-01', 'PLANNED'],
] as const;

export const milestones: readonly Milestone[] = MILESTONE_SPECS.map(
  ([commitmentKey, name, targetDate, status], index) => ({
    ...envelope({ id: fixtureId(`MS${commitmentKey}${index}`) }),
    commitmentId: commitmentId(commitmentKey),
    name,
    targetDate,
    status,
    displayOrder: index,
  }),
);

// ── External links — 10, covering all 7 types ──────────────────────────────

const LINK_SPECS: readonly (readonly [string, ExternalLinkType, string])[] = [
  ['SEPA-INST', 'AZURE_DEVOPS', 'https://dev.azure.com/example/payments/_backlogs/backlog/sepa'],
  ['SEPA-INST', 'CONFLUENCE', 'https://example.atlassian.net/wiki/spaces/PAY/pages/sepa'],
  ['IP-REG', 'SERVICENOW_PPM', 'https://example.service-now.com/ppm?id=IPREG'],
  ['IP-REG', 'FORGE', 'https://forge.example.com/services/payments-hub'],
  ['SCREEN-LATENCY', 'SERVICENOW', 'https://example.service-now.com/incident?id=INC0123456'],
  ['HUB-MIGR', 'TEAMS', 'https://teams.microsoft.com/l/channel/hub-migration'],
  ['HUB-MIGR', 'AZURE_DEVOPS', 'https://dev.azure.com/example/platform/_backlogs/backlog/hub'],
  ['ONB-KYC', 'GENERIC', 'https://example.com/kyc-refresh-plan'],
  ['LEDGER-CORE', 'CONFLUENCE', 'https://example.atlassian.net/wiki/spaces/PLT/pages/ledger'],
  ['FRAUD-UPLIFT', 'FORGE', 'https://forge.example.com/services/fraud-screening'],
];

export const externalLinks: readonly ExternalLink[] = LINK_SPECS.map(
  ([commitmentKey, type, url], index) => ({
    ...envelope({ id: fixtureId(`LINK${index}`) }),
    commitmentId: commitmentId(commitmentKey),
    type,
    url,
  }),
);

export const COMMITMENT_KEYS = ALL_SPECS.map((spec) => spec.key);
export const GATED_COUNT = GATED.length;
export const IDEA_COUNT = IDEAS.length;
