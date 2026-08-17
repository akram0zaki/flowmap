/**
 * Provider contract suite.
 *
 * Every WorkspaceProvider — Local, File, and the fault-injecting fake — must
 * pass these cases. A provider is not done until it does.
 *
 * See docs/spec/08-providers.md §1.
 */

import { describe, expect, it } from 'vitest';
import type { WorkspaceId } from '@flowmap/domain';

import type { WorkspaceProvider } from './contracts.js';
import { ProviderError } from './contracts.js';
import { FakeProvider } from './fake-provider.js';

export type ProviderSetup = () => Promise<{
  provider: WorkspaceProvider;
  workspaceId: WorkspaceId;
}>;

export function registerProviderContract(name: string, setup: ProviderSetup): void {
  describe(`${name} provider contract`, () => {
    async function ready() {
      const ctx = await setup();
      await ctx.provider.provision(ctx.workspaceId, 1);
      return ctx;
    }

    it('applies a push and makes it visible to a pull', async () => {
      const { provider, workspaceId } = await ready();
      const pushed = await provider.push(workspaceId, {
        batchId: 'b1',
        operations: [
          {
            operationId: 'op-1',
            entityRef: { kind: 'COMMITMENT', id: 'c-1' },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: 'c-1', name: 'X', entityVersion: 1 },
          },
        ],
      });
      expect(pushed.results[0]?.status).toBe('APPLIED');

      const page = await provider.pull(workspaceId, null);
      expect(page.changes).toHaveLength(1);
      expect(page.changes[0]?.entityRef).toEqual({ kind: 'COMMITMENT', id: 'c-1' });
      expect(page.hasMore).toBe(false);
      expect(typeof page.serverTime).toBe('string');
    });

    it('is idempotent — a replayed operation returns DUPLICATE', async () => {
      const { provider, workspaceId } = await ready();
      const op = {
        operationId: 'op-dup',
        entityRef: { kind: 'COMMITMENT', id: 'c-dup' } as const,
        op: 'CREATE' as const,
        changedFields: ['name'],
        patch: { id: 'c-dup', name: 'Y', entityVersion: 1 },
      };
      const first = await provider.push(workspaceId, { batchId: 'b', operations: [op] });
      const second = await provider.push(workspaceId, { batchId: 'b', operations: [op] });
      expect(first.results[0]?.status).toBe('APPLIED');
      expect(second.results[0]?.status).toBe('DUPLICATE');
      expect(await provider.pull(workspaceId, null)).toMatchObject({
        changes: [{ entityRef: { kind: 'COMMITMENT', id: 'c-dup' } }],
      });
    });

    it('reports a conflict when the base version has moved on', async () => {
      const { provider, workspaceId } = await ready();
      await provider.push(workspaceId, {
        batchId: 'b1',
        operations: [
          {
            operationId: 'op-a',
            entityRef: { kind: 'COMMITMENT', id: 'c-cf' },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: 'c-cf', name: 'A', entityVersion: 1 },
          },
        ],
      });
      const stale = await provider.push(workspaceId, {
        batchId: 'b2',
        operations: [
          {
            operationId: 'op-b',
            entityRef: { kind: 'COMMITMENT', id: 'c-cf' },
            op: 'UPDATE',
            baseVersion: 'v-does-not-match',
            changedFields: ['name'],
            patch: { id: 'c-cf', name: 'B', entityVersion: 2 },
          },
        ],
      });
      expect(stale.results[0]?.status).toBe('CONFLICT');
    });

    it('resumes a pull from its cursor with no gap and no duplicate', async () => {
      const { provider, workspaceId } = await ready();
      for (let i = 0; i < 5; i += 1) {
        await provider.push(workspaceId, {
          batchId: `b-${i}`,
          operations: [
            {
              operationId: `op-p-${i}`,
              entityRef: { kind: 'COMMITMENT', id: `c-p-${i}` },
              op: 'CREATE',
              changedFields: ['name'],
              patch: { id: `c-p-${i}`, entityVersion: 1 },
            },
          ],
        });
      }
      const first = await provider.pull(workspaceId, null, { pageSize: 2 });
      expect(first.changes).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      const second = await provider.pull(workspaceId, first.cursor, { pageSize: 2 });
      const third = await provider.pull(workspaceId, second.cursor, { pageSize: 2 });
      const seen = [...first.changes, ...second.changes, ...third.changes].map((change) =>
        'id' in change.entityRef ? change.entityRef.id : '',
      );
      expect(new Set(seen).size).toBe(5);
      expect(third.hasMore).toBe(false);
    });

    it('surfaces a deletion as a tombstone', async () => {
      const { provider, workspaceId } = await ready();
      await provider.push(workspaceId, {
        batchId: 'b1',
        operations: [
          {
            operationId: 'op-del-1',
            entityRef: { kind: 'COMMITMENT', id: 'c-del' },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: 'c-del', entityVersion: 1 },
          },
        ],
      });
      await provider.push(workspaceId, {
        batchId: 'b2',
        operations: [
          {
            operationId: 'op-del-2',
            entityRef: { kind: 'COMMITMENT', id: 'c-del' },
            op: 'DELETE',
            changedFields: [],
            patch: null,
          },
        ],
      });
      const page = await provider.pull(workspaceId, null);
      expect(page.changes.at(-1)?.deleted).toBe(true);
    });

    it('returns a stored entity from getEntity', async () => {
      const { provider, workspaceId } = await ready();
      await provider.push(workspaceId, {
        batchId: 'b',
        operations: [
          {
            operationId: 'op-get',
            entityRef: { kind: 'TEAM', id: 't-1' },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: 't-1', name: 'Platform', entityVersion: 1 },
          },
        ],
      });
      const found = await provider.getEntity(workspaceId, { kind: 'TEAM', id: 't-1' });
      expect(found?.payload).toMatchObject({ name: 'Platform' });
      expect(await provider.getEntity(workspaceId, { kind: 'TEAM', id: 'missing' })).toBeNull();
    });

    it('round-trips a portable export', async () => {
      const { provider, workspaceId } = await ready();
      await provider.push(workspaceId, {
        batchId: 'b',
        operations: [
          {
            operationId: 'op-exp',
            entityRef: { kind: 'COMMITMENT', id: 'c-exp' },
            op: 'CREATE',
            changedFields: ['name'],
            patch: { id: 'c-exp', name: 'Exported', entityVersion: 1 },
          },
        ],
      });
      const packed = await provider.exportPortable(workspaceId);
      expect(packed.bytes.byteLength).toBeGreaterThan(0);
      const imported = await provider.importPortable(packed);
      expect(imported).toBe(workspaceId);
    });
  });
}

describe('fault-injecting fake provider', () => {
  it('surfaces structured provider errors', async () => {
    const provider = new FakeProvider();
    provider.faults.unavailable = true;
    await expect(provider.health()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    provider.faults = { forbidden: true };
    await expect(provider.health()).rejects.toBeInstanceOf(ProviderError);
    provider.faults = { cursorExpired: true };
    await expect(provider.pull('ws', '1')).rejects.toMatchObject({ code: 'CURSOR_EXPIRED' });
  });
});
