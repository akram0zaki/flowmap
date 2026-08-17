# Release notes template

Every shipped build uses this shape. Copy the block into the GitHub release
(or the note that travels with the ZIP). Do not omit the migration or rollback
sections — they are the only way a lead can undo a schema change.

```md
# Flowmap <version>

**Commit:** <sha>
**Schema version:** <n> → <n+k | unchanged>
**Migration:** yes, forward-only / no

## Downloads

- Windows (evergreen WebView2): `Flowmap-<version>-win-x64.zip`
- Windows (WebView2 included): `Flowmap-<version>-win-x64-standalone.zip`
- macOS (universal): `Flowmap-<version>-mac-universal.zip`

There is no installer. Unzip and run. See PORTABLE.txt inside the archive.

## What changed

- …

## Migration impact

- What the migration adds or rewrites.
- Whether existing workspaces open without a prompt.
- Whether a pre-migration backup is written (`flowmap.pre-migration-<n>.db`).

## How to roll back

1. Keep the previous unzipped folder. Do not overwrite it with this one.
2. Quit Flowmap.
3. In the data directory shown in Settings (or `data/` beside the older app),
   replace `workspaces/flowmap.db` with `workspaces/flowmap.pre-migration-<n>.db`.
4. Run the older folder.

If that backup is gone, import the last `.flowmap` export into the older build.

## Verification

- [ ] Unzip-and-run on a managed Windows device (no install step)
- [ ] Unzip-and-run on a managed macOS device (Gatekeeper accepts the staple)
- [ ] `data/` beside the executable is fully portable
- [ ] Deleting the folder removes the application
- [ ] Rollback exercised against a pre-migration backup
```
