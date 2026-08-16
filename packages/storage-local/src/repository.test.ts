import { beforeEach, describe, expect, it } from 'vitest';

import {
  assignCapacityFootprint,
  createIdea,
  createTeam,
  createWorkspace,
  ensureTeamQuarter,
  moveCapacityFootprint,
  summariseCapacity,
  type Command,
  type CommandContext,
  type CommandResult,
} from '@flowmap/domain';
import { checksum, MigrationChecksumError, verifyIdempotent } from '@flowmap/storage';

import { NodeSqlDriver } from './node-driver.js';
import { SqliteWorkspaceRepository } from './repository.js';
import { LocalProvider } from './provider.js';
import { MIGRATIONS } from './schema.js';
import { assertNotCloudSynced, CloudSyncFolderError } from './driver.js';

const NOW = '2026-08-15T09:00:00Z';
const WS = 'ws-1';
const Q = '2026-Q3' as const;

class TestIds {
  #n = 0;
  next() {
    this.#n += 1;
    return `id-${String(this.#n).padStart(4, '0')}`;
  }
}

let ids: TestIds;

function ctx(nextSequence = 1): CommandContext {
  return {
    clock: { now: () => NOW, today: () => '2026-08-15' },
    ids,
    actorId: 'actor-1',
    role: 'PLANNER',
    nextSequence,
  };
}

function command(name: string): Command {
  return { id: ids.next(), name, workspaceId: WS, payload: {}, actorId: 'actor-1', issuedAt: NOW };
}

function unwrap(result: CommandResult) {
  if (!result.ok) throw new Error(`command failed: ${result.error.code}`);
  return result.effects;
}

async function persist(
  repo: SqliteWorkspaceRepository,
  result: CommandResult,
  cmd: Command,
): Promise<void> {
  const effects = unwrap(result);
  await repo.apply({
    workspaceId: WS,
    changes: effects.changes,
    events: effects.events,
    command: cmd,
  });
}

let driver: NodeSqlDriver;
let repo: SqliteWorkspaceRepository;

beforeEach(async () => {
  ids = new TestIds();
  driver = new NodeSqlDriver({ path: ':memory:' });
  repo = new SqliteWorkspaceRepository(driver);
  await repo.migrate({ now: () => NOW });
});

// ── Migrations ─────────────────────────────────────────────────────────────

