/**
 * @flowmap/storage-file — versioned shared-document provider.
 *
 * Contract: docs/spec/08-providers.md §3
 */

export { FileProvider, type FileProviderOptions } from './provider.js';
export { MemoryFileSystem, type MemoryFsFaults } from './memory-fs.js';
export { detectConflictCopies, isConflictCopyName } from './conflict-copies.js';
export {
  decodeDocument,
  encodeDocument,
  emptyDocument,
  FILE_FORMAT_VERSION,
  type FileDocument,
} from './document.js';
export type { FileSystemAdapter, FileInfo } from './filesystem.js';
export { readMaterialised } from './filesystem.js';
