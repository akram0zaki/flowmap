/**
 * The migration framework.
 *
 * Three properties, all enforced here rather than left to each migration author:
 *
 *   - **Forward-only.** There is no `down`. Rolling back means restoring the
 *     pre-migration backup, which the runner takes for you.
 *   - **Idempotent.** Re-running an applied migration is a no-op. AGENTS.md
 *     makes this a hard rule; `verifyIdempotent` proves it in tests.
 *   - **Checksummed.** If a migration's source changes after it was applied, the
 *     runner refuses to open the store rather than guessing.
 *
 * See docs/spec/01-domain-model.md §13 and 07-persistence-sync.md §2.1.
 */

export type MigrationContext = {
  /** Runs a statement inside the migration transaction. */
  exec(sql: string): Promise<void>;
  /** Reads a single row inside the migration transaction. */
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
};

export type Migration = {
  readonly version: number;
  readonly name: string;
  /** MUST be safe to run twice. */
  readonly up: (ctx: MigrationContext) => Promise<void>;
  /** Stable text used to detect after-the-fact edits. */
  readonly checksumSource: string;
};

export type MigrationRecord = {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
  readonly durationMs: number;
};

export type MigrationReport = {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly MigrationRecord[];
  readonly skipped: readonly number[];
  readonly backupRef?: string;
};

export class MigrationChecksumError extends Error {
  constructor(
    readonly version: number,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Migration ${version} has changed since it was applied ` +
        `(recorded ${expected}, now ${actual}). This build cannot safely open the workspace.`,
    );
    this.name = 'MigrationChecksumError';
  }
}

export class MigrationFailedError extends Error {
  constructor(
    readonly version: number,
    override readonly cause: unknown,
    readonly backupRef?: string,
  ) {
    super(
      `Migration ${version} failed: ${cause instanceof Error ? cause.message : String(cause)}` +
        (backupRef ? `. A pre-migration backup is available at ${backupRef}.` : ''),
    );
    this.name = 'MigrationFailedError';
  }
}

/** Deterministic FNV-1a. Not cryptographic — this detects edits, not attacks. */
export function checksum(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export type MigrationHost = {
  currentVersion(): Promise<number>;
  appliedMigrations(): Promise<MigrationRecord[]>;
  /** Runs `fn` inside a single transaction. Rejecting must roll everything back. */
  transaction<T>(fn: (ctx: MigrationContext) => Promise<T>): Promise<T>;
  record(entry: MigrationRecord): Promise<void>;
  /** Returns a reference to a restorable backup, or undefined if unsupported. */
  backup?(version: number): Promise<string | undefined>;
  now(): string;
};

/**
 * Applies every pending migration in order, inside one transaction each.
 *
 * Verifies checksums of already-applied migrations first, so a build that has
 * quietly edited history fails before it touches data.
 */
export async function runMigrations(
  host: MigrationHost,
  migrations: readonly Migration[],
): Promise<MigrationReport> {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  assertMonotonic(ordered);

  const applied = await host.appliedMigrations();
  const appliedByVersion = new Map(applied.map((record) => [record.version, record]));

  for (const migration of ordered) {
    const record = appliedByVersion.get(migration.version);
    if (!record) continue;
    const actual = checksum(migration.checksumSource);
    if (record.checksum !== actual) {
      throw new MigrationChecksumError(migration.version, record.checksum, actual);
    }
  }

  const from = await host.currentVersion();
  const pending = ordered.filter((m) => !appliedByVersion.has(m.version));
  const skipped = ordered.filter((m) => appliedByVersion.has(m.version)).map((m) => m.version);

  if (pending.length === 0) {
    return { from, to: from, applied: [], skipped };
  }

  const backupRef = await host.backup?.(from);
  const results: MigrationRecord[] = [];

  for (const migration of pending) {
    const startedAt = Date.now();
    try {
      await host.transaction((ctx) => migration.up(ctx));
    } catch (cause) {
      throw new MigrationFailedError(migration.version, cause, backupRef);
    }

    const entry: MigrationRecord = {
      version: migration.version,
      name: migration.name,
      checksum: checksum(migration.checksumSource),
      appliedAt: host.now(),
      durationMs: Date.now() - startedAt,
    };
    await host.record(entry);
    results.push(entry);
  }

  return {
    from,
    to: results.at(-1)!.version,
    applied: results,
    skipped,
    ...(backupRef !== undefined ? { backupRef } : {}),
  };
}

function assertMonotonic(ordered: readonly Migration[]): void {
  const seen = new Set<number>();
  for (const migration of ordered) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(`Migration version must be a positive integer, got ${migration.version}`);
    }
    seen.add(migration.version);
  }
}

/**
 * Proves a migration is idempotent by running it twice against the same host and
 * comparing the resulting state. Used by tests, not at runtime.
 */
export async function verifyIdempotent(
  migration: Migration,
  makeHost: () => { host: MigrationHost; snapshot: () => Promise<string> },
): Promise<{ once: string; twice: string; idempotent: boolean }> {
  const first = makeHost();
  await first.host.transaction((ctx) => migration.up(ctx));
  const once = await first.snapshot();

  await first.host.transaction((ctx) => migration.up(ctx));
  const twice = await first.snapshot();

  return { once, twice, idempotent: once === twice };
}