describe('migrations', () => {
  it('applies the initial schema and records it', async () => {
    const applied = await driver.all<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM migration_log',
    );
    expect(applied.map((row) => row.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it('is a no-op on a second run', async () => {
    const before = await driver.schemaSnapshot();
    const report = await repo.migrate({ now: () => NOW });

    expect(report.applied).toHaveLength(0);
    expect(report.skipped).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await driver.schemaSnapshot()).toBe(before);
  });

  // AGENTS.md hard rule: all DB migrations must be idempotent.
  it.each(MIGRATIONS.map((m) => [m.version, m] as const))(
    'migration %i is idempotent when run twice',
    async (_version, migration) => {
      const scratch = new NodeSqlDriver({ path: ':memory:' });
      try {
        const result = await verifyIdempotent(migration, () => ({
          host: {
            currentVersion: async () => 0,
            appliedMigrations: async () => [],
            transaction: (fn) =>
              scratch.transaction(() =>
                fn({ exec: (sql) => scratch.exec(sql), get: async () => undefined }),
              ),
            record: async () => {},
            now: () => NOW,
          },
          snapshot: () => scratch.schemaSnapshot(),
        }));
        expect(result.idempotent, 'running the migration twice changed the schema').toBe(true);
      } finally {
        await scratch.close();
      }
    },
  );

  it('refuses to open a store whose applied migration has since been edited', async () => {
    await driver.run('UPDATE migration_log SET checksum = ? WHERE version = 1', ['deadbeef']);
    await expect(repo.migrate({ now: () => NOW })).rejects.toThrow(MigrationChecksumError);
  });

  it('takes a pre-migration backup when one is offered', async () => {
    const scratch = new NodeSqlDriver({ path: ':memory:' });
    const fresh = new SqliteWorkspaceRepository(scratch);
    const report = await fresh.migrate({
      now: () => NOW,
      backup: async (v) => `backup-v${v}.flowmap`,
    });

    expect(report.backupRef).toBe('backup-v0.flowmap');
    await scratch.close();
  });

  it('produces a stable checksum for the same source', () => {
    expect(checksum('abc')).toBe(checksum('abc'));
    expect(checksum('abc')).not.toBe(checksum('abd'));
  });
});

// ── Cloud-sync guard ───────────────────────────────────────────────────────

describe('cloud-sync guard', () => {
  it.each([
    '/Users/x/OneDrive - Company/flowmap.db',
    '/Users/x/Library/Mobile Documents/com~apple~CloudDocs/flowmap.db',
    '/Users/x/Dropbox/flowmap.db',
    '/Users/x/Google Drive/flowmap.db',
  ])('refuses %s', (path) => {
    expect(() => assertNotCloudSynced(path)).toThrow(CloudSyncFolderError);
  });

  it('allows an ordinary path', () => {
    expect(() =>
      assertNotCloudSynced('/Users/x/Library/Application Support/Flowmap/w.db'),
    ).not.toThrow();
  });

  it('allows an explicit override', () => {
    expect(() => assertNotCloudSynced('/Users/x/OneDrive/flowmap.db', true)).not.toThrow();
  });
});

// ── The vertical slice: create → assign → persist → reload → render ────────

describe('persistence round trip', () => {
  it('preserves the workspace across a reload with no semantic loss', async () => {
    const c1 = command('CreateWorkspace');
    await persist(
      repo,
      createWorkspace(
        { name: 'Retail', timezone: 'Europe/Amsterdam', currentQuarterId: Q },
        c1,
        ctx(),
      ),
      c1,
    );

    let state = (await repo.load(WS))!;
    expect(state.workspace.name).toBe('Retail');

    const c2 = command('CreateTeam');
    await persist(repo, createTeam(state, { name: 'Payments' }, c2, ctx(2)), c2);

    state = (await repo.load(WS))!;
    const team = [...state.teams.values()][0]!;

    const c3 = command('EnsureTeamQuarter');
    await persist(
      repo,
      ensureTeamQuarter(state, { teamId: team.id, quarterId: Q }, c3, ctx(3)),
      c3,
    );

    const c4 = command('CreateIdea');
    await persist(repo, createIdea({ name: 'SEPA instant' }, c4, ctx(4)), c4);

    state = (await repo.load(WS))!;
    const commitment = [...state.commitments.values()][0]!;

    const c5 = command('AssignCapacityFootprint');
    await persist(
      repo,
      assignCapacityFootprint(
        state,
        { commitmentId: commitment.id, teamId: team.id, quarterId: Q, size: 'L', isPrimary: true },
        c5,
        ctx(5),
      ),
      c5,
    );

    // Reload from disk and confirm the capacity projection agrees.
    const reloaded = (await repo.load(WS))!;
    expect(reloaded.teams.size).toBe(1);
    expect(reloaded.commitments.size).toBe(1);
    expect(reloaded.footprints.size).toBe(1);

    const footprint = [...reloaded.footprints.values()][0]!;
    expect(footprint.units).toBe(35);
    expect(footprint.unitsSource).toBe('SIZE_MAPPING');
    expect(footprint.sizeAtCreation).toBe('L');
    expect(footprint.isPrimary).toBe(true);

    const tq = [...reloaded.teamQuarters.values()][0]!;
    const summary = summariseCapacity({
      teamQuarter: tq,
      footprints: [...reloaded.footprints.values()],
      commitmentsById: reloaded.commitments,
      currentQuarterId: reloaded.workspace.currentQuarterId,
    });

    // IDEA does not consume capacity — the footprint exists, the load does not.
    expect(summary.deliverableCapacity).toBe(80);
    expect(summary.committedLoad).toBe(0);
  });

  it('round-trips every optional field rather than dropping undefined ones', async () => {
    const c1 = command('CreateWorkspace');
    await persist(
      repo,
      createWorkspace({ name: 'W', timezone: 'UTC', currentQuarterId: Q }, c1, ctx()),
      c1,
    );

    const state = (await repo.load(WS))!;
    expect(state.workspace.settings.capacity.sizeMapping).toEqual({ XS: 5, S: 10, M: 20, L: 35 });
    expect(state.workspace.settings.noteMaxLength).toBe(2000);
    expect(state.workspace.isSample).toBe(false);
    expect(state.workspace.archivedAt).toBeUndefined();
  });

  it('returns null for an unknown workspace', async () => {
    expect(await repo.load('nope')).toBeNull();
  });
});

// ── Transactional apply ────────────────────────────────────────────────────

describe('apply is one transaction', () => {
  it('writes changes, events and outbox entries together', async () => {
    const cmd = command('CreateIdea');
    const effects = unwrap(createIdea({ name: 'Idea' }, cmd, ctx()));
    await repo.apply({
      workspaceId: WS,
      changes: effects.changes,
      events: effects.events,
      command: cmd,
    });

    expect(await repo.listEvents(WS)).toHaveLength(1);
    expect(await repo.listOutbox(WS)).toHaveLength(1);
    expect(await driver.all('SELECT id FROM commitment')).toHaveLength(1);
  });

  it('rolls everything back when a write fails mid-apply', async () => {
    const cmd = command('CreateIdea');
    const effects = unwrap(createIdea({ name: 'Idea' }, cmd, ctx()));

    await expect(
      repo.apply({
        workspaceId: WS,
        changes: [
          ...effects.changes,
          // An unmappable entity kind throws part-way through the transaction.
          // Scenarios have no table until M4; THEME gained one in schema v2.
          {
            ref: { kind: 'SCENARIO', id: 'x' },
            op: 'CREATE',
            toVersion: 1,
            after: {},
            changedFields: [],
          },
        ],
        events: effects.events,
        command: cmd,
      }),
    ).rejects.toThrow();

    expect(
      await driver.all('SELECT id FROM commitment'),
      'partial write must not survive',
    ).toHaveLength(0);
    expect(await repo.listEvents(WS)).toHaveLength(0);
    expect(await repo.listOutbox(WS)).toHaveLength(0);
  });

  it('does not create outbox entries for scenario commands', async () => {
    const cmd = { ...command('CreateIdea'), scenarioId: 'scn-1' };
    const effects = unwrap(createIdea({ name: 'Ghost' }, cmd, ctx()));
    await repo.apply({
      workspaceId: WS,
      changes: effects.changes,
      events: effects.events,
      command: cmd,
    });

    expect(await repo.listOutbox(WS)).toHaveLength(0);
  });

  it('assigns monotonic event sequences', async () => {
    for (let i = 0; i < 3; i += 1) {
      const cmd = command('CreateIdea');
      const seq = await repo.nextSequence(WS);
      const effects = unwrap(createIdea({ name: `Idea ${i}` }, cmd, ctx(seq)));
      await repo.apply({
        workspaceId: WS,
        changes: effects.changes,
        events: effects.events,
        command: cmd,
      });
    }
    const events = await repo.listEvents(WS);
    expect(events.map((e) => e.sequence)).toEqual([3, 2, 1]);
  });
});

// ── Outbox ─────────────────────────────────────────────────────────────────

describe('outbox', () => {
  it('records the base snapshot and changed fields for field-level merge', async () => {
    const c1 = command('CreateWorkspace');
    await persist(
      repo,
      createWorkspace({ name: 'W', timezone: 'UTC', currentQuarterId: Q }, c1, ctx()),
      c1,
    );
    let state = (await repo.load(WS))!;

    const c2 = command('CreateTeam');
    await persist(repo, createTeam(state, { name: 'Payments' }, c2, ctx(2)), c2);
    state = (await repo.load(WS))!;
    const team = [...state.teams.values()][0]!;

    const c3 = command('CreateIdea');
    await persist(repo, createIdea({ name: 'X' }, c3, ctx(3)), c3);
    state = (await repo.load(WS))!;
    const commitment = [...state.commitments.values()][0]!;

    const c4 = command('AssignCapacityFootprint');
    await persist(
      repo,
      assignCapacityFootprint(
        state,
        { commitmentId: commitment.id, teamId: team.id, quarterId: Q, units: 10 },
        c4,
        ctx(4),
      ),
      c4,
    );
    state = (await repo.load(WS))!;
    const footprint = [...state.footprints.values()][0]!;

    const c5 = command('MoveCapacityFootprint');
    await persist(
      repo,
      moveCapacityFootprint(state, { footprintId: footprint.id, quarterId: '2026-Q4' }, c5, ctx(5)),
      c5,
    );

    const entries = await repo.listOutbox(WS);
    const move = entries.find((e) => e.op === 'UPDATE');
    expect(move).toBeDefined();
    expect(move!.changedFields).toEqual(['quarterId']);
    expect(move!.baseSnapshot).toBeDefined();
    expect(move!.baseVersion).toBe(1);
  });

  it('marks entries and counts attempts', async () => {
    const cmd = command('CreateIdea');
    const effects = unwrap(createIdea({ name: 'X' }, cmd, ctx()));
    await repo.apply({
      workspaceId: WS,
      changes: effects.changes,
      events: effects.events,
      command: cmd,
    });

    const [entry] = await repo.listOutbox(WS, 'PENDING');
    await repo.markOutbox([entry!.id], 'ACKED');

    const acked = await repo.listOutbox(WS, 'ACKED');
    expect(acked).toHaveLength(1);
    expect(acked[0]!.attempts).toBe(1);
    expect(await repo.listOutbox(WS, 'PENDING')).toHaveLength(0);
  });
});

// ── Local provider exercises the full sync path ────────────────────────────

describe('LocalProvider', () => {
  let provider: LocalProvider;

  beforeEach(async () => {
    provider = await LocalProvider.open(driver);
  });

  async function pushOne(operationId: string, version?: string) {
    return provider.push(WS, {
      batchId: 'batch-1',
      operations: [
        {
          operationId,
          entityRef: { kind: 'COMMITMENT', id: 'c-1' },
          op: 'CREATE',
          changedFields: ['name'],
          patch: { id: 'c-1', name: 'X', entityVersion: 1 },
          ...(version !== undefined ? { baseVersion: version } : {}),
        },
      ],
    });
  }

  it('applies a push and makes it visible to a pull', async () => {
    const result = await pushOne('op-1');
    expect(result.results[0]!.status).toBe('APPLIED');

    const page = await provider.pull(WS, null);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0]!.entityRef).toEqual({ kind: 'COMMITMENT', id: 'c-1' });
    expect(page.hasMore).toBe(false);
  });

  it('is idempotent — a replayed operation returns DUPLICATE, not a second write', async () => {
    const first = await pushOne('op-1');
    const second = await pushOne('op-1');

    expect(first.results[0]!.status).toBe('APPLIED');
    expect(second.results[0]!.status).toBe('DUPLICATE');

    const page = await provider.pull(WS, null);
    expect(page.changes, 'a replay must not create a second entity').toHaveLength(1);
  });

  it('reports a conflict when the base version has moved on', async () => {
    await pushOne('op-1');
    const stale = await pushOne('op-2', 'v-does-not-match');

    expect(stale.results[0]!.status).toBe('CONFLICT');
    if (stale.results[0]!.status === 'CONFLICT') {
      expect(stale.results[0]!.remoteVersion).toBe('v1');
    }
  });

  it('resumes a pull from its cursor with no gap and no duplicate', async () => {
    for (let i = 0; i < 5; i += 1) {
      await provider.push(WS, {
        batchId: `b-${i}`,
        operations: [
          {
            operationId: `op-${i}`,
            entityRef: { kind: 'COMMITMENT', id: `c-${i}` },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: `c-${i}`, entityVersion: 1 },
          },
        ],
      });
    }

    const first = await provider.pull(WS, null, { pageSize: 2 });
    expect(first.changes).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await provider.pull(WS, first.cursor, { pageSize: 2 });
    expect(second.changes).toHaveLength(2);

    const third = await provider.pull(WS, second.cursor, { pageSize: 2 });
    expect(third.changes).toHaveLength(1);
    expect(third.hasMore).toBe(false);

    const seen = [...first.changes, ...second.changes, ...third.changes].map((c) =>
      'id' in c.entityRef ? c.entityRef.id : '',
    );
    expect(new Set(seen).size).toBe(5);
  });

  it('surfaces a deletion as a tombstone', async () => {
    await pushOne('op-1');
    await provider.push(WS, {
      batchId: 'b-2',
      operations: [
        {
          operationId: 'op-del',
          entityRef: { kind: 'COMMITMENT', id: 'c-1' },
          op: 'DELETE',
          changedFields: [],
          patch: null,
        },
      ],
    });

    const page = await provider.pull(WS, null);
    expect(page.changes.at(-1)!.deleted).toBe(true);
  });
});

