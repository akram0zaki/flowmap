/**
 * In-memory disk used by the File provider tests and the browser target.
 *
 * Faults are first-class: delayed visibility, read-only, vanished share,
 * placeholder, and a write that dies after the temp file exists.
 */

import { ProviderError } from '@flowmap/storage';

import type { FileInfo, FileSystemAdapter } from './filesystem.js';

type StoredFile = {
  bytes: Uint8Array;
  version: number;
  writable: boolean;
  placeholder: boolean;
  exists: boolean;
  /** When false, peers cannot see the latest write yet (OneDrive delay). */
  visible: boolean;
};

export type MemoryFsFaults = {
  vanish?: boolean;
  readOnly?: boolean;
  failAfterTemp?: boolean;
  delayVisibility?: boolean;
};

export class MemoryFileSystem implements FileSystemAdapter {
  faults: MemoryFsFaults = {};
  #files = new Map<string, StoredFile>();
  #clock: () => string;

  constructor(clock: () => string = () => '2026-08-17T09:00:00Z') {
    this.#clock = clock;
  }

  now(): string {
    return this.#clock();
  }

  seed(path: string, bytes: Uint8Array, over: Partial<StoredFile> = {}): void {
    this.#files.set(path, {
      bytes,
      version: 1,
      writable: true,
      placeholder: false,
      exists: true,
      visible: true,
      ...over,
    });
  }

  markPlaceholder(path: string, placeholder = true): void {
    const file = this.#files.get(path);
    if (file) file.placeholder = placeholder;
  }

  async read(path: string): Promise<Uint8Array> {
    const file = this.#require(path);
    if (file.placeholder) {
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'Cloud placeholder has not materialised.');
    }
    return file.bytes;
  }

  async writeAtomic(path: string, bytes: Uint8Array, ifMatch?: string): Promise<string> {
    if (this.faults.vanish) {
      this.#files.delete(path);
      throw new ProviderError('NOT_FOUND', 'The shared folder is no longer reachable.');
    }
    if (this.faults.readOnly) {
      throw new ProviderError('FORBIDDEN', 'The shared file is not writable.');
    }
    const current = this.#files.get(path);
    if (ifMatch !== undefined && current && String(current.version) !== ifMatch) {
      throw new ProviderError('CONFLICT', 'The shared document changed underfoot.', {
        remoteVersion: String(current.version),
      });
    }
    if (this.faults.failAfterTemp) {
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        'Write died after the temp file was created.',
      );
    }
    const nextVersion = (current?.version ?? 0) + 1;
    this.#files.set(path, {
      bytes,
      version: nextVersion,
      writable: current?.writable ?? true,
      placeholder: false,
      exists: true,
      visible: !this.faults.delayVisibility,
    });
    return String(nextVersion);
  }

  /** Makes a delayed write visible to peers. */
  reveal(path: string): void {
    const file = this.#files.get(path);
    if (file) file.visible = true;
  }

  async stat(path: string): Promise<FileInfo> {
    if (this.faults.vanish) {
      return {
        path,
        name: nameOf(path),
        size: 0,
        versionToken: '0',
        writable: false,
        placeholder: false,
        exists: false,
      };
    }
    const file = this.#files.get(path);
    if (!file || !file.exists || !file.visible) {
      return {
        path,
        name: nameOf(path),
        size: 0,
        versionToken: '0',
        writable: !this.faults.readOnly,
        placeholder: false,
        exists: false,
      };
    }
    return {
      path,
      name: nameOf(path),
      size: file.bytes.byteLength,
      versionToken: String(file.version),
      writable: file.writable && !this.faults.readOnly,
      placeholder: file.placeholder,
      exists: true,
    };
  }

  async list(dir: string): Promise<readonly FileInfo[]> {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const out: FileInfo[] = [];
    for (const [path] of this.#files) {
      if (path.startsWith(prefix) || dirname(path) === dir.replace(/\/$/, '')) {
        out.push(await this.stat(path));
      }
    }
    return out.filter((file) => file.exists);
  }

  async materialize(path: string): Promise<void> {
    const file = this.#files.get(path);
    if (file) file.placeholder = false;
  }

  #require(path: string): StoredFile {
    const file = this.#files.get(path);
    if (!file || !file.exists || !file.visible) {
      throw new ProviderError('NOT_FOUND', `No file at ${path}.`);
    }
    return file;
  }
}

function nameOf(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function dirname(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}
