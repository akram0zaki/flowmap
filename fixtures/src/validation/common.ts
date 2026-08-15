/**
 * Shared constants and id helpers for the validation fixture.
 *
 * Lives apart from the entity modules so those can reference the same quarters
 * and ids without importing each other.
 */

import { horizonWindow, type EntityId, type QuarterId } from '@flowmap/domain';
import { fixtureId } from '@flowmap/testing';

/** 2026-08-15 (the fixture instant) falls in Q3. */
export const CURRENT_QUARTER: QuarterId = '2026-Q3';

/** Six quarters: 2026-Q2 … 2027-Q3. */
export const HORIZON: readonly QuarterId[] = horizonWindow(CURRENT_QUARTER, 'HORIZON');

export const [Q_PREV, Q_NOW, Q_NEXT, Q_PLUS2, Q_PLUS3, Q_PLUS4] = HORIZON as [
  QuarterId,
  QuarterId,
  QuarterId,
  QuarterId,
  QuarterId,
  QuarterId,
];

export const TEAM_NAMES = ['Payments', 'Platform', 'Security', 'Data', 'Channels'] as const;
export type TeamName = (typeof TEAM_NAMES)[number];

export const PRODUCT_NAMES = [
  'Account & Cash Management',
  'Payments Hub',
  'Client Onboarding',
  'Reporting & Statements',
  'Fraud & Screening',
] as const;
export type ProductName = (typeof PRODUCT_NAMES)[number];

export const THEME_NAMES = ['Resilience', 'Regulatory', 'Client Experience', 'Cost'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export const teamId = (name: TeamName): EntityId => fixtureId(`TEAM${name}`);
export const productId = (name: ProductName): EntityId => fixtureId(`PROD${name}`);
export const themeId = (name: ThemeName): EntityId => fixtureId(`THEME${name}`);
export const personId = (displayName: string): EntityId => fixtureId(`PERSON${displayName}`);
export const commitmentId = (key: string): EntityId => fixtureId(`CMT${key}`);
export const decisionId = (key: string): EntityId => fixtureId(`DEC${key}`);
export const teamQuarterId = (team: TeamName, quarter: QuarterId): EntityId =>
  fixtureId(`TQ${team}${quarter.replace('-', '')}`);
export const footprintId = (key: string, team: TeamName, quarter: QuarterId): EntityId =>
  fixtureId(`FP${key}${team}${quarter.replace('-', '')}`);

export const person = (displayName: string) =>
  ({ kind: 'PERSON', personId: personId(displayName) }) as const;
export const teamOwner = (name: TeamName) => ({ kind: 'TEAM', teamId: teamId(name) }) as const;
