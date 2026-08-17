/**
 * Filesystem port for the File provider.
 *
 * The provider never imports `node:fs` or Tauri APIs. Tests inject a memory
 * disk; the desktop shell injects a real one. That is what makes conflict
 * copies, placeholders, and vanished shares injectable rather than anecdotal.
 *
 * See docs/spec/08-providers.md §3.
 */

import { ProviderError } from '@flowmap/storage';

export type FileInfo = {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly versionToken: string;
  readonly writable: boolean;
  readonly placeholder: boolean;
  readonly exists: boolean;
};

export interface FileSystemAdapter {
  read(path: string): Promise<Uint8Array>;
  /**
   * Write to a temp file, fsync, then atomically replace. When `ifMatch` is
   * set and the current token differs, throw `ProviderError('CONFLICT')`.
   */
  writeAtomic(path: string, bytes: Uint8Array, ifMatch?: string): Promise<string>;
  stat(path: string): Promise<FileInfo>;
  list(dir: string): Promise<readonly FileInfo[]>;
  materialize(path: string): Promise<void>;
  now(): string;
}

export async function readMaterialised(
  fs: FileSystemAdapter,
  path: string,
): Promise<{ bytes: Uint8Array; token: string }> {
  const info = await fs.stat(path);
  if (!info.exists) throw new ProviderError('NOT_FOUND', `No shared document at ${path}.`);
  if (info.placeholder) await fs.materialize(path);
  const ready = await fs.stat(path);
  if (ready.placeholder) {
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      'The shared file is still a cloud placeholder.',
    );
  }
  return { bytes: await fs.read(path), token: ready.versionToken };
}
