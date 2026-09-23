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

- [ ] A real adapter is registered as `owned_files` and collects active-owned,
      inactive-owned, pending and enqueued keys for the incarnation before the table drops
- [ ] Every collected key's bytes are removed, and already-absent keys are success
- [ ] The adapter passes the acceptance battery M4's fake models
- [ ] The incarnation's ledger rows are deleted inside the tombstone transaction by
      platform SQL
- [ ] A streaming upload is cancelled by the drain and leaves no staged file; an upload
      finishing as deletion begins is refused and leaves no staged file; a just-committed
      pending row is collected
- [ ] A deleted capability's `/files/` addresses answer a `no-store` 404, including
      while cleanup retries
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, build Photos, save two photos, and copy one photo's
address. Delete Photos from its logo menu. `storage/` holds none of its keys, the ledger
holds none of its rows, and the copied address answers 404.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/01-a-displaced-files-bytes-go.md
