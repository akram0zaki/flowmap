/**
 * OneDrive / Finder conflict-copy names.
 *
 * `Portfolio (1).flowmap` and `Portfolio-LAPTOP.flowmap` are created by the
 * sync client when two writers replace the same file. Flowmap must surface
 * them rather than silently ignore a second copy of the portfolio.
 *
 * See docs/spec/08-providers.md §3.
 */

import type { ConflictCopy } from '@flowmap/storage';

import type { FileInfo } from './filesystem.js';

const NUMBERED = /^(.+) \((\d+)\)\.flowmap$/i;
const MACHINE = /^(.+)-([A-Za-z0-9][A-Za-z0-9_-]{0,62})\.flowmap$/i;

export function detectConflictCopies(
  targetPath: string,
  listing: readonly FileInfo[],
  detectedAt: string,
): readonly ConflictCopy[] {
  const targetName = targetPath.split('/').at(-1) ?? targetPath;
  const stem = targetName.replace(/\.flowmap$/i, '');
  const copies: ConflictCopy[] = [];
  for (const file of listing) {
    if (!file.exists || file.path === targetPath) continue;
    const numbered = NUMBERED.exec(file.name);
    if (numbered && numbered[1] === stem) {
      copies.push({ path: file.path, kind: 'NUMBERED', detectedAt });
      continue;
    }
    const machine = MACHINE.exec(file.name);
    if (machine && machine[1] === stem && file.name !== targetName) {
      copies.push({ path: file.path, kind: 'MACHINE', detectedAt });
    }
  }
  return copies;
}

export function isConflictCopyName(name: string): boolean {
  return NUMBERED.test(name) || MACHINE.test(name);
}
