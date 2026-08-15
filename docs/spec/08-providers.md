# 08 — Storage Providers

One capability-aware contract, two implementations. The domain and UI never know which provider is
in use; they know only what the contract's capability flags permit.

> **Confirmed 2026-08-15.** Flowmap ships **Local** (single user) and **File** (shared). The
> SharePoint Lists API provider is removed — see §4 for why, and for why that does _not_ mean
> workspaces cannot live in SharePoint.

## 1. Provider contract

```ts
type ProviderId = 'LOCAL' | 'FILE';

type ProviderCapabilities = {
  shared: boolean; // multiple users can target the same workspace
  serverVersioning: boolean; // provider supplies per-entity concurrency tokens (ETags)
  entityLevelWrites: boolean; // false => whole-document read-modify-write
  deltaQuery: boolean; // supports cursor/delta pull
  tombstones: boolean; // deletions are observable
  transactional: boolean; // multi-entity atomic write
  maxBatchOperations: number;
  maxRequestsPerMinute: number | null;
  provisioning: 'AUTOMATIC' | 'MANUAL' | 'NONE';
};

interface WorkspaceProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  // No authenticate(): Flowmap holds no credentials and makes no authenticated
  // calls. Reaching the shared document is the OneDrive sync client's job, using
  // the credentials the user already has. See §4.
  health(): Promise<ProviderHealth>;

  listWorkspaces(): Promise<WorkspaceDescriptor[]>;
  provision(workspaceId: WorkspaceId, schemaVersion: number): Promise<ProvisionResult>;

  pull(
    workspaceId: WorkspaceId,
    cursor: SyncCursor | null,
    opts: { pageSize: number },
  ): Promise<PullPage>;
  push(workspaceId: WorkspaceId, batch: MutationBatch): Promise<PushResult>;
  getEntity(ref: EntityRef): Promise<VersionedEntity | null>;

  exportPortable(workspaceId: WorkspaceId): Promise<PortableWorkspace>;
  importPortable(pkg: PortableWorkspace): Promise<WorkspaceId>;
}
```

Contract rules every implementation MUST satisfy:

- `push` is **idempotent by `operationId`**. A repeated operation returns `DUPLICATE` with the
  current version.
- `pull` is **resumable**. A cursor returned by a page is valid until the provider's retention
  window (documented per provider); an expired cursor returns `CURSOR_EXPIRED` and the engine falls
  back to a full pull.
