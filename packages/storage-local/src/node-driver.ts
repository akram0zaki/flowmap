/**
 * `node:sqlite` implementation of the SQL port.
 *
 * Used by tests, by the dev server behind browser mode, and by any Node-side
 * tooling. The Tauri target supplies its own driver over IPC; nothing above this
 * file knows the difference.
 */

import { createRequire } from 'node:module';

// `node:sqlite` is newer than the builtin list in several bundlers, which try to
// resolve it as a package and fail. Loading it through createRequire keeps it a
// genuine runtime builtin regardless of who is bundling.
const nodeRequire = createRequire(import.meta.url);
type NodeSqliteModule = { DatabaseSync: new (path: string) => NodeDatabase };
type NodeDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: SqlValue[]): unknown;
    all(...params: SqlValue[]): unknown[];
    get(...params: SqlValue[]): unknown;
  };
  close(): void;
};

const { DatabaseSync } = nodeRequire('node:sqlite') as NodeSqliteModule;

import { assertNotCloudSynced, type SqlDriver, type SqlRow, type SqlValue } from './driver.js';

export type NodeDriverOptions = {
  /** ':memory:' for tests. */
  readonly path: string;
  /** Escape hatch for the cloud-sync guard; requires a deliberate, logged choice. */
  readonly allowSyncedFolder?: boolean;
};

export class NodeSqlDriver implements SqlDriver {
  readonly #db: NodeDatabase;
  #depth = 0;

  constructor(options: NodeDriverOptions) {
    if (options.path !== ':memory:') {
      assertNotCloudSynced(options.path, options.allowSyncedFolder ?? false);
    }

    this.#db = new DatabaseSync(options.path);

    // WAL keeps readers unblocked by the writer; foreign keys are off by default
    // in SQLite and must be enabled per connection.
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec('PRAGMA busy_timeout = 5000');
  }

  async exec(sql: string): Promise<void> {
    this.#db.exec(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.#db.prepare(sql).run(...(params as SqlValue[]));
  }

  async all<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    return this.#db.prepare(sql).all(...(params as SqlValue[])) as T[];
  }

  async get<T extends SqlRow = SqlRow>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T | undefined> {
    return this.#db.prepare(sql).get(...(params as SqlValue[])) as T | undefined;
  }

  /**
   * Nested calls join the outer transaction rather than opening a second one —
   * SQLite has no nested transactions, and silently committing early is how a
   * "transactional" write turns out not to be.
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

    this.#db.exec('BEGIN IMMEDIATE');
    this.#depth = 1;
    try {
      const result = await fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    } finally {
      this.#depth = 0;
    }
  }

  async close(): Promise<void> {
    this.#db.close();
  }

  /** Schema fingerprint, used by the idempotence tests. */
  async schemaSnapshot(): Promise<string> {
    const rows = await this.all<{ sql: string | null; name: string }>(
      "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return rows.map((row) => `${row.name}::${row.sql ?? ''}`).join('\n');
  }
}
