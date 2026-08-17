/**
 * Portable archive names and layout (spec 10 §3).
 *
 * Windows evergreen:  Flowmap-<version>-win-x64.zip
 * Windows standalone: Flowmap-<version>-win-x64-standalone.zip
 * macOS:              Flowmap-<version>-mac-universal.zip
 */

export type PortablePlatform = 'win32' | 'darwin';
export type PortableArch = 'x64' | 'arm64' | 'universal';

export type PortableArchiveSpec = {
  readonly version: string;
  readonly platform: PortablePlatform;
  readonly arch: PortableArch;
  readonly standalone?: boolean;
};

export function portableArchiveName(spec: PortableArchiveSpec): string {
  const version = spec.version.replace(/^v/, '');
  if (spec.platform === 'win32') {
    const suffix = spec.standalone ? '-standalone' : '';
    return `Flowmap-${version}-win-x64${suffix}.zip`;
  }
  const arch = spec.arch === 'universal' ? 'universal' : spec.arch;
  return `Flowmap-${version}-mac-${arch}.zip`;
}

export function readBundleVersion(tauriConf: { readonly version?: string }): string {
  const version = tauriConf.version?.trim();
  if (!version) {
    throw new Error('tauri.conf.json is missing a version');
  }
  return version;
}

/** rustup's default bin dir. `CARGO_HOME` wins when the toolchain was relocated. */
export function rustBinDir(
  home: string,
  cargoHome: string | undefined,
  platform: NodeJS.Platform,
): string {
  const root =
    cargoHome && cargoHome.length > 0
      ? cargoHome
      : `${home}${platform === 'win32' ? '\\.cargo' : '/.cargo'}`;
  return platform === 'win32' ? `${root}\\bin` : `${root}/bin`;
}

/**
 * rustup installs cargo to ~/.cargo/bin, which many GUI terminals and
 * non-login shells never put on PATH. Prepend it when the binary is there.
 */
export function pathWithRust(
  pathEnv: string | undefined,
  rustBin: string,
  rustBinPresent: boolean,
): string {
  if (!rustBinPresent) return pathEnv ?? '';
  const delimiter = rustBin.includes('\\') && !rustBin.includes('/') ? ';' : ':';
  const parts = (pathEnv ?? '').split(delimiter).filter(Boolean);
  if (parts.includes(rustBin)) return pathEnv ?? '';
  return parts.length === 0 ? rustBin : `${rustBin}${delimiter}${parts.join(delimiter)}`;
}

export const CARGO_MISSING =
  'Cannot find cargo. Install Rust from https://rustup.rs/ so ~/.cargo/bin/cargo exists, then run this again.';

export const PORTABLE_README = `Flowmap — portable build
========================

There is no installer. Unzip this folder, run Flowmap, delete the folder to remove it.

Windows
  Double-click Flowmap.exe.

macOS
  Open Flowmap.app. The first launch of an unsigned local build may need
  System Settings → Privacy & Security → Open Anyway.

Where data lives
  1. FLOWMAP_DATA_DIR, if set.
  2. A writable data/ folder beside this executable — fully portable.
  3. Otherwise the per-user application data folder (shown in Settings).

Fully portable
  Create a folder named data next to Flowmap.exe or Flowmap.app. Workspaces
  and logs then live inside that folder. Secrets stay in the OS keychain and
  are never copied here.

WebView2 (Windows)
  This evergreen build needs the system WebView2 runtime (ships with Windows 11
  and Microsoft Edge). If Flowmap will not start, download the matching
  Flowmap-<version>-win-x64-standalone.zip — that copy includes the runtime.

Rollback
  Keep the previous folder. Schema migrations are forward-only: restore the
  pre-migration backup from Settings' data directory (flowmap.pre-migration-*.db)
  before running an older build against the same cache.

Deleting this folder removes the application. If you used per-user data rather
than data/ beside the app, clear that folder from Settings first.
`;
