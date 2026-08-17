/**
 * The in-memory repository is what the browser build runs on, and it is a
 * separate implementation from the SQLite one. That means the two can drift —
 * and they did: schema v2 gave SQLite tables for products, impacts,
 * dependencies, milestones, themes and links, while this one still had nowhere
 * to put them, so seeding the sample workspace threw and the board came up
 * empty. These tests pin the mapping rather than trusting anyone to remember.
 */

import { describe, expect, it } from 'vitest';
import type { Command, EntityChange, EntityKind } from '@flowmap/domain';

import { MemoryWorkspaceRepository } from './memory.js';

const WS = 'ws-1';
const NOW = '2026-08-15T09:00:00Z';

/**
 * Every kind that has somewhere to live. Anything the domain can emit a change
 * for must appear here, or `apply` throws at runtime rather than at build time.
 */
const STORED_KINDS: readonly EntityKind[] = [
  'WORKSPACE',
  'TEAM',
  'TEAM_QUARTER',
  'COMMITMENT',
  'CAPACITY_FOOTPRINT',
  'PRODUCT_SERVICE',
  'PRODUCT_IMPACT',
  'DEPENDENCY',
  'DECISION',
  'MILESTONE',
  'THEME',
  'COMMITMENT_THEME',
  'EXTERNAL_LINK',
  'PERSON',
  'WORKSPACE_USER',
  'SCENARIO',
];

function command(name: string): Command {
  return {
    id: `cmd-${name}`,
    name,
    workspaceId: WS,
    payload: {},
    actorId: 'local:test',
    issuedAt: NOW,
  };
}

function change(kind: EntityKind, id: string): EntityChange {
  return {
    ref: { kind, id } as EntityChange['ref'],
    op: 'CREATE',
    toVersion: 1,
    after: {
      id,
      workspaceId: WS,
      schemaVersion: 2,
      entityVersion: 1,
      createdAt: NOW,
      createdBy: 'a',
      updatedAt: NOW,
      updatedBy: 'a',
      name: `${kind} ${id}`,
    },
    changedFields: ['name'],
  };
}

describe('MemoryWorkspaceRepository', () => {
  it('keeps a private scenario out of the outbox until it is shared', async () => {
    const repo = new MemoryWorkspaceRepository();
    await repo.apply({
      workspaceId: WS,
      changes: [
        {
          ...change('SCENARIO', 'scn-1'),
          after: {
            id: 'scn-1',
            workspaceId: WS,
            name: 'Draft',
            visibility: 'PRIVATE',
            status: 'DRAFT',
            schemaVersion: 1,
            entityVersion: 1,
            createdAt: NOW,
            createdBy: 'a',
            updatedAt: NOW,
            updatedBy: 'a',
          },
        },
      ],
      events: [],
      command: command('CreateScenario'),
    });
    expect(await repo.listOutbox(WS)).toHaveLength(0);
  });

  it('accepts a change for every stored entity kind', async () => {
    const repo = new MemoryWorkspaceRepository();

    for (const kind of STORED_KINDS) {
      await expect(
        repo.apply({
          workspaceId: WS,
          changes: [change(kind, `${kind}-1`)],
          events: [],
          command: command('Seed'),
        }),
        `no bucket for ${kind}`,
      ).resolves.not.toThrow();
    }
  });

  it('refuses a derived projection kind it has nowhere to put, rather than dropping it silently', async () => {
    const repo = new MemoryWorkspaceRepository();

    await expect(
      repo.apply({
        workspaceId: WS,
        changes: [change('PRODUCT_QUARTER' as EntityKind, 's-1')],
        events: [],
        command: command('Seed'),
      }),
    ).rejects.toThrow(/PRODUCT_QUARTER/);
  });

  it('refuses a scenario command at the baseline write boundary', async () => {
    const repo = new MemoryWorkspaceRepository();
    await expect(
      repo.apply({
        workspaceId: WS,
        changes: [change('COMMITMENT', 'c-1')],
        events: [],
        command: { ...command('Draft move'), scenarioId: 'scenario-1' },
      }),
    ).rejects.toThrow('SCENARIO_CANNOT_MUTATE_BASELINE');
  });

  it('loads relations back into the workspace state', async () => {
    const repo = new MemoryWorkspaceRepository();
    await repo.apply({
      workspaceId: WS,
      changes: [
        change('WORKSPACE', WS),
        change('PRODUCT_SERVICE', 'p-1'),
        change('MILESTONE', 'm-1'),
        change('EXTERNAL_LINK', 'l-1'),
      ],
      events: [],
      command: command('Seed'),
    });

    const state = await repo.load(WS);
    expect(state?.products?.has('p-1')).toBe(true);
    expect(state?.milestones?.has('m-1')).toBe(true);
    expect(state?.externalLinks?.has('l-1')).toBe(true);
  });

  it('writes a recovery snapshot in the same apply boundary before a barrier change', async () => {
    const repo = new MemoryWorkspaceRepository();
    await repo.apply({
      workspaceId: WS,
      changes: [change('WORKSPACE', WS)],
      events: [],
      command: command('Seed'),
    });
    const before = await repo.load(WS);
    if (!before) throw new Error('seeded workspace should load');
    await repo.apply({
      workspaceId: WS,
      changes: [change('TEAM', 'team-1')],
      events: [],
      command: command('ApplyScenario'),
      preSnapshot: {
        id: 'snapshot-1',
        workspaceId: WS,
        workspaceRevision: 1,
        createdAt: NOW,
        commandName: 'ApplyScenario',
        state: before,
      },
    });
    const snapshots = await repo.listSnapshots(WS);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ id: 'snapshot-1', commandName: 'ApplyScenario' });
    expect(snapshots[0]?.content).toMatchObject({
      workspace: expect.any(Object),
      teams: expect.any(Object),
      commitments: expect.any(Object),
    });
  });

  it('clears every bucket, leaving nothing behind from a previous sample', async () => {
    const repo = new MemoryWorkspaceRepository();
    await repo.apply({
      workspaceId: WS,
      changes: [change('WORKSPACE', WS), change('PRODUCT_SERVICE', 'p-1'), change('THEME', 'th-1')],
      events: [],
      command: command('Seed'),
    });

    await repo.clearLocalData(WS);

    const state = await repo.load(WS);
    expect(state?.products?.size ?? 0).toBe(0);
    expect(state?.themes?.size ?? 0).toBe(0);
  });
});

