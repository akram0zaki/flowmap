# 10 — Desktop Runtime, Security & Operations

## 1. Shell

**Tauri 2.x** with the system WebView (WebView2 on Windows, WKWebView on macOS).

> ⚠ **Spike-gated.** Tauri is a recommendation until the managed-device spike
> ([execution plan S-1/S-2](../plan/execution-plan.md)) clears. If it fails on execution policy or
> WebView availability, the fallback is Electron with the same React application and the same IPC
> surface — everything above the shell boundary is unaffected, which is why the boundary exists.
> Note that Electron is a _worse_ fit for the portable constraint, not a better one: it ships its own
> Chromium, so a portable Electron folder is ~250 MB against Tauri's ~15 MB.

Rationale for Tauri, in the order that matters given a portable, no-install product:

1. **Small portable folder.** ~15 MB unzipped against Electron's ~250 MB. People copy this folder
   around and sync it; size is a usability property here, not a vanity metric.
2. **System WebView**, so there is no second browser engine to keep patched inside a folder nobody
   is managing.
3. **A Rust core** for the SQLite boundary and, critically, for the atomic file replace the File
   provider depends on.
4. Native notifications and menus without an installer.

## 2. Process and IPC boundary

The web layer has **no direct filesystem, network, or database access**. Everything crosses a
narrow, typed IPC surface implemented as Tauri commands in Rust:

```rust
// database
db_open(workspace_id) -> DbHandle
db_query(handle, sql_id: QueryId, params) -> Rows      // parameterised, allowlisted query ids only
db_apply(handle, changes, events, outbox) -> ()        // single transaction
db_migrate(handle, target_version) -> MigrationReport
db_clear(workspace_id) -> ()

// files
file_pick_open(filters) -> Option<PathBuf>
file_pick_save(default_name, filters) -> Option<PathBuf>
file_read_package(path) -> PortableWorkspace
file_write_package(path, package) -> ()                // temp + fsync + atomic replace
file_open_external(url) -> ()                          // https: only, system browser

// secrets — retained for future use; nothing stores a secret today, because
// there is no authenticated provider. See docs/spec/08-providers.md §4.1.
secret_set(account, value) -> ()                       // OS keychain
secret_get(account) -> Option<String>
secret_delete(account) -> ()

// NOTE: there is no network command. Flowmap makes no outbound requests of any
// kind — no auth, no API, no update check, no telemetry. The shared workspace is
// a file that the OneDrive sync client moves; Flowmap only ever touches the
// filesystem. See docs/spec/08-providers.md §4.

// system
notify(payload) -> ()
app_info() -> AppInfo
diagnostics_export(options) -> PathBuf
```

Hard rules:

- **No raw SQL from the web layer.** `db_query` takes an allowlisted `QueryId` plus parameters. SQL
  text lives in Rust. This removes injection as a category, not as a bug.
- **No network access exists in the shell at all.** There is no HTTP command to allowlist, which
  removes an entire class of review question rather than answering it.
- `file_open_external` accepts `https:` only, and hands the URL to the system browser. This is the
  only way anything leaves the machine.
- CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src ipc: http://ipc.localhost; font-src 'self'`. **No remote content is ever loaded into
  the WebView.** No CDN, no analytics, no remote fonts, no iframes.
- Every IPC payload is validated by a Zod schema on the TypeScript side and a serde type on the Rust
  side. Neither trusts the other.

## 3. Packaging and distribution

> **Confirmed constraint (2026-08-15): there is no installation.** Users cannot install software on
> managed devices, with or without admin rights. Flowmap therefore ships as a **portable archive**:
> unzip to a folder, run from that folder, delete the folder to remove it. There is no MSI, no NSIS,
> no `.pkg`, no registry write, no `%PROGRAMFILES%`, no elevation prompt, and no Intune package.
> This is a hard product requirement, not a preference — an installer-shaped Flowmap cannot be used
> at all.

|                  | Windows                                                 | macOS                                                       |
| ---------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Format           | `Flowmap-<version>-win-x64.zip`                         | `Flowmap-<version>-mac-universal.zip`                       |
| Contents         | `Flowmap.exe` + `resources/` (+ WebView2 runtime, §3.2) | `Flowmap.app` bundle                                        |
| Run from         | Any user-writable folder                                | Any user-writable folder, including outside `/Applications` |
| **Install step** | **None**                                                | **None**                                                    |
| Signing          | Authenticode on `Flowmap.exe`                           | Developer ID on the `.app` + **notarisation** + stapling    |
| Runtime dep      | WebView2 — see §3.2                                     | WKWebView, built into macOS                                 |
| Updates          | Download a new ZIP, replace the folder                  | same                                                        |
| Uninstall        | Delete the folder                                       | Delete the folder                                           |

