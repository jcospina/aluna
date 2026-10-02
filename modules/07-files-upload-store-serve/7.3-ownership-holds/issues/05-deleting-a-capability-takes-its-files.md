# Deleting a capability takes its files

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.3 — Ownership holds
(PLAN decisions 15, 23 and 33; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

Deleting a capability through M4's action removes every file its incarnation owned. It
extends M4's deletion; there is no second deletion path.

**The files adapter registers under the reserved name.** M4 reserved `owned_files` and
left it unregistered, so an unknown adapter fails hard and no real file obligation is
discharged by accident. This issue registers a real adapter under that name against
`OwnedResourceCleanupAdapter`, beside the version-artifacts adapter in the production
inventory. Before the table drops, it collects every ledger key for the incarnation in
one query:

- owned in an active field
- owned in an inactive field
- pending
- already enqueued

It cleans each one as 7.3/01 does: both paths, and already-absent counts as success.

**It passes M4's acceptance fake.** The fake in
`src/lifecycle/deletion/destruction/seam-fakes/owned-resources.test-support.ts` models the
same sets, calls owned keys `committed`, and tracks each record id. The real adapter
passes the battery the fake was written for.

**Ledger rows are retired in the tombstone transaction.** Platform SQL beside
`purgeInstalledCapabilityPayloads` deletes the incarnation's ledger rows. It is not an
adapter callback, for the reason `installed-payloads.ts` gives. The manifest keeps the
duty to delete the bytes.

**Deletion's lease covers these unlinks.** M4 cleans a tombstone inline under the
deletion lease and retries it under a platform write, so the adapter's unlinks hold saves
and uploads while they run. That breaks 7.3/01's no-lease rule for the worker, and it is
acceptable for the local store. A cloud adapter would batch its deletes.

**An upload that meets a deletion loses cleanly.**

- Deletion's drain cancels a streaming upload through its read token. The upload deletes
  its staged file, and it had no row to touch.
- An upload that finished streaming just as the deletion began is refused by its ledger
  write's check that the incarnation is still active, and it deletes its staged file.
- A row that committed just before the deletion is a pending key like any other, and the
  adapter collects it.

**Files stop serving.** `/files/:key` takes a read token for the row's incarnation, so a
deleted capability's files answer a `no-store` 404 even while their byte cleanup is still
retrying.

## Acceptance criteria

- [x] A real adapter is registered as `owned_files` and collects active-owned,
      inactive-owned, pending and enqueued keys for the incarnation before the table drops
- [x] Every collected key's bytes are removed, and already-absent keys are success
- [x] The adapter passes the acceptance battery M4's fake models
- [x] The incarnation's ledger rows are deleted inside the tombstone transaction by
      platform SQL
- [x] A streaming upload is cancelled by the drain and leaves no staged file; an upload
      finishing as deletion begins is refused and leaves no staged file; a just-committed
      pending row is collected
- [x] A deleted capability's `/files/` addresses answer a `no-store` 404, including
      while cleanup retries
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, build Photos, save two photos, and copy one photo's
address. Delete Photos from its logo menu. `storage/` holds none of its keys, the ledger
holds none of its rows, and the copied address answers 404.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/01-a-displaced-files-bytes-go.md

## What landed

**The files adapter.** `createOwnedFileCleanupAdapter` (`src/lifecycle/deletion/destruction/
owned-files.ts`) answers to `owned_files`, which now lives there and is re-exported from
`two-phase-destruction.ts`. `collect` reads every key the incarnation holds in one query,
`readIncarnationFileKeys` (`src/platform/files/store/ledger.ts`): owned in an active or an
inactive field, pending, and already enqueued. It refuses a malformed key before anything
commits, where it would otherwise wedge the tombstone and keep the id reserved. `clean`
deletes each key through the store's `delete`, staging first and an absent key as success,
under the 7.3/01 worker's time limit (`deleteObjectWithin`, now shared from
`src/platform/files/store/timed-delete.ts`). It refuses a key that still has a ledger row once
the tombstone has committed, since such a key belongs to a live owner, and one that is not a
file key.

