/**
 * Workspace, teams, products, people, themes, and capacity containers.
 *
 * Setting: a mid-sized retail bank's payments and channels portfolio. Current
 * quarter is 2026-Q3; the horizon runs 2026-Q2 … 2027-Q3.
 */

import {
  DEFAULT_CHANGE_LOAD_SETTINGS,
  DEFAULT_RESERVES,
  DEFAULT_SIZE_MAPPING,
  DEFAULT_TEAM_QUARTER_CAPACITY,
  DEFAULT_VALUE_DRIVERS,
  type CapacityReserve,
  type Person,
  type ProductService,
  type QuarterId,
  type Team,
  type TeamQuarter,
  type Theme,
  type Workspace,
} from '@flowmap/domain';
import {
  envelope,
  FIXTURE_ACTOR,
  FIXTURE_TIMEZONE,
  FIXTURE_WORKSPACE_ID,
  fixtureId,
} from '@flowmap/testing';

import {
  CURRENT_QUARTER,
  HORIZON,
  PRODUCT_NAMES,
  Q_NEXT,
  Q_NOW,
  Q_PLUS2,
  Q_PREV,
  TEAM_NAMES,
  THEME_NAMES,
  productId,
  teamId,
  teamQuarterId,
  themeId,
  type TeamName,
} from './common.js';

export const workspace: Workspace = {
  ...envelope({ id: FIXTURE_WORKSPACE_ID }),
  name: 'Retail Payments & Channels',
  timezone: FIXTURE_TIMEZONE,
  currentQuarterId: CURRENT_QUARTER,
  isSample: true,
  revision: 1,
  settings: {
    capacity: {
      defaultTeamQuarterCapacity: DEFAULT_TEAM_QUARTER_CAPACITY,
      sizeMapping: DEFAULT_SIZE_MAPPING,
      defaultReserves: DEFAULT_RESERVES,
    },
    changeLoad: DEFAULT_CHANGE_LOAD_SETTINGS,
    valueDrivers: DEFAULT_VALUE_DRIVERS,
    noteMaxLength: 2000,
    milestonesPerCommitment: 6,
  },
};

export const teams: readonly Team[] = TEAM_NAMES.map((name, index) => ({
  ...envelope({ id: teamId(name) }),
  name,
  defaultQuarterCapacity: DEFAULT_TEAM_QUARTER_CAPACITY,
  displayOrder: index,
  active: true,
}));

export const products: readonly ProductService[] = PRODUCT_NAMES.map((name) => ({
  ...envelope({ id: productId(name) }),
  name,
  active: true,
}));

export const themes: readonly Theme[] = THEME_NAMES.map((name) => ({
  ...envelope({ id: themeId(name) }),
  name,
}));

/** 8 people, of whom 2 are archived — archived owners must still render. */
const PEOPLE = [
  ['Ada Okafor', 'Portfolio lead', 'Payments', false],
  ['Bram de Vries', 'Product lead', 'Channels', false],
  ['Chen Wei', 'Tech lead', 'Platform', false],
  ['Dalia Haddad', 'Security lead', 'Security', false],
  ['Eli Novak', 'Data lead', 'Data', false],
  ['Farah Rahman', 'Delivery manager', 'Payments', false],
  ['Gus Lindqvist', 'Architect', 'Platform', true],
  ['Hana Sato', 'Product manager', 'Channels', true],
] as const;

export const people: readonly Person[] = PEOPLE.map(([displayName, roleLabel, team, archived]) => ({
  ...envelope({
    id: fixtureId(`PERSON${displayName}`),
    ...(archived ? { archivedAt: '2026-06-30T12:00:00Z', archivedBy: FIXTURE_ACTOR } : {}),
  }),
  displayName,
  roleLabel,
  teamId: teamId(team),
}));

// ── Capacity containers ────────────────────────────────────────────────────

type ReserveSpec = {
  team: TeamName;
  quarter: QuarterId;
  reserves: readonly Omit<CapacityReserve, 'id'>[];
};

/**
 * Ten hand-authored reserve sets. The rest of the containers use workspace
 * defaults (15 BAU + 5 refinement = 80 deliverable).
 */
const NON_DEFAULT_RESERVES: readonly ReserveSpec[] = [
  {
    team: 'Payments',
    quarter: Q_NOW,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 20 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 8 },
    ],
  },
  {
    team: 'Payments',
    quarter: Q_NEXT,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 20 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  },
  {
    team: 'Platform',
    quarter: Q_NOW,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 15 },
      { type: 'LCM', label: 'Platform currency', amount: 15 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  },
  {
    team: 'Platform',
    quarter: Q_NEXT,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 15 },
      { type: 'LCM', label: 'Platform currency', amount: 20 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  },
  {
    team: 'Security',
    quarter: Q_NOW,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'Security operations', amount: 25 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  },
  {
    team: 'Security',
    quarter: Q_NEXT,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'Security operations', amount: 25 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  },
  {
    team: 'Data',
    quarter: Q_NOW,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 10 },
      { type: 'OVERHEAD', label: 'Onboarding two joiners', amount: 10 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  },
  {
    team: 'Channels',
    quarter: Q_NOW,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 18 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 7 },
    ],
  },
  {
    team: 'Channels',
    quarter: Q_NEXT,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 18 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  },
  {
    team: 'Channels',
    quarter: Q_PLUS2,
    reserves: [
      { type: 'BAU_SUPPORT', label: 'BAU & support', amount: 15 },
      { type: 'REFINEMENT', label: 'Refinement', amount: 5 },
    ],
  },
];

/** Payments is short-staffed this quarter — half of why it tips into overflow. */
const CAPACITY_ADJUSTMENTS: readonly {
  team: TeamName;
  quarter: QuarterId;
  delta: number;
  note: string;
}[] = [
  { team: 'Payments', quarter: Q_NOW, delta: -10, note: 'One vacancy, recruitment in progress' },
  { team: 'Data', quarter: Q_NOW, delta: -15, note: 'Two joiners ramping up' },
];

export const teamQuarters: readonly TeamQuarter[] = TEAM_NAMES.flatMap((team) =>
  HORIZON.map((quarter): TeamQuarter => {
    const override = NON_DEFAULT_RESERVES.find((r) => r.team === team && r.quarter === quarter);
    const adjustment = CAPACITY_ADJUSTMENTS.find((a) => a.team === team && a.quarter === quarter);
    const specs = override?.reserves ?? DEFAULT_RESERVES;

    return {
      ...envelope({ id: teamQuarterId(team, quarter) }),
      teamId: teamId(team),
      quarterId: quarter,
      capacityBaseline: DEFAULT_TEAM_QUARTER_CAPACITY,
      capacityAdjustment: adjustment?.delta ?? 0,
      ...(adjustment ? { adjustmentNote: adjustment.note } : {}),
      reserves: specs.map((spec, index) => ({
        ...spec,
        id: fixtureId(`RES${team}${quarter.replace('-', '')}${index}`),
      })),
      // The quarter before the current one is closed, so carry-over is real.
      ...(quarter === Q_PREV ? { closedAt: '2026-07-01T08:00:00Z' } : {}),
    };
  }),
);

export const NON_DEFAULT_RESERVE_SET_COUNT = NON_DEFAULT_RESERVES.length;
