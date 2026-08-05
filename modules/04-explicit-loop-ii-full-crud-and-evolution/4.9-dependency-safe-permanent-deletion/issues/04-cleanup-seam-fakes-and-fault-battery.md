# Owned-resource cleanup seam fakes and the deletion fault battery

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.9 — Dependency-safe
permanent capability deletion
(PLAN decision 35: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The cleanup seam that pre-pays Module 6 (files) and Module 7 (Event Log),
proven with fakes, plus the epic's consolidated fault battery.

- **Artifact collector/cleaner.** M4's real contribution: collect and delete
  version artifacts idempotently (an already-absent resource is success).
- **Fake owned-resource acceptance adapter (M6 seam).** Proves the manifest
  absorbs every target-incarnation file lifecycle state before table drop:
  committed references from active **and inactive** `file | file[]`-shaped
  fields, pending ownership, and already-enqueued cleanup. Keys deduplicated
  and incarnation-bound through tombstone cleanup.
- **Event Log fake (M7 seam).** Event ownership provenance is derived
  server-side from admitted route/query/read-token context and canonical
  payload production; client- or model-supplied incarnation labels are never
  trusted. Ingestion validates and appends the complete derived set atomically
  only while every pair remains active/current — a late pre-deletion batch
  cannot resurrect purged data.
- Generation metrics are explicitly outside this seam.
- **Fault battery (plan acceptance).** Before/after DB commit, partial cleanup,
  restart, same-id recreation with a new incarnation, read-token
  timeout/reopen, late stale Event Log ingestion, path traversal/symlink
  rejection in artifact cleanup, and repeated (idempotent) cleanup.

## Acceptance criteria

- [x] The fake resource adapter proves absorption of committed, pending, and
      already-enqueued cleanup states before table drop; keys deduplicated,
      incarnation-bound
- [x] The Event Log fake proves server-derived provenance (spoofed labels
      ignored) and atomic late-batch rejection once any pair is closing/gone
- [x] Artifact cleanup rejects path traversal and symlink escapes; repeated
      runs are idempotent; absent resources succeed
- [x] The full fault battery is green and each case is listed in the issue's
      verification notes
- [x] Generation metrics survive every deletion scenario
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not user-visible beyond deletion continuing to work; the dev preview lists the
collected manifest and cleanup progress for the last deletion (including the
fake adapters' absorbed states), demonstrating the M6/M7 seams are real.

Built as `/demo/deletion-cleanup` and **removed again in this same issue**, once
it had done its job.

It existed while this work was in progress: it showed the last deletion's
manifest with each entry's cleanup outcome, the ownership states the collection
absorbed, and the Event Log rows with their server-derived provenance, driven by
per-capability buttons that staged resources, recorded events, and replayed a
pre-deletion batch. That is how the seam was verified live on :3030 (the run is
recorded under *Live verification* below).

It comes down because this is the last issue in the epic, so there is no work
left for it to scaffold. It added no coverage — everything it showed is asserted
by the fault battery and the two seam-fake suites — and keeping it carried a real
cost: wiring it put the M6 fake into the *live* deletion adapter inventory in dev,
which is what let a dev-written tombstone name an adapter a production bundle
could not discharge. Removing the surface removes that hazard at the root rather
than defending against it.

Taken down with it: the deletion journal and its plumbing through
`destroyCapability` / `http.ts` / `AppDeps`, the seam-rehearsal wiring in
`src/app/app.ts`, and the reserved-adapter stand-in that only existed to protect
the demo's live path. The seam fakes moved to `*.test-support.ts`, which is what
they always were — test fixtures — and are now structurally unable to reach a
running server's module graph.

`/demo/read-gates` (4.9/01) went the same way and for the same reason. Everything
it demonstrated is covered by `src/router/router.read-gates.test.ts`,
`src/read-gates/index.test.ts`, and the fault battery, so neither removal took
evidence with it. `src/app/app.test.ts` pins both as 404 in every environment.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.9-dependency-safe-permanent-deletion/issues/03-two-phase-destruction-durable-tombstone.md

## Implementation notes

- **Artifact collector/cleaner** (`src/capability-deletion/two-phase-destruction.ts`).
  Already M4's real adapter from 4.9/03; this issue proved and hardened its
  contract rather than rewriting it — the incarnation root is bound to the
  configured artifacts root, a traversal key or a symlinked parent is refused
  before anything is removed, and an already-absent directory is success.
- **Core-owned Event Log purge** (`src/capability-deletion/installed-payloads.ts`).
  The `purgeInstalledCapabilityPayloads` stub 4.9/03 left behind is now real SQL
  over the fixed `event_log` / `event_log_ownership` store, running inside
  deletion's one transaction so it commits or rolls back with the tombstone and
  the table drop. It is conditional on the store being installed: a platform
  without M7 purges nothing and reports zeroes. Payloads are irreversibly
  redacted and ownership rows released, leaving the content-free deletion fact
  ARCH §6.3 allows. No adapter callback runs inside that transaction.
- **M6 owned-resource acceptance fake**
  (`src/capability-deletion/seam-fakes/owned-resources.test-support.ts`). An in-memory object
  store that tracks references and bytes separately, so cleaning a key twice is
  observably a success. It models committed references through active *and*
  inactive `file`/`file[]` fields, pending ownership, and already-enqueued
  cleanup, and refuses a reference naming an undeclared field, a committed
  reference with no readable record, or collection attempted after the table is
  gone. It returns duplicate keys deliberately — deduplication is the manifest's
  job, and doing it in the collector would hide a regression there.
- **M7 Event Log acceptance fake**
  (`src/capability-deletion/seam-fakes/event-log.test-support.ts`). Installs the same fixed
  store the core purge owns. Ownership is derived server-side from the admitted
  route/action and the read-token set the platform itself issued; the proposed
  event carries `claimedIncarnations` and `claimedPayload` precisely so the tests
  can assert neither reaches the store. Ingestion validates the complete derived
  set against the read gates and the registry and appends the whole batch in one
  transaction, or appends nothing.
- **The seam fakes are test fixtures, not wiring.** Both live under
  `src/capability-deletion/seam-fakes/*.test-support.ts`, so bun does not run them
  and the server's module graph never reaches them. `OWNED_RESOURCE_ADAPTER`
  (`owned_files`) reserves the name M6 will install for real; nothing registers it
  today. A manifest naming an adapter this process lacks stays a hard failure on
  purpose — a real M6 obligation must never be discharged by accident.
- **Deletion itself is unchanged in shape.** `destroyCapability` and
  `recoverCapabilityDeletionTombstones` take the same inputs they did after
  4.9/03; the only production change is the real Event Log purge replacing the
  stub, and the purge counts surfacing on `CapabilityDestructionResult`.

### What the fakes do and do not prove

Stated plainly so a later module does not inherit a false assumption:

- The `file` / `file[]` **shape is carried, not enforced**. M6 adds those field
  types; until then the fake records the shape on each reference and the tests
  assert it round-trips, but no field is actually `file`-typed and one `file[]`
  reference holds one key rather than several.
- **`cleanup_enqueued` is a state label, not a queue.** The fake has no cleanup
  queue to drain. What is genuinely proven is that a reference already handed to
  cleanup is still absorbed by the manifest and does not outlive the capability.
- **The `queued` ingestion context trusts its ownership array.** It models a batch
  whose ownership was derived server-side earlier, and only revalidation defends
  it. Nothing reachable over HTTP constructs one — the demo replays only the set
  the live derivation produced.
- **The M7 store is installed only by tests**, never by a migration and never by
  a running server (`src/persistence/migrations.ts` still reserves the Event Log
  for M7). `purgeInstalledCapabilityPayloads` is conditional on the tables being
  present, so a real platform purges nothing until M7 installs them. `bun run
  reset` now clears `event_log_ownership` alongside `event_log`, which was
  already listed — a leftover from before this seam existed.

## Verification

- `bun run test` — 1,139 passed, 0 failed across 8 shards.
- `bun run typecheck` — clean.
- `bun run lint` — clean across everything tracked (`src`, `scripts`, `docs`,
  `modules`). `bun run lint` runs `biome check .`, which also reaches the
  untracked `design/` scratch tree; the diagnostics it reports there are not from
  this change and were left alone.
- Two independent adversarial reviews (security/correctness and spec
  conformance). Every finding was either fixed or recorded above:
  - **A dev manifest was unrecoverable under a production run** — a dev deletion
    persisted a tombstone naming `owned_files`, which a production bundle could
    not discharge, failing on every boot forever and reserving the capability id
    with it. Root cause: the demo put the M6 fake on the live adapter path.
    Resolved by removing the demo, so no fake ever reaches a durable manifest.
  - **Three findings dissolved with the demo**: the journal reporting an empty
    manifest on refusals, the preview being unable to show absorbed states after
    cleanup, and its ingestion writing on the shared connection without a
    mutation-coordinator lease. All three were defects in the demo path.
  - **Fixed — `bun run reset` left orphaned `event_log_ownership` rows.**
  - **Fixed — thin or vacuous assertions**: both "another incarnation" guards
    were untested; the co-owned-payload purge and mid-batch ingestion atomicity
    were unproven; `generation_lifecycle_metrics` was never asserted; the restart
    case fed `recoverAtBoot` an empty catalog.
    Four new tests survive the unwind, and the restart case now rebuilds from the
    real catalog and asserts the survivor's gate returns while the deleted one
    does not.
  - **Verified clean**: SQL identifier interpolation (capability ids are
    regex-validated before any table name is derived, and both new sites also
    quote-escape), transaction rollback across the purge, incarnation binding at
    all five layers, dev/production route leakage, and unawaited rejections.

### Fault battery (`src/capability-deletion/fault-battery.test.ts`)

Each case from the plan's acceptance list, one test:

1. **Before the database commit** — the capability, its records, its table, and
   its read gate are untouched, and nothing was cleaned.
2. **After the database commit** — the capability is gone, the table is dropped,
   the tombstone is durable, and the drained gate stays retired rather than
   reopening.
3. **Partial cleanup** — the first entry is cleaned and the second fails; the
   tombstone survives carrying its *complete* manifest, so a retry re-runs both.
4. **Restart** — a cold object store finishes the pending obligation with both
   entries reporting already-absent, and rebuilding the gate catalog from the
   real registry returns the surviving capability's gate while never resurrecting
   the deleted one.
5. **Same-id recreation with a new incarnation** — the semantic id is reserved
   while cleanup is pending, then recreates at a new incarnation whose resources
   are its own.
6. **Read-token timeout and reopen** — a reader that will not drain times the
   close out; the in-flight read is signalled, the gate reopens and takes new
   readers, and nothing was collected.
7. **Late stale Event Log ingestion** — payloads are redacted at the purge, and a
   batch derived before the deletion is refused whole afterwards, appending
   nothing.
8. **Path traversal and symlink rejection** — a traversal identity, a symlinked
   capability directory, and an unknown resource key are each refused with the
   outside directory intact, and an artifacts root that does not exist yet still
   refuses an escaping identity. In `src/capability-deletion/artifact-path-safety.test.ts`,
   which needs no database.
9. **Repeated (idempotent) cleanup** — a second recovery pass over a discharged
   deletion is a no-op, and re-running the artifact adapter on the absent
   directory still succeeds.

**Generation metrics survive every case**: every database-backed case seeds both
incarnation-keyed measurement stores — `generation_metrics` and
`generation_lifecycle_metrics` — and asserts both are still there afterwards.

### Seam acceptance

- `src/capability-deletion/seam-fakes/owned-resources.test.ts` — absorption of
  every lifecycle state including two references to one key (deduplicated to one
  manifest entry) and a committed reference reachable only through a retired
  field; the foreign incarnation's resource untouched; collection refused after
  the drop, for an undeclared field, and for an unreadable record; a mid-manifest
  failure recording cleaned/failed/still-owed per entry; both "another
  incarnation" guards; idempotent re-cleanup across a failed pass.
- `src/capability-deletion/seam-fakes/event-log.test.ts` — server-derived
  ownership for a target plus its read dependency; a spoofed incarnation and a
  client payload discarded; released read ownership refused; one closing pair
  rejecting a two-event batch with nothing appended and the same batch appending
  once reopened; a mid-batch insert failure appending nothing; a co-owned payload
  redacted whole with only the deleted owner's ownership released; a late batch
  refused after the purge; a rebuilt incarnation unable to claim the purged one's
  events.

### Live verification (port 3030)

Run through `/demo/deletion-cleanup` while it existed, against the running dev
server, with a throwaway `deletion_rehearsal` capability seeded directly into the
dev database so no capability the user built was touched:

- staged 6 owned-resource references (committed on an active field, the same key
  again on a second active field, one committed only on an **inactive** field,
  one pending, one already-enqueued, and one owned by a foreign incarnation);
- recorded one event, whose stored payload was the server-produced canonical one
  and whose ownership was the derived pair, not the spoofed label;
- deleted it from the platform confirmation route: the preview then showed four
  deduplicated `owned_files` entries plus `version_artifacts`, every one
  `cleaned`, `Event payloads redacted: 1`, `ownership rows released: 1`,
  `tombstone remaining: no`;
- the absorbed-states panel listed all five collected references with their
  fields and shapes — `…-cover / experiment_name (active) / file / committed`,
  `…-cover / hypothesis (active) / file[] / committed` (the same key through a
  second field, one manifest entry), `…-retired / methods (inactive) / file[] /
  committed`, `…-pending / pending`, `…-enqueued / cleanup_enqueued`;
- the foreign incarnation's resource was still staged and untouched;
- replaying the pre-deletion batch returned
  `The late batch was rejected whole (incarnation_not_current).`;
- the registry row, the `cap_deletion_rehearsal` table, and the incarnation's
  artifact directory were all gone, the event row remained with an empty payload
  and `redacted = 1` and no ownership rows, and the other six capabilities were
  untouched;
- `/demo/read-gates` and `/demo/read-gates/state` returned 404;
- afterwards the rehearsal capability, its empty artifact directory, and the
  dev-installed Event Log tables were removed, leaving the dev database as found.

## HITL test instructions

The seam's own preview is gone, so the human check is that ordinary deletion is
still whole, plus the retired surfaces staying retired.

1. Reuse the running development server, or run `bun run dev` if port 3030 is not
   already listening.
2. Build a capability from the homepage prompt bar, or use one you do not mind
   losing, and add a record to it.
3. Delete it from the toolbar and confirm permanently. Expect the confirmation to
   state the permanent loss of records, version history, owned resources, and
   event payloads while noting generation metrics remain, and expect the toolbar
   entry, the View, and the content area to be gone afterwards with no dead URL.
4. Confirm the capability's directory under `capabilities/<id>/<incarnation>/` is
   gone from disk, and that `data/omni-crud.db` has no `capability_registry` row
   and no `cap_<id>` table for it.
5. Rebuild the same thing from the prompt bar. It should come back as a fresh v1
   at a new incarnation, with no records and no history from the deleted one.
6. Confirm `http://localhost:3030/demo/read-gates` and
   `http://localhost:3030/demo/deletion-cleanup` both return 404 — epic 4.9's two
   previews are retired.

The M6/M7 seam evidence is no longer a browser surface. It lives in
`bun run test src/capability-deletion`, whose names read as the acceptance list.
