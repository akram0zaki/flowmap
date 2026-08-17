/**
 * Versioned `.flowmap` shared document.
 *
 * The portable ZIP plus `sync.json`: revision, writer, time, tombstones, and
 * the operation ids that make push idempotent.
 *
 * See docs/spec/08-providers.md §3 and 09-import-export.md §3.
 */

import { strFromU8, unzipSync, zipSync } from 'fflate';
import type { EntityRef, WorkspaceId } from '@flowmap/domain';
import { refKey } from '@flowmap/domain';

export const FILE_FORMAT_VERSION = 1;

export type Tombstone = {
  readonly kind: string;
  readonly id: string;
  readonly deletedAt: string;
};

export type StoredEntity = {
  readonly entityRef: EntityRef;
  readonly entityVersion: number;
  readonly payload?: unknown;
  readonly deleted: boolean;
};

export type FileSyncMeta = {
  readonly revision: number;
  readonly writerId: string;
  readonly writtenAt: string;
  readonly schemaVersion: number;
  readonly tombstones: readonly Tombstone[];
  readonly appliedOperations: Readonly<Record<string, string>>;
};

export type FileDocument = {
  readonly workspaceId: WorkspaceId;
  readonly formatVersion: number;
  readonly sync: FileSyncMeta;
  readonly entities: Readonly<Record<string, StoredEntity>>;
};

export function emptyDocument(workspaceId: WorkspaceId, writtenAt: string): FileDocument {
  return {
    workspaceId,
    formatVersion: FILE_FORMAT_VERSION,
    sync: {
      revision: 0,
      writerId: '',
      writtenAt,
      schemaVersion: 1,
      tombstones: [],
      appliedOperations: {},
    },
    entities: {},
  };
}

export function encodeDocument(doc: FileDocument): Uint8Array {
  return zipSync(
    {
      'manifest.json': text(
        JSON.stringify({
          formatVersion: doc.formatVersion,
          schemaVersion: doc.sync.schemaVersion,
          workspaceId: doc.workspaceId,
        }),
      ),
      'sync.json': text(JSON.stringify(doc.sync)),
      'entities.json': text(JSON.stringify(doc.entities)),
    },
    { level: 6 },
  );
}

export function decodeDocument(bytes: Uint8Array): FileDocument {
  const files = unzipSync(bytes);
  const manifest = read<{
    formatVersion: number;
    schemaVersion: number;
    workspaceId: WorkspaceId;
  }>(files, 'manifest.json');
  if (manifest.formatVersion > FILE_FORMAT_VERSION) {
    throw new Error(`Shared document format ${manifest.formatVersion} is newer than this build.`);
  }
  return {
    workspaceId: manifest.workspaceId,
    formatVersion: manifest.formatVersion,
    sync: read<FileSyncMeta>(files, 'sync.json'),
    entities: read<Record<string, StoredEntity>>(files, 'entities.json'),
  };
}

export function upsertEntity(
  doc: FileDocument,
  entity: StoredEntity,
  operationId: string,
  version: string,
  writerId: string,
  writtenAt: string,
): FileDocument {
  const key = refKey(entity.entityRef);
  const tombstones = entity.deleted
    ? [
        ...doc.sync.tombstones.filter(
          (row) =>
            !(
              row.kind === entity.entityRef.kind &&
              'id' in entity.entityRef &&
              row.id === entity.entityRef.id
            ),
        ),
        {
          kind: entity.entityRef.kind,
          id: 'id' in entity.entityRef ? entity.entityRef.id : key,
          deletedAt: writtenAt,
        },
      ]
    : doc.sync.tombstones;
  return {
    ...doc,
    sync: {
      ...doc.sync,
      revision: doc.sync.revision + 1,
      writerId,
      writtenAt,
      tombstones,
      appliedOperations: { ...doc.sync.appliedOperations, [operationId]: version },
    },
    entities: { ...doc.entities, [key]: entity },
  };
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function read<T>(files: Record<string, Uint8Array>, name: string): T {
  const content = files[name];
  if (!content) throw new Error(`Shared document is missing ${name}.`);
  return JSON.parse(strFromU8(content)) as T;
}
