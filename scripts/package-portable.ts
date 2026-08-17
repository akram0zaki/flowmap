/**
 * Build the portable ZIP for the current platform (M7-PKG-1, M7-PKG-2, M7-PKG-3).
 *
 *   pnpm package:portable
 *   pnpm package:portable -- --standalone
 *   pnpm package:portable -- --universal     (macOS, needs both rust targets)
 *
 * Signing and notarisation run when the documented environment variables are
 * present. Without them the ZIP is still produced; it is just not signed.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CARGO_MISSING,
  PORTABLE_README,
  pathWithRust,
  portableArchiveName,
  readBundleVersion,
  rustBinDir,
  type PortableArch,
  type PortablePlatform,
} from './portable-package.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAURI = join(ROOT, 'apps/desktop/src-tauri');
const OUT = join(ROOT, 'dist-portable');

function packagingEnv(): NodeJS.ProcessEnv {
  const rustBin = rustBinDir(homedir(), process.env['CARGO_HOME'], process.platform);
  const cargo = join(rustBin, process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  return {
    ...process.env,
    PATH: pathWithRust(process.env['PATH'], rustBin, existsSync(cargo)),
  };
}

function run(command: string, args: readonly string[], cwd = ROOT): void {
  const result = spawnSync(command, [...args], {
    cwd,
    env: packagingEnv(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

function assertCargo(): void {
  const result = spawnSync('cargo', ['--version'], {
    env: packagingEnv(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(CARGO_MISSING);
  }
}

function platform(): PortablePlatform {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  throw new Error(`Portable packaging is defined for Windows and macOS, not ${process.platform}`);
}

function hostArch(): PortableArch {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function zipFolder(source: string, destZip: string): void {
  if (existsSync(destZip)) rmSync(destZip);
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path "${source}" -DestinationPath "${destZip}" -Force`,
    ]);
    return;
  }
  run('ditto', ['-c', '-k', '--keepParent', source, destZip]);
}

function signWindows(exe: string): void {
  const b64 = process.env['WINDOWS_CERTIFICATE_BASE64'];
  const password = process.env['WINDOWS_CERTIFICATE_PASSWORD'];
  if (!b64 || !password) {
    process.stdout.write('Skipping Authenticode: WINDOWS_CERTIFICATE_BASE64 is not set.\n');
    return;
  }
  const pfx = join(tmpdir(), `flowmap-sign-${process.pid}.pfx`);
  writeFileSync(pfx, Buffer.from(b64, 'base64'));
  try {
    run('signtool', [
      'sign',
      '/fd',
      'SHA256',
      '/td',
      'SHA256',
      '/tr',
      'http://timestamp.digicert.com',
      '/f',
      pfx,
      '/p',
      password,
      exe,
    ]);
  } finally {
    rmSync(pfx, { force: true });
  }
}

function notarizeMac(app: string, zip: string): void {
  const appleId = process.env['APPLE_ID'];
  const applePassword = process.env['APPLE_PASSWORD'];
  const teamId = process.env['APPLE_TEAM_ID'];
  if (!appleId || !applePassword || !teamId) {
    process.stdout.write(
      'Skipping notarisation: APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID are not set.\n',
    );
    return;
  }
  run('xcrun', [
    'notarytool',
    'submit',
    zip,
    '--apple-id',
    appleId,
    '--password',
    applePassword,
    '--team-id',
    teamId,
    '--wait',
  ]);
  run('xcrun', ['stapler', 'staple', app]);
}

function copyWebview2(dest: string): void {
  const from = process.env['FLOWMAP_WEBVIEW2_DIR'] ?? join(ROOT, 'apps/desktop/webview2-runtime');
  if (!existsSync(join(from, 'msedgewebview2.exe'))) {
    throw new Error(
      `Standalone ZIP needs a fixed WebView2 runtime at ${from} (msedgewebview2.exe). ` +
        'Download it from Microsoft and set FLOWMAP_WEBVIEW2_DIR, or run pnpm fetch:webview2.',
    );
  }
  cpSync(from, join(dest, 'webview2'), { recursive: true });
}

function findBuiltApp(universal: boolean): string {
  if (process.platform === 'win32') {
    const exe = join(TAURI, 'target/release/Flowmap.exe');
    if (!existsSync(exe)) {
      throw new Error(`Expected ${exe} after tauri build`);
    }
    return exe;
  }
  const candidates = [
    join(TAURI, 'target/release/bundle/macos/Flowmap.app'),
    join(TAURI, 'target/universal-apple-darwin/release/bundle/macos/Flowmap.app'),
  ];
  if (universal) {
    const universalApp = candidates[1]!;
    if (!existsSync(universalApp)) {
      throw new Error(`Expected a universal .app at ${universalApp}`);
    }
    return universalApp;
  }
  const app = candidates.find((path) => existsSync(path));
  if (!app) {
    throw new Error('Expected Flowmap.app under src-tauri/target after tauri build');
  }
  return app;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const standalone = args.has('--standalone');
  const universal = args.has('--universal');
  const skipBuild = args.has('--skip-build');

  const tauriConf = JSON.parse(readFileSync(join(TAURI, 'tauri.conf.json'), 'utf8')) as {
    version?: string;
  };
  const version = readBundleVersion(tauriConf);
  const os = platform();
  if (standalone && os !== 'win32') {
    throw new Error('The standalone WebView2 ZIP is a Windows artifact.');
  }
  const arch: PortableArch = os === 'darwin' && universal ? 'universal' : hostArch();
  const name = portableArchiveName({ version, platform: os, arch, standalone });

  if (!skipBuild) {
    assertCargo();
    run('pnpm', ['--filter', '@flowmap/desktop', 'build']);
    const tauriArgs = ['tauri', 'build'];
    if (os === 'win32') tauriArgs.push('--no-bundle');
    else tauriArgs.push('--bundles', 'app');
    if (universal) tauriArgs.push('--target', 'universal-apple-darwin');
    run('pnpm', ['exec', ...tauriArgs], ROOT);
  }

  const built = findBuiltApp(universal);
  if (os === 'win32') signWindows(built);

  mkdirSync(OUT, { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), 'flowmap-portable-'));
  const folder = join(staging, 'Flowmap');
  mkdirSync(folder);
  writeFileSync(join(folder, 'PORTABLE.txt'), PORTABLE_README.replaceAll('<version>', version));

  try {
    if (os === 'win32') {
      cpSync(built, join(folder, 'Flowmap.exe'));
      if (standalone) copyWebview2(folder);
    } else {
      cpSync(built, join(folder, 'Flowmap.app'), { recursive: true });
    }

    const zipPath = join(OUT, name);
    zipFolder(folder, zipPath);

    if (os === 'darwin') {
      notarizeMac(join(folder, 'Flowmap.app'), zipPath);
      // Stapling changes the .app; rebuild the ZIP so the stapled ticket ships.
      if (process.env['APPLE_ID']) {
        zipFolder(folder, zipPath);
      }
    }

    process.stdout.write(`Wrote ${zipPath}\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

main();
