/**
 * Fetch or copy a Microsoft Edge WebView2 Fixed Version runtime for the
 * standalone Windows ZIP (spec 10 §3.2).
 *
 * Microsoft does not publish a stable CDN URL. This script copies a local
 * unpack, or downloads a URL you supply from the official download page:
 * https://developer.microsoft.com/en-us/microsoft-edge/webview2/
 *
 *   pnpm fetch:webview2 -- --from /path/to/unpacked-runtime
 *   pnpm fetch:webview2 -- --url https://…/Microsoft.WebView2.FixedVersionRuntime.…x64.cab
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'apps/desktop/webview2-runtime');

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: readonly string[]): { from?: string; url?: string } {
  const out: { from?: string; url?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--from' && next) {
      out.from = next;
      i += 1;
    } else if (arg === '--url' && next) {
      out.url = next;
      i += 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const from = args.from ?? process.env['FLOWMAP_WEBVIEW2_DIR'];
  const url = args.url ?? process.env['FLOWMAP_WEBVIEW2_URL'];

  if (from) {
    if (!existsSync(join(from, 'msedgewebview2.exe'))) {
      fail(`${from} does not contain msedgewebview2.exe`);
    }
    rmSync(DEST, { recursive: true, force: true });
    mkdirSync(dirname(DEST), { recursive: true });
    cpSync(from, DEST, { recursive: true });
    process.stdout.write(`Copied WebView2 runtime to ${DEST}\n`);
    return;
  }

  if (!url) {
    fail(
      'Provide --from <unpacked runtime dir> or --url <official Fixed Version cab/zip>. ' +
        'Download the Fixed Version package from https://developer.microsoft.com/en-us/microsoft-edge/webview2/',
    );
  }

  mkdirSync(DEST, { recursive: true });
  const archive = join(DEST, 'runtime.bin');
  const response = await fetch(url);
  if (!response.ok) {
    fail(`Download failed: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(archive, bytes);

  const expand = process.platform === 'win32' ? 'expand' : 'cabextract';
  const result = spawnSync(
    expand,
    process.platform === 'win32' ? [archive, '-F:*', DEST] : ['-d', DEST, archive],
    {
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    fail(
      `Could not extract the runtime with ${expand}. Unpack the Fixed Version package yourself and re-run with --from.`,
    );
  }
  if (!existsSync(join(DEST, 'msedgewebview2.exe'))) {
    fail(`Extracted ${url} but msedgewebview2.exe was not at the root of ${DEST}`);
  }
  process.stdout.write(`Installed WebView2 runtime at ${DEST}\n`);
}

void main();
