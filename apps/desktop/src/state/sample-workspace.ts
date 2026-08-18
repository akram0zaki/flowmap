/**
 * The sample workspace.
 *
 * First launch offers "Explore sample workspace" or "Create new workspace"
 * (spec 06 §13). The sample is its own workspace — always listed in the
 * switcher, resettable, never written over the user's empty portfolio.
 *
 * Seeds the canonical validation fixture: 5 teams across 6 quarters, 25 gated
 * commitments plus 10 Ideas, two engineered overloads, and carry-over. The same
 * dataset the tests, benchmarks, and demos use, so what you see is what CI
 * asserts.
 *
 * Everything the fixture carries is seeded, now that schema v2 has tables for
 * the relations. Products, impacts, themes, dependencies, decisions, milestones
 * and links were previously dropped on the floor — which is why the detail
 * panel had nothing to show and the "dependency-caused bottleneck" the
 * validation script describes was nowhere on screen.
 */

/** Stable id used when no sample workspace exists yet. */
export const SAMPLE_WORKSPACE_ID = 'flowmap-sample-workspace';

import { scaleFixture, validationFixture, type ValidationFixture } from '@flowmap/fixtures';
import type { Command, EntityChange } from '@flowmap/domain';
import type { WorkspaceRepository } from '@flowmap/storage';

type SeedOptions = {
  /** 25, 100 or 500 loads a scale fixture instead of the validation one. */
  readonly scale?: 25 | 100 | 500;
  readonly repository: WorkspaceRepository;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly now: string;
  readonly newId: () => string;
};

/** Counts shown after seeding, so the action reports what it actually did. */
export type SeedReport = {
  readonly teams: number;
  readonly teamQuarters: number;
  readonly commitments: number;
  readonly footprints: number;
  readonly ideas: number;
  readonly relations: number;
};

export async function seedSampleWorkspace(options: SeedOptions): Promise<SeedReport> {
  // The scale fixtures carry no relations; they exist to measure rendering and
  // capacity at size, and the validation fixture is what exercises meaning.
  const fixture: ValidationFixture = options.scale
    ? ({ ...validationFixture(), ...scaleFixture(options.scale) } as ValidationFixture)
    : validationFixture();
  const { repository, workspaceId, actorId, now, newId } = options;

  // A sample is a replacement, not an overlay — otherwise a second click
  // doubles every team.
  await repository.clearLocalData(workspaceId);

  const command: Command = {
    id: newId(),
    name: 'LoadSampleWorkspace',
    workspaceId,
    payload: {},
    actorId,
    issuedAt: now,
    reason: 'Sample workspace',
  };

  // The fixture carries its own workspace id; re-key everything onto the one
  // this installation uses.
  const rekey = <T extends { workspaceId: string }>(entity: T): T => ({ ...entity, workspaceId });

  const changes: EntityChange[] = [
    {
      ref: { kind: 'WORKSPACE', id: workspaceId },
      op: 'CREATE',
      toVersion: 1,
      after: { ...rekey(fixture.workspace), id: workspaceId, isSample: true },
      changedFields: ['name', 'timezone', 'currentQuarterId', 'isSample', 'settings', 'revision'],
    },
    ...fixture.teams.map((team): EntityChange => ({
      ref: { kind: 'TEAM', id: team.id },
      op: 'CREATE',
      toVersion: 1,
      after: rekey(team),
      changedFields: ['name', 'defaultQuarterCapacity', 'displayOrder', 'active'],
    })),
    ...fixture.teamQuarters.map((tq): EntityChange => ({
      ref: { kind: 'TEAM_QUARTER', id: tq.id },
      op: 'CREATE',
      toVersion: 1,
      after: rekey(tq),
      changedFields: ['teamId', 'quarterId', 'capacityBaseline', 'capacityAdjustment', 'reserves'],
    })),
    ...fixture.commitments.map((commitment): EntityChange => ({
      ref: { kind: 'COMMITMENT', id: commitment.id },
      op: 'CREATE',
      toVersion: 1,
      after: rekey(commitment),
      changedFields: ['name', 'lifecycle', 'class', 'importance', 'primaryTeamId'],
    })),
    ...fixture.footprints.map((footprint): EntityChange => ({
      ref: { kind: 'CAPACITY_FOOTPRINT', id: footprint.id },
      op: 'CREATE',
      toVersion: 1,
      after: rekey(footprint),
      changedFields: ['commitmentId', 'teamId', 'quarterId', 'units', 'isPrimary'],
    })),
    ...relationChanges(fixture, rekey),
  ];

  await repository.apply({ workspaceId, changes, events: [], command });

  return {
    teams: fixture.teams.length,
    teamQuarters: fixture.teamQuarters.length,
    commitments: fixture.commitments.filter((c) => c.lifecycle !== 'IDEA').length,
    ideas: fixture.commitments.filter((c) => c.lifecycle === 'IDEA').length,
    footprints: fixture.footprints.length,
    relations: relationChanges(fixture, (e) => e).length,
  };
}

/**
 * Products, impacts, themes, dependencies, decisions, milestones and links.
 *
 * `changedFields` is the entity's own keys: a seed creates the whole row, and
 * naming a subset would misreport what the change actually contained.
 */
function relationChanges(
  fixture: ValidationFixture,
  rekey: <T extends { workspaceId: string }>(entity: T) => T,
): EntityChange[] {
  type Row = { workspaceId: string; id: string };
  const groups: ReadonlyArray<readonly [EntityChange['ref']['kind'], ReadonlyArray<Row>]> = [
    ['PRODUCT_SERVICE', fixture.products],
    ['PERSON', fixture.people],
    ['THEME', fixture.themes],
    ['DECISION', fixture.decisions],
    ['PRODUCT_IMPACT', fixture.productImpacts],
    ['COMMITMENT_THEME', fixture.commitmentThemes],
    ['MILESTONE', fixture.milestones],
    ['DEPENDENCY', fixture.dependencies],
    ['EXTERNAL_LINK', fixture.externalLinks],
  ];

  return groups.flatMap(([kind, entities]) =>
    entities.map((entity): EntityChange => {
      const row = rekey(entity);
      return {
        ref: { kind, id: row.id } as EntityChange['ref'],
        op: 'CREATE',
        toVersion: 1,
        after: row,
        changedFields: Object.keys(row).sort(),
      };
    }),
  );
}
