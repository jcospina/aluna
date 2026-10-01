# A displaced file's bytes go

Status: ready-for-agent — built and verified; waiting on the owner's sign-off

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

- [x] After a replace, a clear or a record delete commits, the displaced key's bytes are
      unlinked and its row deleted
- [x] A Handler that updates and then fails wakes no cleanup, and the old bytes stay
- [x] Cleanup unlinks the staging path before the stored path, and an already-absent
      path is success
- [x] No lease is held while bytes are unlinked; the row delete and the failure record
      are short platform writes
- [x] A failing unlink records its attempt count and last error, retries at 1s, 5s and
      30s, and is retried again on the next desk load
- [x] Boot drains every `cleanup_enqueued` row
- [x] A kept key whose displaced row the worker has already deleted still answers
      `record_changed`
- [x] A replace or a clear posted from a form drawn before another tab saved the field
      answers `record_changed` and gives nothing up, unless PLAN decision 16 is amended to
      accept that the last save wins
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open Photos and replace a photo. The old key's file
disappears from `storage/`, and its ledger row is gone. Delete a record that holds a
photo, and its file goes the same way. The saved photos still render.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/09-alunas-questions-never-see-a-photos-key.md

## What landed

**The worker.** `src/server/files/cleanup/file-cleanup.ts` drains the ledger. It reads the queue on
the read-only connection, so a key enqueued by a save still open on the shared connection is never
seen. For each key it calls `ObjectStore.delete`, which unlinks `storage/.incoming/<key>` then
`storage/<key>`, counts an absent path as success, and now fsyncs both directories before it
settles, so a deleted row never outlives bytes a power cut brought back. No lease is held while
bytes go. One short platform write per pass then deletes the cleaned rows and records each failure's
attempt count and last error (capped at the tombstone's 500 characters). A delete that hangs past
60 seconds counts as a failure.

**Waking.** The capability router wakes the worker after a create, update or delete answers ok, which
only a committed write does; the wake is a required argument of `registerCapabilityRoutes`. The
upload route wakes it after an abandoned key's move to cleanup commits. The pass starts once the
request has answered (`setImmediate`). A Handler that updates and then fails rolls back, answers
non-ok, and wakes nothing. Boot (`src/index.ts`) awaits a drain of every enqueued row, exhausted ones
included, before it listens. Every desk load presses a drain too, which the render does not wait for.

**Retries.** Each failed key keeps its own place on `DeletionCleanupSupervisor`'s 1s, 5s and 30s
delays: its attempts on the ledger row and its next due time in the worker. A wake for another key
never spends its retries, and a fresh failure is never queued behind a key waiting 30 seconds. After
its first try and three retries a key waits for a desk load, and the worker logs that it stopped. A
pass that cannot write its outcomes backs off on the same delays and then stops. Migration
`0018_file_ledger_cleanup_index` adds a partial index, so the queue read walks only enqueued rows.
The app refuses an injected worker that drives another ledger, store or coordinator.

**Stale forms.** An edit form now posts `__aluna_drawn` (`field:key,key`) for each file field: what
it held when the form was drawn, read from the stored row even when the read Handler presents the
field differently. A `file` holding anything else says `record_changed`, whether the form keeps,
replaces or clears it, and a `file[]` keeping a file it was drawn with that it no longer holds says
the same. Neither answer reads the displaced key's ledger row, so both survive the worker deleting
it, and `heldByThisRecord` is gone. A form that posts no marker (one drawn before this change) gets
the same "open it again" sentence instead of a silent 400. After a committed edit, the browser moves
the form's drawn markers to what it saved (`keepSavedFileFields`), so a form left standing saves
again as itself. PLAN decision 16 records the rule, including that a stale list's order and
removals still apply because neither gives up a file.

**Docs.** PLAN decision 16 and the 7.1 epic text, `docs/architecture.md`, `CONTEXT.md` (file ledger)
and superseded-in-part notes on 7.1/04, 7.1/05, 7.1/08 and 7.2/07.

## Findings from adversarial review, all fixed

A standards review and two adversarial reviews (the worker, the drawn-key rule), then an adversarial
verification pass over the fixes, which confirmed each one and found the last four items below.

- Wakes for other keys spent a failing key's retries, so a burst of saves exhausted it at once
  (MEDIUM). Retries are now per key, by due time.
- A pass whose platform write failed retried every second forever without counting (LOW-MEDIUM). It
  now backs off on the delays and stops.
- A pending 30s timer held back a fresh key's 1s retry (LOW). An earlier timer is scheduled.
- Unlinks were not made durable before the row was deleted (LOW). The local store fsyncs both
  directories.
- A hung delete pinned the worker (LOW). Each delete has a deadline.
- The queue read scanned the whole ledger on every save and desk load, inside the request (LOW). A
  partial index, an index-friendly query, and the pass starts after the response.
- An injected worker could drive another coordinator, whose row writes could join a save's
  transaction (LOW). The app refuses it.
- The router's wake was optional, so a registration could forget it (LOW). It is required.
- Failures after boot were silent, `drain()` asked mid-pass answered nothing, `stop()` was dead,
  `Math.min(...)` could overflow, two test claims were unasserted, and the test helpers kept live
  timers and per-request coordinators (INFO). All fixed, with tests for the render not waiting and
  for a failed Handler waking nothing.
- The list's drawn marker was untested in the rendered form (MEDIUM). Rendered-form tests now cover
  both field kinds, a list round trip through the router, and a stale list.
- A second save from the same window, after its own save committed but the refresh failed, was told
  another window changed the entry (LOW). The form now moves its drawn markers after a commit.
- A forged drawn list made the check quadratic (LOW). Sets, duplicate drawn keys refused, and a drawn
  key the edit neither keeps nor removes is malformed.
- The form drew from the Handler's presented record, so a Handler that reshaped a file made it
  unchangeable (LOW). File fields are drawn from the stored row.
- A page drawn before this change got a silent 400 (LOW/INFO). A missing marker answers
  `record_changed`.
- A stale list's order winning was unwritten, `RecordChangedError`'s message and the file-claims
  header were out of date, and the drawn test helper hid missing markers (INFO). Decision 16 says so,
  both are reworded, and the rendered round trips cover what the helper fills in.
- Test apps built a live worker that woke after a test had closed its database and logged into the
  tests after it (MEDIUM). `createTestApp` hands the app an idle worker unless a test names one.
- Desk loads spent the retries of a key still waiting out its delay (LOW). A forced pass takes keys
  that are due or exhausted and leaves the rest alone.
- An exhausted key logged "stopped retrying" on every desk load (LOW). It logs once, as its last
  retry fails.
- Due times used the wall clock (INFO), now `performance.now`. A Handler that answers without saving
  leaves a standing form ahead of its record (INFO): its next save is refused, which gives nothing up,
  and `keepSavedFileFields` says so. The router helper's fresh-form default hid the missing-marker
  path (INFO): it takes `"as-posted"`, and a router test covers that path.
- Standards: stale statements in PLAN, closed issues, the ledger and docs; comment wording and wraps;
  dead `lastError`; a shared cap for cleanup errors; derived test constants; the boot test moved to
  `src/index.boot.test.ts`; test names; ledger unit tests for the queue.

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 4391 tests, 0 failed.

New suites: `src/server/files/cleanup/file-cleanup.test.ts` (19),
`src/server/files/cleanup/file-cleanup.wiring.test.ts`,
`src/presentation/controls/file/file-control.drawn.test.ts`,
`src/runtime/router/dispatch/files/router.file-drawn.test.ts`, and a boot case in
`src/index.boot.test.ts`. The router file suites, the upload concurrency suite, `ledger.test.ts`,
`file-claims.test.ts`, `object-store.test.ts` and `file-control-save.test.ts` gained or changed
cases: a replace, clear, record delete or abandoned upload now ends with its row and bytes gone.

Live on `:3030` (Personal photos): a replace through the real control deleted the old key's file
from `storage/` and its ledger row; a second tab drawn with the replaced photo, saved after another
tab replaced it again and the worker had deleted that row, answered "This entry changed in another
window. Mind opening it again?" and left the other tab's photo in place; deleting a record created
for the probe deleted its photo's file and row; the saved photos still render.
