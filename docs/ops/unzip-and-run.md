# Unzip-and-run verification (M7-PKG-6, Gate H)

This is a device check, not a unit test. Spec 10 §3 and Gate H require a
**managed** Windows device and a **managed** macOS device. The packaging
scripts produce the ZIPs; they cannot answer AppLocker or Gatekeeper.

Spikes S-1 and S-2 own those answers. Until they run, this ticket stays
blocked. Use the list below when the devices are available.

## On each platform

1. Copy `Flowmap-<version>-win-x64.zip` or `Flowmap-<version>-mac-universal.zip`
   from the same commit to a **user-writable** folder (not Program Files,
   not `/Applications` — the product must run from a home or USB path).
2. Unzip. Do not run an installer. There isn't one.
3. Launch `Flowmap.exe` / `Flowmap.app`.
4. Confirm Settings shows the resolved data directory (per-user on first run).
5. Create a `data/` folder beside the executable, quit, relaunch.
6. Confirm Settings now says portable mode and the path is that `data/` folder.
7. Create a workspace, quit, relaunch — the workspace is still there.
8. Delete the unzipped folder. Confirm the application is gone.
9. If step 5 was used, confirm nothing remains in `%APPDATA%\Flowmap` or
   `~/Library/Application Support/Flowmap` from that instance.
10. Repeat once with `FLOWMAP_DATA_DIR` pointed at a third folder.

## Windows extras

- Evergreen ZIP on a machine **with** WebView2: starts.
- Evergreen ZIP on a machine **without** WebView2: a dialog names
  `Flowmap-<version>-win-x64-standalone.zip` and the process exits. It does
  not attempt to install anything.
- Standalone ZIP on a machine without WebView2: starts, Settings says
  "Bundled WebView2 (standalone)".
- Publisher / path / hash rule as decided by S-1.

## macOS extras

- First launch of a notarised, stapled build is not blocked by Gatekeeper.
- Running from a user folder outside `/Applications` works.
- S-2 records the notarisation ticket and the Gatekeeper verdict.

## Rollback

1. Install (unzip) version N, create a workspace, trigger a migration if N+1
   has one.
2. Confirm `flowmap.pre-migration-*.db` exists in the data directory.
3. Keep the N folder. Unzip N+1 beside it, launch, confirm the workspace opens.
4. Quit N+1, restore the pre-migration file, launch N. The workspace opens.

## Local substitute (not Gate H)

`pnpm package:portable` on a developer machine, then inspect
`dist-portable/*.zip` for `PORTABLE.txt` and `Flowmap.exe` / `Flowmap.app`.
That proves the archive layout. It does not prove execution policy.