// ── Clear local data ───────────────────────────────────────────────────────

describe('clearLocalData', () => {
  it('removes everything for a workspace', async () => {
    const c1 = command('CreateWorkspace');
    await persist(
      repo,
      createWorkspace({ name: 'W', timezone: 'UTC', currentQuarterId: Q }, c1, ctx()),
      c1,
    );

    await repo.clearLocalData(WS);

    expect(await repo.load(WS)).toBeNull();
    expect(await repo.listEvents(WS)).toHaveLength(0);
    expect(await repo.listOutbox(WS)).toHaveLength(0);
  });
});

// ── Local profile ──────────────────────────────────────────────────────────

describe('local profile', () => {
  it('is created once and survives reopening', async () => {
    const first = await repo.ensureLocalProfile('profile-1', 'Ada', NOW);
    const second = await repo.ensureLocalProfile('profile-2', 'Someone else', NOW);

    expect(first.id).toBe('profile-1');
    expect(second.id, 'the existing profile wins').toBe('profile-1');
    expect(second.displayName).toBe('Ada');
  });
});

// ── Relations (schema v2) ──────────────────────────────────────────────────

/**
 * Before v2 there were no tables for any of this, so the fixture's impacts,
 * dependencies, milestones and links were silently dropped on seed — which is
 * why nothing rendered them and the detail panel had nothing to read.
 */