- Deletions are observable when `tombstones` is true; when false, the sync engine reconciles by
  full-set comparison on a full pull (and the capability is surfaced in the UI as "deletions may
  take until the next full sync to appear").
- When `transactional` is false, the engine orders operations so that no intermediate state violates
  a referential invariant (parents before children, children before parent deletes) and records
  partial-batch state so a resume completes the batch.
- Every provider returns structured errors: `FORBIDDEN`, `NOT_FOUND`, `CONFLICT(remoteVersion)`,
  `PAYLOAD_TOO_LARGE`, `PROVIDER_UNAVAILABLE`, `CURSOR_EXPIRED`, `SCHEMA_VERSION_TOO_NEW`.
  `FORBIDDEN` here means a filesystem permission failure, not an auth failure.

A **contract test suite** (`packages/storage/src/contract-tests`) runs against every implementation,
including a fault-injecting fake that produces throttling, partial failure, cursor expiry, and clock
skew. A provider is not "done" until it passes the whole suite.

## 2. Local provider

|                     |                                |
| ------------------- | ------------------------------ |
| `shared`            | `false`                        |
| `serverVersioning`  | `true` (local `entityVersion`) |
| `entityLevelWrites` | `true`                         |
| `deltaQuery`        | `true`                         |
| `tombstones`        | `true`                         |
| `transactional`     | `true`                         |
| `provisioning`      | `AUTOMATIC`                    |

Backed by the same SQLite database as the cache, in a separate `origin` schema, so the local
workspace exercises the _full_ sync path (outbox, pull, push, conflict) even with one user. This is
deliberate: it means the sync engine is tested continuously from Phase 1, not first exercised when
the first shared workspace appears.

Used for: development, the sample workspace, single-user Pilot MVP, and every automated test.

## 3. File provider — **the shared provider**

The way Flowmap workspaces are shared. A single versioned document living in a SharePoint document
library, a OneDrive folder, or any synced or network folder the team can already reach.

This is what the original problem statement asked for — _"a database shared on OneDrive in some
format"_ — with the write safety a spreadsheet cannot give: per-entity versions, field-level merge,
conflict detection, and tombstones.

|                     |                                                |
| ------------------- | ---------------------------------------------- |
| `shared`            | `true`                                         |
| `serverVersioning`  | `true` (whole-file ETag / version id)          |
| `entityLevelWrites` | **`false`** — whole-document read-modify-write |
| `deltaQuery`        | `false`                                        |
| `tombstones`        | `true` (tombstone rows kept in the document)   |
| `transactional`     | `true` (per whole-document write)              |
| `provisioning`      | `AUTOMATIC`                                    |

Format: a **`.flowmap` ZIP** ([09 §3](09-import-export.md#3-portable-workspace-format)) with an
added `sync.json` carrying `revision`, `writerId`, `writtenAt`, and the tombstone list.

Write protocol:

1. Read the document plus its version token.
2. If the token differs from the one the local cache last saw, run the normal conflict pipeline
   against the remote content before writing.
3. Serialise to a temp file, `fsync`, then **atomically replace** the target
   (`ReplaceFile` on Windows, `rename(2)` on macOS).
4. Write with an `If-Match` precondition when the host supports it; on mismatch, restart from step 1.
5. Never append without a version check. Never merge two divergent JSON documents silently.

Hard rules: **no shared SQLite file, ever.** No lock files as the primary mechanism (they leak on
crash) — the version token is the mechanism; an advisory lock is only an optimisation to reduce
collisions.

Known OneDrive caveats to handle explicitly: delayed propagation (a write may not be visible to a
peer for minutes — the UI states last-known-remote time), conflict-copy files (`* (1).flowmap`,
`*-<machine>.flowmap`) which the provider detects, surfaces, and offers to merge or discard, and
files-on-demand placeholders (must materialise before reading).

Because this provider is now the only route to a shared workspace, its fault-injection suite is not
optional: delayed propagation, conflict copies, placeholder files, a read-only share, a share that
disappears mid-write, and two clients writing within the same sync window are all covered cases.

## 4. SharePoint **Lists API** provider — removed

> **Read this heading carefully: what is removed is the _API_, not SharePoint.**
>
> Flowmap workspaces can and should still live in a SharePoint document library or OneDrive folder.
> That is the File provider (§3), and it is how the product ships. What cannot be built is the
> provider that talks to SharePoint **Lists over Microsoft Graph**.

**Why.** Every programmatic route into SharePoint Online — Graph, the SharePoint REST API, CSOM —
authenticates with OAuth, and OAuth requires an Entra application registration. Confirmed
2026-08-15: an app registration is not obtainable here. There is no supported workaround; the legacy
ACS app-only path is retired, and SharePoint Online does not accept cookie or NTLM auth from a
desktop client.

So the code path that is gone is _"Flowmap calls an API to read and write one row at a time."_ The
code path that remains is _"Flowmap reads and writes a file in a folder, and the OneDrive sync
client moves that file to SharePoint."_ No API, no token, no registration — the sync client already
holds the user's credentials and does the transport.

**What that costs, honestly:**

| With the Lists API                            | With a file in a synced folder                                |
| --------------------------------------------- | ------------------------------------------------------------- |
| Per-entity reads and writes                   | Whole-document read-modify-write                              |
| Server-side conflict detection per row (ETag) | Whole-file version check, then field-level merge locally      |
| Changes visible to peers in seconds           | Visible after the sync client propagates — seconds to minutes |
| Server enforces list permissions              | The folder's permissions are the only boundary                |
| Scales past one workspace per file            | One workspace per document                                    |

For a management-layer tool edited by a handful of leads a few times a week, that trade is
acceptable. For a high-frequency multi-writer system it would not be. Flowmap is the former.

Consequences, all of which the architecture already anticipated:

Consequences, all of which the architecture already anticipated:

- **The File provider is the shared provider**, not a fallback. §3 is now the load-bearing design,
  and a SharePoint document library is its expected home.
- **There is no authenticated identity.** Flowmap has no accounts and issues no passwords, so
  `WorkspaceUser.identitySubject` stays `local:<profileId>` and roles are advisory
  ([§4.1](#41-identity-and-authorisation-without-an-identity-provider)).
- **No token storage, no offline expiry, no access revalidation.** The 30-day offline window in
  [07 §6](07-persistence-sync.md#6-offline-behaviour) does not apply; there is nothing to expire.
- **`http_request` is removed from the IPC surface.** Flowmap makes no network calls at all. The
  only outbound action is opening an external `https:` link in the system browser. This is a
  meaningful reduction in attack surface and in what the security review has to cover.

The `WorkspaceProvider` contract stays exactly as specified. If an app registration ever becomes
available, adding a SharePoint provider is a new package behind the existing interface and changes
nothing above it — which is the entire reason the interface exists.

The topology, Graph batching, ETag, and throttling design that previously lived here is preserved in
git history at the commit that introduced this section, should it ever be revived.

### 4.1 Identity and authorisation without an identity provider

This is the honest position, and the UI must state it rather than implying a guarantee:

| Concern                                                  | Reality                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Who a change is attributed to                            | A local profile name, chosen at first run. Self-asserted, not verified   |
| What stops someone editing the baseline                  | The file share's own permissions. Nothing in Flowmap                     |
| What Viewer / Contributor / Planner roles do             | Shape the UI and prevent accidents. They are **not** a security boundary |
| What stops someone editing the workspace outside Flowmap | Nothing. It is a file they can open                                      |

Workspace settings carries this text verbatim, not a softened version:

> Flowmap does not verify who you are. Names on changes are self-declared, and roles here prevent
> accidents rather than enforce permissions. Access to this workspace is controlled entirely by who
> can reach the shared file.

Because a `PLANNER` claim is unverifiable, role changes are recorded as domain events like any other
change, so at least the history shows who granted what and when.

## 5. Provider selection UX

- Workspace creation asks where the workspace lives: **This computer** (Local) ·
  **Shared file** (File) · **SharePoint site** (SharePoint, when configured).
- The choice is stored per workspace. A workspace can be **migrated** between providers by
  export → import, which is a supported, documented path with a diff shown before it completes.
- Capability differences are surfaced honestly, never hidden: a File-provider workspace shows
  "Changes appear for others after each save and may take a few minutes to propagate", a
  SharePoint workspace shows live sync status.
