/**
 * The validation fixture, assembled.
 *
 * Shape is fixed by docs/spec/11-quality-performance.md §5.1 and asserted by
 * `validation.test.ts`. Changing a count means changing the spec first.
 */

import type {
  CapacityFootprint,
  Commitment,
  CommitmentTheme,
  Decision,
  Dependency,
  ExternalLink,
  Milestone,
  Person,
  ProductImpact,
  ProductService,
  QuarterId,
  Team,
  TeamQuarter,
  Theme,
  Workspace,
} from '@flowmap/domain';

import { CURRENT_QUARTER, HORIZON } from './common.js';
import { people, products, teamQuarters, teams, themes, workspace } from './structure.js';
import {
  commitmentThemes,
  commitments,
  decisions,
  dependencies,
  externalLinks,
  footprints,
  milestones,
  productImpacts,
} from './commitments.js';

export type ValidationFixture = {
  readonly workspace: Workspace;
  readonly currentQuarterId: QuarterId;
  readonly horizon: readonly QuarterId[];
  readonly teams: readonly Team[];
  readonly teamQuarters: readonly TeamQuarter[];
  readonly products: readonly ProductService[];
  readonly people: readonly Person[];
  readonly themes: readonly Theme[];
  readonly commitments: readonly Commitment[];
  readonly footprints: readonly CapacityFootprint[];
  readonly productImpacts: readonly ProductImpact[];
  readonly commitmentThemes: readonly CommitmentTheme[];
  readonly dependencies: readonly Dependency[];
  readonly decisions: readonly Decision[];
  readonly milestones: readonly Milestone[];
  readonly externalLinks: readonly ExternalLink[];
};

export function validationFixture(): ValidationFixture {
  return {
    workspace,
    currentQuarterId: CURRENT_QUARTER,
    horizon: HORIZON,
    teams,
    teamQuarters,
    products,
    people,
    themes,
    commitments,
    footprints,
    productImpacts,
    commitmentThemes,
    dependencies,
    decisions,
    milestones,
    externalLinks,
  };
}

export * from './common.js';
export * from './structure.js';
export * from './commitments.js';