describe('relations round-trip', () => {
  const envelope = (id: string) => ({
    id,
    workspaceId: WS,
    schemaVersion: 2,
    entityVersion: 1,
    createdAt: NOW,
    createdBy: 'a',
    updatedAt: NOW,
    updatedBy: 'a',
  });

  async function seed(rows: ReadonlyArray<readonly [string, object]>) {
    const c1 = command('CreateWorkspace');
    await persist(
      repo,
      createWorkspace({ name: 'W', timezone: 'UTC', currentQuarterId: Q }, c1, ctx()),
      c1,
    );
    const cmd = command('Seed');
    await repo.apply({
      workspaceId: WS,
      changes: rows.map(([kind, after]) => ({
        ref: { kind, id: (after as { id: string }).id } as never,
        op: 'CREATE' as const,
        toVersion: 1,
        after,
        changedFields: Object.keys(after).sort(),
      })),
      events: [],
      command: cmd,
    });
    return (await repo.load(WS))!;
  }

  it('stores and reloads a product and a typed impact', async () => {
    const state = await seed([
      ['PRODUCT_SERVICE', { ...envelope('p-1'), name: 'Payments Hub', active: true }],
      [
        'PRODUCT_IMPACT',
        { ...envelope('pi-1'), commitmentId: 'c-1', productServiceId: 'p-1', type: 'PRIMARY' },
      ],
    ]);

    expect(state.products?.get('p-1')?.name).toBe('Payments Hub');
    expect(state.productImpacts?.get('pi-1')?.type).toBe('PRIMARY');
  });

  // The target is a tagged union stored as two columns so it can be indexed.
  it('rebuilds a dependency target from its two columns', async () => {
    const state = await seed([
      [
        'DEPENDENCY',
        {
          ...envelope('d-1'),
          sourceCommitmentId: 'c-1',
          target: { kind: 'TEAM', id: 't-9' },
          type: 'NEEDS_CAPACITY_FROM',
          status: 'OPEN',
          isHard: true,
        },
      ],
    ]);

    const dependency = state.dependencies?.get('d-1');
    expect(dependency?.target).toEqual({ kind: 'TEAM', id: 't-9' });
    expect(dependency?.isHard).toBe(true);
  });

  it('stores milestones, themes, links and decisions', async () => {
    const state = await seed([
      [
        'MILESTONE',
        {
          ...envelope('m-1'),
          commitmentId: 'c-1',
          name: 'Pilot',
          status: 'PLANNED',
          displayOrder: 0,
        },
      ],
      ['THEME', { ...envelope('th-1'), name: 'Regulatory' }],
      ['COMMITMENT_THEME', { ...envelope('ct-1'), commitmentId: 'c-1', themeId: 'th-1' }],
      [
        'EXTERNAL_LINK',
        { ...envelope('l-1'), commitmentId: 'c-1', type: 'TICKET', url: 'https://example.test/1' },
      ],
      [
        'DECISION',
        { ...envelope('dc-1'), kind: 'APPROVAL', name: 'Board sign-off', status: 'OPEN' },
      ],
    ]);

    expect(state.milestones?.get('m-1')?.name).toBe('Pilot');
    expect(state.themes?.get('th-1')?.name).toBe('Regulatory');
    expect(state.commitmentThemes?.get('ct-1')?.themeId).toBe('th-1');
    expect(state.externalLinks?.get('l-1')?.url).toBe('https://example.test/1');
    expect(state.decisions?.get('dc-1')?.kind).toBe('APPROVAL');
  });
});
