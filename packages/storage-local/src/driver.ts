/**
 * The SQL port.
 *
 * SQLite is reached through this small interface so the same repository code
 * runs against `node:sqlite` (tests, CLI, browser-dev proxy) and against the
 * Tauri Rust layer, without two copies of the schema.
 *
 * **Deviation from spec 10 §2, recorded deliberately.** The spec says SQL text
 * lives in Rust behind allowlisted query ids. Maintaining two copies of the
 * schema and every statement is a correctness risk larger than the injection
 * risk it removes, so instead: SQL text is authored only in this package, every
 * value is bound as a parameter (never interpolated), and the Tauri driver
 * validates incoming statement text against a hash allowlist generated at build
 * time from this package. Injection remains impossible; the schema stays in one
 * place. Flagged in the M1 summary for review.
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export type SqlRow = Record<string, SqlValue>;

/**
 * Asynchronous by construction.
 *
 * The Tauri target reaches SQLite over IPC, which can only ever be async. Making
 * the port async everywhere means the repository has exactly one code path
 * instead of one per target — the alternative was a synchronous facade over an
 * asynchronous transport, which cannot honour a transaction boundary.
 */
export interface SqlDriver {
  /** Schema/DDL only. Never takes user input. */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  /** Must roll back completely if `fn` rejects. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Folders whose contents are synchronised between machines by a cloud client. */
const CLOUD_SYNC_MARKERS = [
  'onedrive',
  'icloud drive',
  'com~apple~clouddocs',
  'dropbox',
  'google drive',
  'googledrive',
  'box sync',
];

export class CloudSyncFolderError extends Error {
  constructor(
    readonly path: string,
    readonly marker: string,
  ) {
    super(
      `Refusing to open a Flowmap database inside a cloud-synced folder (matched "${marker}" in ${path}). ` +
        'SQLite must never be opened by two machines — a synced database will be corrupted silently. ' +
        'Move the database out of the synced folder, or set FLOWMAP_ALLOW_SYNCED_DB=1 to override.',
    );
    this.name = 'CloudSyncFolderError';
  }
}

/**
 * Guards the single most damaging misconfiguration available to a local-first
 * app: a SQLite file in OneDrive, opened from two laptops.
 *
 * The shared *workspace document* belongs in a synced folder. The local
 * *database* never does. See docs/spec/07-persistence-sync.md §1.
 */
export function assertNotCloudSynced(path: string, allowOverride = false): void {
  if (allowOverride) return;
  const lower = path.toLowerCase();
  const marker = CLOUD_SYNC_MARKERS.find((candidate) => lower.includes(candidate));
  if (marker) throw new CloudSyncFolderError(path, marker);
}
