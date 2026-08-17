import { describe, expect, it } from 'vitest';

import type { Command, EntityChange, EntityId, EntityRef } from '@flowmap/domain';

import { FakeProvider } from './fake-provider.js';
import { MemoryWorkspaceRepository } from './memory.js';
import { SyncEngine } from './sync-engine.js';

const WS = 'ws-sync';
const NOW = '2026-08-17T09:00:00Z';

function command(name: string, id: EntityId = `cmd-${name}`): Command {
  return {
    id,
    name,
    workspaceId: WS,
    payload: {},
    actorId: 'local:test',
    issuedAt: NOW,
  };
}

function change(
  kind: EntityRef['kind'],
  id: string,
  over: Partial<EntityChange> = {},
): EntityChange {
  return {
    ref: { kind, id } as EntityChange['ref'],
    op: 'CREATE',
    toVersion: 1,
    after: {
      id,
      workspaceId: WS,
      schemaVersion: 1,
      entityVersion: 1,
      createdAt: NOW,
      createdBy: 'a',
      updatedAt: NOW,
      updatedBy: 'a',
      name: `${kind} ${id}`,
    },
    changedFields: ['name'],
    ...over,
  };
}

function engine(repo: MemoryWorkspaceRepository, provider: FakeProvider): SyncEngine {
  let n = 0;
  return new SyncEngine({
    repository: repo,
    provider,
    clock: { now: () => NOW },
    ids: {
      next: () => {
        n += 1;
        return `id-${n}`;
      },
    },
    sleep: async () => undefined,
    random: () => 0,
  });
}

