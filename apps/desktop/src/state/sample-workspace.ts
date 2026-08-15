/**
 * The sample workspace.
 *
 * First launch offers "Explore sample workspace" or "Create new workspace"
 * (spec 06 §13), and until the first exists there is nothing to look at — an
 * empty grid cannot tell you whether the visual model works.
 *
 * Seeds the canonical validation fixture: 5 teams across 6 quarters, 25 gated
 * commitments plus 10 Ideas, two engineered overloads, and carry-over. The same
 * dataset the tests, benchmarks, and demos use, so what you see is what CI
 * asserts.
 *
 * Only the entity kinds the M1 schema stores are seeded — teams, team-quarters,
 * commitments, and footprints. Products, dependencies, and milestones have no
 * tables yet (M5/M6) and nothing renders them, so seeding them would be
 * theatre.
 */

import { validationFixture, type ValidationFixture } from '@flowmap/fixtures';
import type { Command, EntityChange } from '@flowmap/domain';
import type { WorkspaceRepository } from '@flowmap/storage';

type SeedOptions = {
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
};

export async function seedSampleWorkspace(options: SeedOptions): Promise<SeedReport> {
  const fixture: ValidationFixture = validationFixture();
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
  ];

  await repository.apply({ workspaceId, changes, events: [], command });

  return {
    teams: fixture.teams.length,
    teamQuarters: fixture.teamQuarters.length,
    commitments: fixture.commitments.filter((c) => c.lifecycle !== 'IDEA').length,
    ideas: fixture.commitments.filter((c) => c.lifecycle === 'IDEA').length,
    footprints: fixture.footprints.length,
  };
}
