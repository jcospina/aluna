# A displaced file's bytes go

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.3 — Ownership holds
(PLAN decisions 13, 30 and 31; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

The cleanup worker drains the ledger. Since 7.1, a replaced photo, a cleared photo, a
deleted record's files and an upload whose client left have all moved their rows to
`cleanup_enqueued` and kept their bytes. After this issue their bytes are gone and their
rows deleted.

**The ledger is the queue.** A row moves to `cleanup_enqueued` inside the transaction
that displaces it, which 7.1/05 already does. The worker wakes only after that
transaction commits. A Handler that updates and then fails therefore leaves the old file
untouched.

**Cleanup is idempotent.** For each key the worker unlinks `storage/.incoming/<key>` and
then `storage/<key>`. That order means a rename racing the cleanup either finds its
source gone or lands where the second unlink removes it. A path that is already absent
counts as success, as it does for every adapter behind the owned-resource manifest.

**Bytes are deleted outside any lease.** A lease held across an unlink stalls every save
and upload, and so would a network delete once the store is S3. The worker unlinks
without a lease. It then takes a short platform write to delete the row, or, on failure,
to record the attempt count and the last error.

**Retries are bounded and wake on real events.** The worker borrows the 1s, 5s, 30s
timing `DeletionCleanupSupervisor` uses, and keeps its own retry state in the ledger
rather than on registry tombstones. After the last retry, the next desk load forces
another try, as it does for a stuck capability deletion. Boot drains whatever is
enqueued.

What 7.1/05 landed for this issue. An edit tells a kept key the record no longer holds by
its displaced row, which still names the capability, incarnation, field and record
(`heldByThisRecord` in `src/runtime/data/access/file-claims.ts`). Deleting that row takes
the evidence with it: once the worker drains, a stale keep reads as an unknown key and the
person is asked to add a photo they never touched, where PLAN decision 16 says the entry
changed in another window. Keeping that answer after the drain is this issue's to design,
for instance by leaving the edit check what it needs past the row, or by having the edit
form post the key it was drawn with, which would also stop a stale replace or clear from
giving up a photo another tab saved.

## Acceptance criteria

- [ ] After a replace, a clear or a record delete commits, the displaced key's bytes are
      unlinked and its row deleted
- [ ] A Handler that updates and then fails wakes no cleanup, and the old bytes stay
- [ ] Cleanup unlinks the staging path before the stored path, and an already-absent
      path is success
- [ ] No lease is held while bytes are unlinked; the row delete and the failure record
      are short platform writes
- [ ] A failing unlink records its attempt count and last error, retries at 1s, 5s and
      30s, and is retried again on the next desk load
- [ ] Boot drains every `cleanup_enqueued` row
- [ ] A kept key whose displaced row the worker has already deleted still answers
      `record_changed`
- [ ] A replace or a clear posted from a form drawn before another tab saved the field
      answers `record_changed` and gives nothing up, unless PLAN decision 16 is amended to
      accept that the last save wins
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open Photos and replace a photo. The old key's file
disappears from `storage/`, and its ledger row is gone. Delete a record that holds a
photo, and its file goes the same way. The saved photos still render.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/09-alunas-questions-never-see-a-photos-key.md