**The inventory.** `createProductionCapabilityDeletionAdapters({ objectStore, ledger },
artifactsRoot)` returns the version-artifacts adapter and the files adapter. Both call sites in
`src/server/app.ts` build the object store first. An injected retry supervisor must work on
the app's store and ledger (`DeletionCleanupSupervisor.cleansFilesThrough`); the app refuses
one wired elsewhere, as it already refuses a file cleanup worker wired elsewhere.

**The tombstone transaction.** `commitDeletionTombstone` retires the incarnation's ledger rows
with platform SQL (`deleteIncarnationFiles`) right after `purgeInstalledCapabilityPayloads`,
with a fault seam `afterFileLedgerPurged`. A failure anywhere in the transaction keeps the rows.

**Already in place.** The drain cancelling a streaming upload, the upload's row write refusing
a gone incarnation, and `/files/:key` answering a `no-store` 404 without an active incarnation
came from 7.1. This issue proves each against a real deletion.

**Docs.** PLAN decision 33 (the time limit) and the 7.1 epic text, which now says what an
earlier deletion left and that `bun run reset` is its remedy; the acceptance fake's header.

## Findings from adversarial review, all fixed

Two passes (Opus): a review of the change, then a review of the fixes.

- A test reaching `cleanup_pending` armed the real supervisor's 1 s retry, which fired into
  the next file's closed database (MEDIUM). It now injects a supervisor that never schedules,
  and drives `runOnce()` to prove the retry takes the bytes.
- Ledger rows and bytes left by deletions made before this issue are never collected (MEDIUM).
  The live corpus has none (26 rows, 26 blobs, no orphans), and no-back-compat rules out a
  migration; the 7.1 epic text now names `bun run reset` as the remedy.
- `clean` trusted the manifest, so the fake's store-side guard had no real counterpart (LOW).
  It now refuses a key that still has a ledger row, and one that is not a file key; the test
  uses a spy store and pins no message.
- An injected supervisor could clean through another store (LOW). The app checks it, and,
  from the second pass, the ledger connection too (LOW).
- PLAN 33 said "each unlink" and "rather than holding the lease"; the fake's header overclaimed
  "the same battery"; the test header split a path; a test hard-coded the registry table (LOW).
  All rewritten.
- No test had another capability's row under the same incarnation id, and a malformed ledger
  key would wedge the tombstone after the commit (LOW/INFO). A filter test, and `collect`
  refuses the key before the commit.
- A JSDoc stranded above the wrong method (LOW, second pass). Moved.

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 4538 tests, 0 failed.

New suites: `src/lifecycle/deletion/destruction/owned-files.test.ts` (the battery, the
transaction rollback at both fault seams, the guards, the time limit, the inventory) and
`src/server/files/deletion/capability-deletion.test.ts` (a real deletion through the confirm
route, the 404 while cleanup is owed and the retry, the three upload races, the supervisor
check). The adapter's absence from the inventory, the ledger purge, both guards, the capability
filter and the malformed-key refusal each fail a test when mutated.

Live on `:3030`, with Appliance manuals instead of building Photos, by the owner's instruction:
the database, the capability's tree (three versions, snapshots, specs, logo) and its five
files were backed up to `data/backups/appliance_manuals-20261002-135922/`, and the restore was
rehearsed twice on a scratch copy of the whole corpus booted from its own directory: delete,
restore, reboot, and every hash matched. Deleted live from its logo menu: the registry row,
the data table, all five ledger rows and blobs, and `capabilities/appliance_manuals/` went, no
tombstone stayed, both file addresses answered a `no-store` 404, and the other 16 capabilities
and their 21 files were untouched. Restored and restarted: the registry row, table, ledger,
metrics, blobs and tree match the pre-deletion hashes, both records read through the generated
handler, every file serves its original bytes, and the logo is still `present`.

