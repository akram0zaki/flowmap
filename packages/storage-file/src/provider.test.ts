import { describe, expect, it } from 'vitest';

import type { Command, EntityChange, EntityId } from '@flowmap/domain';
import { MemoryWorkspaceRepository, SyncEngine } from '@flowmap/storage';
import { registerProviderContract } from '@flowmap/storage/contract';

import { detectConflictCopies } from './conflict-copies.js';
import { MemoryFileSystem } from './memory-fs.js';
import { FileProvider } from './provider.js';

const WS = 'ws-file';
const PATH = '/share/portfolio.flowmap';
const NOW = '2026-08-17T09:00:00Z';

function fileProvider(fs = new MemoryFileSystem()): FileProvider {
  return new FileProvider({ fs, path: PATH, writerId: 'local:test', clock: () => NOW });
}

registerProviderContract('FileProvider', async () => {
  const provider = fileProvider();
  return { provider, workspaceId: WS };
});

describe('FileProvider specifics', () => {
  it('detects numbered and machine conflict copies', () => {
    const copies = detectConflictCopies(
      PATH,
      [
        {
          path: PATH,
          name: 'portfolio.flowmap',
          size: 1,
          versionToken: '1',
          writable: true,
          placeholder: false,
          exists: true,
        },
        {
          path: '/share/portfolio (1).flowmap',
          name: 'portfolio (1).flowmap',
          size: 1,
          versionToken: '1',
          writable: true,
          placeholder: false,
          exists: true,
        },
        {
          path: '/share/portfolio-LAPTOP.flowmap',
          name: 'portfolio-LAPTOP.flowmap',
          size: 1,
          versionToken: '1',
          writable: true,
          placeholder: false,
          exists: true,
        },
      ],
      NOW,
    );
    expect(copies.map((copy) => copy.kind).sort()).toEqual(['MACHINE', 'NUMBERED']);
  });

  it('materialises a files-on-demand placeholder before reading', async () => {
    const fs = new MemoryFileSystem();
    const provider = fileProvider(fs);
    await provider.provision(WS, 1);
    fs.markPlaceholder(PATH, true);
    const health = await provider.health();
    expect(health.reachable).toBe(true);
    const page = await provider.pull(WS, null);
    expect(page.changes).toEqual([]);
  });

  it('refuses to push to a read-only share and keeps the document intact', async () => {
    const fs = new MemoryFileSystem();
    const provider = fileProvider(fs);
    await provider.provision(WS, 1);
    fs.faults.readOnly = true;
    const health = await provider.health();
    expect(health.shareMode).toBe('READ_ONLY');
    await expect(
      provider.push(WS, {
        batchId: 'b',
        operations: [
          {
            operationId: 'op',
            entityRef: { kind: 'COMMITMENT', id: 'c' },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: 'c' },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reports a vanished share after the file has been seen', async () => {
    const fs = new MemoryFileSystem();
    const provider = fileProvider(fs);
    await provider.provision(WS, 1);
    await provider.health();
    fs.faults.vanish = true;
    const gone = await provider.health();
    expect(gone.shareMode).toBe('VANISHED');
    expect(gone.reachable).toBe(false);
    await expect(
      provider.push(WS, {
        batchId: 'b',
        operations: [
          {
            operationId: 'op-v',
            entityRef: { kind: 'COMMITMENT', id: 'c-v' },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: 'c-v' },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not replace the document when a write dies after the temp file', async () => {
    const fs = new MemoryFileSystem();
    const provider = fileProvider(fs);
    await provider.provision(WS, 1);
    await provider.push(WS, {
      batchId: 'b1',
      operations: [
        {
          operationId: 'op-ok',
          entityRef: { kind: 'COMMITMENT', id: 'c-ok' },
          op: 'CREATE',
          changedFields: ['name'],
          patch: { id: 'c-ok', name: 'Safe', entityVersion: 1 },
        },
      ],
    });
    fs.faults.failAfterTemp = true;
    await expect(
      provider.push(WS, {
        batchId: 'b2',
        operations: [
          {
            operationId: 'op-fail',
            entityRef: { kind: 'COMMITMENT', id: 'c-fail' },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: 'c-fail', entityVersion: 1 },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    fs.faults.failAfterTemp = false;
    const found = await provider.getEntity(WS, { kind: 'COMMITMENT', id: 'c-ok' });
    expect(found?.payload).toMatchObject({ name: 'Safe' });
    expect(await provider.getEntity(WS, { kind: 'COMMITMENT', id: 'c-fail' })).toBeNull();
  });

  it('surfaces delayed visibility as a missing file until the write propagates', async () => {
    const fs = new MemoryFileSystem();
    fs.faults.delayVisibility = true;
    const writer = fileProvider(fs);
    await writer.provision(WS, 1);
    const reader = new FileProvider({
      fs,
      path: PATH,
      writerId: 'local:peer',
      clock: () => NOW,
    });
    const health = await reader.health();
    expect(health.reachable).toBe(true);
    fs.reveal(PATH);
    expect((await reader.health()).reachable).toBe(true);
  });
});

describe('multi-client File provider harness', () => {
  function command(name: string, id: EntityId): Command {
    return {
      id,
      name,
      workspaceId: WS,
      payload: {},
      actorId: 'local:test',
      issuedAt: NOW,
    };
  }

  function createChange(id: string, name: string): EntityChange {
    return {
      ref: { kind: 'COMMITMENT', id },
      op: 'CREATE',
      toVersion: 1,
      after: {
        id,
        workspaceId: WS,
        name,
        schemaVersion: 1,
        entityVersion: 1,
        createdAt: NOW,
        createdBy: 'a',
        updatedAt: NOW,
        updatedBy: 'a',
      },
      changedFields: ['name'],
    };
  }

  function sync(repo: MemoryWorkspaceRepository, provider: FileProvider): SyncEngine {
    let n = 0;
    return new SyncEngine({
      repository: repo,
      provider,
      clock: { now: () => NOW },
      ids: {
        next: () => {
          n += 1;
          return `sid-${n}`;
        },
      },
      sleep: async () => undefined,
      random: () => 0,
    });
  }

  it('converges two clients that edited different entities', async () => {
    const fs = new MemoryFileSystem();
    const aProvider = fileProvider(fs);
    const bProvider = new FileProvider({
      fs,
      path: PATH,
      writerId: 'local:b',
      clock: () => NOW,
    });
    await aProvider.provision(WS, 1);

    const a = new MemoryWorkspaceRepository();
    const b = new MemoryWorkspaceRepository();
    await a.apply({
      workspaceId: WS,
      changes: [createChange('c-a', 'Alpha')],
      events: [],
      command: command('CreateIdea', 'op-a'),
    });
    await b.apply({
      workspaceId: WS,
      changes: [createChange('c-b', 'Beta')],
      events: [],
      command: command('CreateIdea', 'op-b'),
    });

    await sync(a, aProvider).sync(WS);
    await sync(b, bProvider).sync(WS);
    await sync(a, aProvider).sync(WS);

    expect(await aProvider.getEntity(WS, { kind: 'COMMITMENT', id: 'c-a' })).not.toBeNull();
    expect(await aProvider.getEntity(WS, { kind: 'COMMITMENT', id: 'c-b' })).not.toBeNull();
    expect((await a.listConflicts(WS)).filter((row) => row.resolvedAt === undefined)).toHaveLength(
      0,
    );
  });
});
