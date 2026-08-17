# Flowmap — distribution and rollback

How a portable build is produced, handed out, and rolled back. Spec:
[`10-desktop-security.md`](../spec/10-desktop-security.md) §3 and §7.

There is **no installer**. Unzip, run, delete the folder. An MSI, NSIS, `.pkg`,
or Intune package is out of scope.

## Artifacts

| File                                       | Contents                                                            |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `Flowmap-<version>-win-x64.zip`            | `Flowmap.exe` + `PORTABLE.txt`. Uses the system WebView2 runtime.   |
| `Flowmap-<version>-win-x64-standalone.zip` | The same, plus a `webview2/` folder with the Fixed Version runtime. |
| `Flowmap-<version>-mac-universal.zip`      | `Flowmap.app` + `PORTABLE.txt`. WKWebView is part of macOS.         |

All three are produced from the same commit by [`.github/workflows/package.yml`](../../.github/workflows/package.yml).

Ship the evergreen Windows ZIP by default. Hand out the standalone ZIP when a
machine has no WebView2 — the app says so on startup and names that file.

## Build

```bash
pnpm package:portable                 # current platform
pnpm package:portable -- --universal  # macOS, both architectures
pnpm package:portable -- --standalone # Windows, embeds WebView2
```

The standalone build needs an unpacked Fixed Version runtime at
`apps/desktop/webview2-runtime/` (or `FLOWMAP_WEBVIEW2_DIR`). Download it from
[Microsoft's WebView2 page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
and copy it in with `pnpm fetch:webview2 -- --from <dir>`.

Output lands in `dist-portable/`.

## Signing

Signing is what lets AppLocker / WDAC / Gatekeeper permit a binary that did not
arrive through a managed installer (spec 10 §3.3). The scripts sign when the
secrets exist and skip — with a log line — when they do not.

| Secret                                             | Used for                                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| `WINDOWS_CERTIFICATE_BASE64`                       | Authenticode on `Flowmap.exe` (PFX, base64)           |
| `WINDOWS_CERTIFICATE_PASSWORD`                     | PFX password                                          |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` | Developer ID Application, imported by Tauri           |
| `APPLE_SIGNING_IDENTITY`                           | e.g. `Developer ID Application: Example Ltd (TEAMID)` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`    | Notarisation + stapling                               |

A signed, notarised, stapled `.app` is the only macOS artifact that should go
to a managed device. An unsigned ZIP is fine for local verification.

## Data directory

Resolved in this order and shown in Settings:

1. `FLOWMAP_DATA_DIR`
2. a writable `data/` folder beside the executable — fully portable
3. `%APPDATA%\Flowmap\` or `~/Library/Application Support/Flowmap/`

In fully portable mode, workspaces and logs live under `data/`. OS keychain
secrets are **never** copied into that folder. Deleting the unzipped folder
then removes the application and its cache.

## Rollback

Schema migrations are forward-only. Rolling the app back without restoring the
cache leaves the older binary unable to open a newer schema.

1. Keep the previous unzipped folder. Do not overwrite it.
2. Before a migration, Flowmap writes `flowmap.pre-migration-<n>.db` next to
   the live database. Settings shows that directory.
3. To roll back: quit Flowmap, replace the live `flowmap.db` with the
   pre-migration copy (and its `-wal`/`-shm` if present), then run the older
   folder.
4. If the cache is gone, import the last `.flowmap` export.

Release notes must state the schema version, whether a migration runs, and
this procedure. Use [`release-notes.md`](release-notes.md).

## Uninstall

Delete the unzipped folder. If the instance was not fully portable, also
delete the per-user data directory shown in Settings, or use **Clear local
data** first.

## Gate H checks that still need a managed device

The packaging and the Settings path are in the product. Unzip-and-run on a
managed device of each platform is [`unzip-and-run.md`](unzip-and-run.md) and
is blocked on spikes S-1 / S-2.