/**
 * The failure a real user hit and no test did: a workspace saved before a
 * bucket existed. Every test here starts from empty, so schema v2 shipped with
 * `Object.values(undefined)` on the first load of any existing workspace — a
 * blank page and a console error.
 */
describe('reading a snapshot written by an older build', () => {
  const olderSnapshot = JSON.stringify({
    workspaces: {
      [WS]: {
        id: WS,
        workspaceId: WS,
        name: 'Saved before schema v2',
        schemaVersion: 1,
        entityVersion: 1,
        createdAt: NOW,
        createdBy: 'a',
        updatedAt: NOW,
        updatedBy: 'a',
      },
    },
    teams: {},
    teamQuarters: {},
    commitments: {},
    footprints: {},
    events: [],
    outbox: [],
  });

  function persistence(initial: string | null) {
    let value = initial;
    return {
      read: () => value,
      write: (next: string) => {
        value = next;
      },
      clear: () => {
        value = null;
      },
    };
  }

  it('loads it instead of throwing on the buckets it does not have', async () => {
    const repo = new MemoryWorkspaceRepository(persistence(olderSnapshot));

    const state = await repo.load(WS);
    expect(state?.workspace.name).toBe('Saved before schema v2');
    // Absent means empty, which is the only sensible reading of a bucket that
    // did not exist when the snapshot was written.
    expect(state?.products?.size).toBe(0);
    expect(state?.people?.size).toBe(0);
    expect(state?.milestones?.size).toBe(0);
  });

  it('can then write the new kinds into it', async () => {
    const repo = new MemoryWorkspaceRepository(persistence(olderSnapshot));

    await repo.apply({
      workspaceId: WS,
      changes: [change('PRODUCT_SERVICE', 'p-1')],
      events: [],
      command: command('Seed'),
    });

    expect((await repo.load(WS))?.products?.has('p-1')).toBe(true);
  });

  it('starts from empty rather than refusing to start when storage is corrupt', async () => {
    const repo = new MemoryWorkspaceRepository(persistence('{ this is not json'));
    expect(await repo.load(WS)).toBeNull();
    expect(repo.getRecoveryNotice()).toBe('CORRUPT_CACHE_RECOVERED');
  });

  it('clears cleanly, even from an older snapshot', async () => {
    const repo = new MemoryWorkspaceRepository(persistence(olderSnapshot));
    await expect(repo.clearLocalData(WS)).resolves.not.toThrow();
  });
});
