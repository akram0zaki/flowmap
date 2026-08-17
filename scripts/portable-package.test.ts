import { describe, expect, it } from 'vitest';

import {
  pathWithRust,
  portableArchiveName,
  readBundleVersion,
  rustBinDir,
} from './portable-package.js';

describe('portable archive names', () => {
  it('matches spec 10 §3 for Windows evergreen and standalone', () => {
    expect(portableArchiveName({ version: '0.1.0', platform: 'win32', arch: 'x64' })).toBe(
      'Flowmap-0.1.0-win-x64.zip',
    );
    expect(
      portableArchiveName({
        version: '0.1.0',
        platform: 'win32',
        arch: 'x64',
        standalone: true,
      }),
    ).toBe('Flowmap-0.1.0-win-x64-standalone.zip');
  });

  it('matches spec 10 §3 for a macOS universal ZIP', () => {
    expect(portableArchiveName({ version: '0.1.0', platform: 'darwin', arch: 'universal' })).toBe(
      'Flowmap-0.1.0-mac-universal.zip',
    );
  });

  it('strips a leading v from the version', () => {
    expect(portableArchiveName({ version: 'v1.2.3', platform: 'darwin', arch: 'arm64' })).toBe(
      'Flowmap-1.2.3-mac-arm64.zip',
    );
  });

  it('reads the version from tauri.conf.json', () => {
    expect(readBundleVersion({ version: '0.1.0' })).toBe('0.1.0');
    expect(() => readBundleVersion({})).toThrow(/missing a version/);
  });
});

describe('rust PATH', () => {
  it('uses CARGO_HOME when set, otherwise ~/.cargo/bin', () => {
    expect(rustBinDir('/Users/x', undefined, 'darwin')).toBe('/Users/x/.cargo/bin');
    expect(rustBinDir('/Users/x', '/opt/cargo', 'darwin')).toBe('/opt/cargo/bin');
    expect(rustBinDir('C:\\Users\\x', undefined, 'win32')).toBe('C:\\Users\\x\\.cargo\\bin');
  });

  it('prepends the rustup bin dir when cargo lives there and PATH omitted it', () => {
    expect(pathWithRust('/usr/bin:/bin', '/Users/x/.cargo/bin', true)).toBe(
      '/Users/x/.cargo/bin:/usr/bin:/bin',
    );
    expect(pathWithRust('/Users/x/.cargo/bin:/usr/bin', '/Users/x/.cargo/bin', true)).toBe(
      '/Users/x/.cargo/bin:/usr/bin',
    );
    expect(pathWithRust('/usr/bin', '/Users/x/.cargo/bin', false)).toBe('/usr/bin');
  });
});