describe('SyncEngine', () => {
  it('pushes local outbox and pulls it back onto a second cache', async () => {
    const provider = new FakeProvider();
    await provider.provision(WS, 1);
    const writer = new MemoryWorkspaceRepository();
    await writer.apply({
      workspaceId: WS,
      changes: [change('COMMITMENT', 'c-1')],
      events: [],
      command: command('CreateIdea', 'op-1'),
    });
    await engine(writer, provider).sync(WS);
    expect(await writer.listOutbox(WS, 'ACKED')).toHaveLength(1);

    const reader = new MemoryWorkspaceRepository();
    await engine(reader, provider).sync(WS);
    const loaded = await reader.load(WS);
    // applyRemote writes the commitment even without a workspace row.
    expect(loaded).toBeNull();
    const pending = await reader.listOutbox(WS);
    expect(pending).toHaveLength(0);
    const conflicts = await reader.listConflicts(WS);
    expect(conflicts).toHaveLength(0);
    const found = await provider.getEntity(WS, { kind: 'COMMITMENT', id: 'c-1' });
    expect(found?.payload).toMatchObject({ name: 'COMMITMENT c-1' });
  });

  it('auto-merges disjoint field edits from two clients', async () => {
    const provider = new FakeProvider();
    await provider.provision(WS, 1);
    const base = change('COMMITMENT', 'c-2', {
      after: {
        id: 'c-2',
        workspaceId: WS,
        name: 'Base',
        outcome: 'old',
        entityVersion: 1,
        createdAt: NOW,
        createdBy: 'a',
        updatedAt: NOW,
        updatedBy: 'a',
        schemaVersion: 1,
      },
    });
    const first = new MemoryWorkspaceRepository();
    await first.apply({
      workspaceId: WS,
      changes: [base],
      events: [],
      command: command('CreateIdea', 'op-base'),
    });
    await engine(first, provider).sync(WS);

    const a = new MemoryWorkspaceRepository();
    await engine(a, provider).sync(WS);
    const b = new MemoryWorkspaceRepository();
    await engine(b, provider).sync(WS);

    await a.apply({
      workspaceId: WS,
      changes: [
        change('COMMITMENT', 'c-2', {
          op: 'UPDATE',
          fromVersion: 1,
          toVersion: 2,
          before: { id: 'c-2', name: 'Base', outcome: 'old', remoteVersion: 'v1' },
          after: { id: 'c-2', name: 'A name', outcome: 'old' },
          changedFields: ['name'],
        }),
      ],
      events: [],
      command: command('RenameCommitment', 'op-a'),
    });
    await b.apply({
      workspaceId: WS,
      changes: [
        change('COMMITMENT', 'c-2', {
          op: 'UPDATE',
          fromVersion: 1,
          toVersion: 2,
          before: { id: 'c-2', name: 'Base', outcome: 'old', remoteVersion: 'v1' },
          after: { id: 'c-2', name: 'Base', outcome: 'B outcome' },
          changedFields: ['outcome'],
        }),
      ],
      events: [],
      command: command('SetOutcome', 'op-b'),
    });

    await engine(a, provider).sync(WS);
    await engine(b, provider).sync(WS);
    await engine(a, provider).sync(WS);

    expect((await a.listConflicts(WS)).filter((row) => row.resolvedAt === undefined)).toHaveLength(
      0,
    );
    expect((await b.listConflicts(WS)).filter((row) => row.resolvedAt === undefined)).toHaveLength(
      0,
    );
    const remote = await provider.getEntity(WS, { kind: 'COMMITMENT', id: 'c-2' });
    expect(remote?.payload).toMatchObject({ name: 'A name', outcome: 'B outcome' });
  });

  it('records a conflict when both clients edit the same field', async () => {
    const provider = new FakeProvider();
    await provider.provision(WS, 1);
    const seed = new MemoryWorkspaceRepository();
    await seed.apply({
      workspaceId: WS,
      changes: [change('COMMITMENT', 'c-3')],
      events: [],
      command: command('CreateIdea', 'op-seed'),
    });
    await engine(seed, provider).sync(WS);

    const a = new MemoryWorkspaceRepository();
    await engine(a, provider).sync(WS);
    const b = new MemoryWorkspaceRepository();
    await engine(b, provider).sync(WS);

    await a.apply({
      workspaceId: WS,
      changes: [
        change('COMMITMENT', 'c-3', {
          op: 'UPDATE',
          fromVersion: 1,
          toVersion: 2,
          before: { id: 'c-3', name: 'COMMITMENT c-3', remoteVersion: 'v1' },
          after: { id: 'c-3', name: 'Mine' },
          changedFields: ['name'],
        }),
      ],
      events: [],
      command: command('RenameCommitment', 'op-a3'),
    });
    await b.apply({
      workspaceId: WS,
      changes: [
        change('COMMITMENT', 'c-3', {
          op: 'UPDATE',
          fromVersion: 1,
          toVersion: 2,
          before: { id: 'c-3', name: 'COMMITMENT c-3', remoteVersion: 'v1' },
          after: { id: 'c-3', name: 'Theirs' },
          changedFields: ['name'],
        }),
      ],
      events: [],
      command: command('RenameCommitment', 'op-b3'),
    });

    await engine(a, provider).sync(WS);
    const status = await engine(b, provider).sync(WS);
    expect(status.conflictCount).toBeGreaterThan(0);
    const conflicts = await b.listConflicts(WS);
    expect(conflicts[0]?.field).toBe('name');
  });

  it('resumes a pull after the cursor is recorded for a completed page', async () => {
    const provider = new FakeProvider();
    await provider.provision(WS, 1);
    const writer = new MemoryWorkspaceRepository();
    for (let i = 0; i < 3; i += 1) {
      await writer.apply({
        workspaceId: WS,
        changes: [change('COMMITMENT', `c-r-${i}`)],
        events: [],
        command: command('CreateIdea', `op-r-${i}`),
      });
    }
    await engine(writer, provider).sync(WS);
    const reader = new MemoryWorkspaceRepository();
    await engine(reader, provider).sync(WS);
    const state = await reader.getSyncState(WS);
    expect(state?.pullCursor).toBeDefined();
    await engine(reader, provider).sync(WS);
    expect((await reader.listConflicts(WS)).length).toBe(0);
  });

  it('keeps local work when the provider is unreachable', async () => {
    const provider = new FakeProvider();
    await provider.provision(WS, 1);
    const repo = new MemoryWorkspaceRepository();
    await repo.apply({
      workspaceId: WS,
      changes: [change('COMMITMENT', 'c-off')],
      events: [],
      command: command('CreateIdea', 'op-off'),
    });
    provider.faults.unavailable = true;
    const status = await engine(repo, provider).sync(WS);
    expect(status.reachable).toBe(false);
    expect(await repo.listOutbox(WS, 'PENDING')).toHaveLength(1);
  });

  it('treats a replayed push as success', async () => {
    const provider = new FakeProvider();
    await provider.provision(WS, 1);
    const repo = new MemoryWorkspaceRepository();
    await repo.apply({
      workspaceId: WS,
      changes: [change('COMMITMENT', 'c-id')],
      events: [],
      command: command('CreateIdea', 'op-id'),
    });
    const sync = engine(repo, provider);
    await sync.sync(WS);
    const pending = await repo.listOutbox(WS, 'PENDING');
    expect(pending).toHaveLength(0);
    await repo.markOutbox(
      (await repo.listOutbox(WS, 'ACKED')).map((entry) => entry.id),
      'PENDING',
    );
    await sync.sync(WS);
    expect(await provider.pull(WS, null)).toMatchObject({
      changes: [{ entityRef: { kind: 'COMMITMENT', id: 'c-id' } }],
    });
  });
});
