/**
 * The Tauri runtime.
 *
 * Implements the `SqlDriver` port over IPC, so the SQLite repository is exactly
 * the same code on desktop as it is in tests. The web layer never sees a
 * database handle, a file path, or a connection — only `db_*` commands with
 * bound parameters.
 *
 * Transactions are held on the Rust side: `db_begin` / `db_commit` /
 * `db_rollback` bracket the calls, so a rejected callback rolls the whole thing
 * back rather than leaving a half-applied write.
 */

import {
  SqliteWorkspaceRepository,
  type SqlDriver,
  type SqlRow,
  type SqlValue,
} from '@flowmap/storage-local';

import type { Runtime } from './state/workspace-store.js';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

class TauriSqlDriver implements SqlDriver {
  #depth = 0;

  constructor(private readonly invoke: Invoke) {}

  async exec(sql: string): Promise<void> {
    await this.invoke('db_exec', { sql });
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    await this.invoke('db_run', { sql, params: encode(params) });
  }

  async all<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    return this.invoke<T[]>('db_query', { sql, params: encode(params) });
  }

  async get<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }

  /**
   * SQLite has no nested transactions, so a nested call joins the outer one
   * rather than silently committing early.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#depth > 0) {
      this.#depth += 1;
      try {
        return await fn();
      } finally {
        this.#depth -= 1;
      }
    }

    await this.invoke('db_begin');
    this.#depth = 1;
    try {
      const result = await fn();
      await this.invoke('db_commit');
      return result;
    } catch (error) {
      await this.invoke('db_rollback');
      throw error;
    } finally {
      this.#depth = 0;
    }
  }

  async close(): Promise<void> {
    await this.invoke('db_close');
  }
}

/** `bigint` and `Uint8Array` do not survive JSON; convert at the boundary. */
function encode(params: readonly SqlValue[]): unknown[] {
  return params.map((value) => {
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Uint8Array) return Array.from(value);
    return value;
  });
}

export async function createTauriRuntime(base: {
  now: () => string;
  newId: () => string;
}): Promise<Runtime> {
  const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: Invoke };

  // A portable app must be able to tell you where its state actually lives
  // (spec 10 §3.1), so the resolved directory travels with the runtime and is
  // shown in Settings rather than buried in a console line.
  const info = await invoke<{ dataDir: string; portable: boolean }>('db_open');

  const driver = new TauriSqlDriver(invoke);
  const repository = new SqliteWorkspaceRepository(driver);
  await repository.migrate();

  return { repository, dataDir: info.dataDir, portable: info.portable, ...base };
}