Signing is still used, and is now doing more work than it does for an installer: a signed binary is
what allows execution-control policy (AppLocker / WDAC / Gatekeeper) to permit a binary that did not
arrive through a managed installer. See §3.3.

### 3.1 Portable data layout

A portable app must not scatter state across the machine, and must not assume the folder it runs
from is writable (it may be on a read-only share).

Flowmap resolves its data directory in this order, and shows the resolved path in Settings:

1. `FLOWMAP_DATA_DIR` environment variable, if set.
2. A `data/` folder **beside the executable**, if that folder exists and is writable — this is
   "fully portable" mode, and is what makes a USB stick or a synced folder work.
3. The per-user application-data directory (default).

|                     | Windows                         | macOS                                               |
| ------------------- | ------------------------------- | --------------------------------------------------- |
| Database, snapshots | `%APPDATA%\Flowmap\workspaces\` | `~/Library/Application Support/Flowmap/workspaces/` |
| Logs                | `%APPDATA%\Flowmap\logs\`       | `~/Library/Logs/Flowmap/`                           |
| Secrets             | Windows Credential Manager      | Keychain                                            |

Creating `data/` next to `Flowmap.exe` switches every one of those to `./data/…`, except secrets:
**OS-secure credential storage is never relocated into the portable folder.** A portable app that
carries credentials in its own directory is a credential-exfiltration feature, not a convenience.
In fully-portable mode Flowmap therefore runs without any stored secret, which is fine because the
File provider needs none.

### 3.2 WebView2 — the one real risk on Windows

macOS is straightforward: WKWebView is part of the OS, so a notarised `.app` in a ZIP runs anywhere.

Windows needs the WebView2 runtime, and there are two ways to get it:

| Mode                                                   | Bundle size | Works without WebView2 preinstalled? |
| ------------------------------------------------------ | ----------- | ------------------------------------ |
| **Evergreen** (use the system runtime)                 | ~15 MB      | No — the app will not start          |
| **Fixed version** (ship the runtime inside the folder) | ~180 MB     | **Yes**                              |

WebView2 ships with Windows 11 and is delivered to Windows 10 with Microsoft Edge, so it is present
on the large majority of managed fleets. But "large majority" is not a property a portable app can
rely on, because the failure mode is a hard startup failure with no way for the user to fix it.

**Decision:** build both. `Flowmap-<version>-win-x64.zip` uses evergreen;
`Flowmap-<version>-win-x64-standalone.zip` embeds the fixed-version runtime. Ship evergreen by
default and hand out the standalone build to anyone it fails for. The app detects a missing runtime
at startup and says exactly that, naming the standalone download, rather than failing silently.

⚠ **Spike-gated:** confirm WebView2 presence on the target Windows build (spike S-1).

### 3.3 Execution policy

The remaining Windows unknown is whether managed devices permit running an arbitrary `.exe` from a
user-writable folder. AppLocker and WDAC commonly block exactly that, and they block it regardless
of whether an installer was involved.

Mitigation, in order of preference:

1. **Publisher rule.** Authenticode-sign `Flowmap.exe` with the enterprise certificate and have the
   endpoint team allow that publisher. This is why signing still matters without an installer, and
   it is available (confirmed 2026-08-15).
2. **Path rule.** Allow a specific folder, e.g. `%LOCALAPPDATA%\Flowmap\`.
3. **Hash rule.** Per-release allow-listing. Workable but adds a step to every release.

⚠ **Spike-gated:** spike S-1 must answer whether a signed binary runs from a user folder on a
managed device. If none of the three mitigations is available, Windows cannot be supported as a
portable app and the Windows target needs a different conversation — macOS is unaffected either way.

## 4. Data classification and threat model

Flowmap holds **management metadata**: names of initiatives, teams, products, relative sizes, dates,
owners, dependency statements, and short management notes. It is not a store for credentials,
customer data, incident detail, vulnerability detail, production logs, or personal data beyond a
stakeholder's name, work email, and role label.

| Threat                                | Control                                                                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential leakage into notes         | Deterministic secret-pattern detection on paste and save, inline warning, one-click removal, no external transmission ([04 §4.8](04-rules-radar.md#48-integrity-rules))                                                                                  |
| Note used as a document/incident dump | 2,000-character hard limit with a counter and an explanatory tooltip                                                                                                                                                                                     |
| Token theft from disk                 | Refresh tokens only in OS keychain; access tokens in memory only; never in SQLite, logs, exports, or crash data                                                                                                                                          |
| Local cache exposure on a lost device | **⚠ Accepted risk (R12).** Compensating controls: OS full-disk encryption is assumed and verified in the deployment checklist; 30-day offline expiry; clear-local-data; no secrets in cache. Reassessed at production readiness with the security review |
| Exfiltration via export               | Sensitivity warning before export and import; exports exclude all secrets; export is a logged domain event                                                                                                                                               |
| Malicious import file                 | Zod validation + domain invariants + transactional apply; ZIP entries are size-capped and path-traversal-checked; no code execution from any imported content                                                                                            |
| Supply chain                          | Lockfile-pinned dependencies, `npm audit`/`cargo audit` in CI, license scanning, no post-install scripts allowed, reproducible builds                                                                                                                    |
| Remote code in the WebView            | Strict CSP, no remote origins, no `eval`, no user-authored rule scripting                                                                                                                                                                                |
| SQL injection                         | No SQL from the web layer; allowlisted query ids only                                                                                                                                                                                                    |
| Over-broad Graph permissions          | Delegated only, `Sites.Selected` preferred, documented justification per scope                                                                                                                                                                           |

Explicitly out of scope for the Pilot MVP, with owners recorded: cache encryption at rest,
certificate pinning, and DLP integration.

## 5. Notifications

Native desktop notifications are **in** the Pilot MVP.

- **Foreground only.** Notifications fire while Flowmap is open. Conditions missed while closed
  appear in Radar on next launch. Background/scheduled notification support is deferred.
- Eligible events: attention date reached · owned action due · dependency overdue · material health
  deterioration (severity increase to HIGH) · material baseline change affecting the user.
- Settings: `Urgent only` · `My actions` · `Portfolio warnings` · `Stale items` · `Off`, plus quiet
  hours. Default: `My actions`.
- **Radar remains the source of truth.** A notification is a delivery channel for a signal, never a
  separate state, and it is never the only place a condition appears.
- Coalescing: at most one notification per signal per 24 h; more than 3 pending signals collapse
  into a single summary notification. No notification storms.
- If the platform blocks notifications, the app degrades silently to Radar-only and says so in
  settings.

## 6. Diagnostics

- **No automatic telemetry.** None. No usage analytics, no crash reporting service, no phone-home.
- Users may generate an **opt-in diagnostic export**: app/OS version, settings (secrets stripped),
  redacted logs, schema and migration state, entity counts, sync/conflict counters, and the last 200
  log lines. Entity _names_ and note contents are redacted by default, with an explicit opt-in to
  include them.
- The export previews exactly what will be included before writing, and writes to a user-chosen path.
- Logs are structured JSON, rotated at 10 MB × 5 files, and redact URLs, tokens, emails, and note
  bodies at write time.
- The user who first runs the application is the initial workspace owner and the default recipient
  for locally generated diagnostic exports.

## 7. Operations

| Concern           | Approach                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install/rollback  | Versioned signed installers retained; rollback = install previous version. Because schema migrations are forward-only, rolling back the app requires restoring the pre-migration backup, which the release notes state explicitly |
| Schema migration  | Pre-migration backup, transactional apply, checksum verification, restore path on failure                                                                                                                                         |
| Corrupted cache   | Startup integrity check (`PRAGMA integrity_check`); on failure, offer rebuild-from-provider (shared) or restore-from-snapshot (local), never silent deletion                                                                      |
| Disaster recovery | Documented drill: lose the local machine → install elsewhere → authenticate → pull, or import the last `.flowmap`                                                                                                                 |
| Support           | Runbook covering the top failure modes: auth failure, throttling, conflict backlog, migration failure, corrupted cache, provider unavailable                                                                                      |
| Retention         | Snapshots 90 days or last 20; logs 5 rotations; dispositions 90 days after their signal stops evaluating; history retained for the life of the workspace                                                                          |
| Offboarding       | Export → verify hash → `ClearLocalData` → revoke provider access, in that order                                                                                                                                                   |

## 8. Release checklist (per gate)

- [ ] Windows and macOS packages built from the same commit by CI
- [ ] `Flowmap.exe` Authenticode-signed; macOS `.app` signed, notarised, stapled
- [ ] Verified unzip-and-run on a representative managed device of each platform, with no install step
- [ ] Schema migration tested forward from the previous released version, with backup/restore verified
- [ ] `axe-core` clean on every view and modal state; manual screen-reader matrix executed
- [ ] Benchmark suite within budget on reference hardware at 500 commitments
- [ ] `npm audit` / `cargo audit` clean of high and critical findings; licenses reviewed
- [ ] Secret-pattern detection verified against the fixture corpus
- [ ] Diagnostic export verified to contain no secrets and no unredacted note bodies
- [ ] Fault-injection sync suite green (throttling, partial batch, cursor expiry, kill-mid-apply)
- [ ] Release notes state migration impact and rollback procedure
