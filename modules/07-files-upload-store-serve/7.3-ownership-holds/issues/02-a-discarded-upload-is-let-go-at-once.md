# A discarded upload is let go at once

Status: ready-for-agent — built and verified; waiting on the owner's sign-off

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.3 — Ownership holds
(PLAN decisions 10, 19 and 32; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

An upload the form no longer holds, but that no save ever claimed, is handed back at once
instead of waiting for a sweep. This issue builds the pending-only route and the client
module that tracks what a form holds. 7.3/03 builds the leave warning on top of that
module.

**The pending-only route discharges only pending keys.** It takes the keys a form held
and, in one platform write, moves each key still `pending` to `cleanup_enqueued`. The
worker from 7.3/01 then removes the bytes. A key that the sweep, a save or a deletion
already took counts as success. No byte is unlinked before that write commits. A discard
racing a save in flight therefore can never leave a saved record without its file. The
route never moves an owned key. It refuses a cross-site request and enforces
its own body limit, as 7.1/01 requires of every writing route.

**A replacement discards the file it displaced.** A photo picked and then replaced before
the save was never committed, so it goes through this route as soon as it is displaced.
7.1/08 left it `pending`.

**Deleting a record discards its form's upload.** A record whose open form holds an
upload gives it up through this route when the record is deleted, as a confirmed leave
will.

**The bookkeeping lives in a client module of its own.** `app.js` and `desk-window.js`
are at their 500-line code ceilings. The module tracks the keys a form holds and the
requests still in flight, and 7.3/03's leave warning reads it.

## Acceptance criteria

- [x] The pending-only route moves every still-`pending` key it is given to
      `cleanup_enqueued` in one platform write, and the worker removes their bytes
- [x] A key already `owned`, `cleanup_enqueued` or deleted counts as success and is not
      touched
- [x] No byte is unlinked before the route's write commits, and a test races a discard
      against a save of the same key and proves the saved record keeps its file
- [x] The route refuses a cross-site request and enforces its own body limit
- [x] Replacing an unsaved upload sends the displaced key to the route at once
- [x] Deleting a record whose form holds an upload discards that upload
- [x] The client bookkeeping lives in its own module, and neither `app.js` nor
      `desk-window.js` grows past its ceiling
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open Photos' create panel, pick a photo, then pick
another before saving. The first photo's ledger row goes and its bytes leave `storage/`.
Open a record, pick a new photo, and delete the record from the form. The new upload is
gone too.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/01-a-displaced-files-bytes-go.md

## What landed

**The route.** `POST /files/discard` (`FILE_DISCARD_PATH` in `public/core/shell-dom.js`,
`src/server/files/discard/discard-route.ts`) takes `{"keys": [...]}`. It carries
`guardWritingRoute()`, so a cross-site request gets 403 and a body over 1 MiB gets 413 before a
byte is read; anything but a list of platform-shaped keys gets 400. One platform write runs
`enqueuePendingFiles` (`src/platform/files/store/ledger.ts`), which moves each key still
`pending` to `cleanup_enqueued` in one transaction and leaves any other key alone. The route
answers 204 and wakes the 7.3/01 worker only if a key moved, and only after the write commits.
A discard queued behind a build waits like every platform write.

**The bookkeeping.** `public/controls/held-uploads.js` tracks, per file control, the uploads
still travelling to it, the keys the upload route answered with, and the keys the control
showed as held. `public/controls/file-field.js` reports to it from the upload transfer and the
field and list change events. A key the control holds no longer that no save took goes to the
route at once: a replacement, a clear, a list removal, a cancelled create. So does every key a
control held once that control is off the page, which covers a deleted record's form and any
window or record that leaves the desk; a region release on a control still standing waits for
it to actually go. A key the route answered that the control never took goes back once heard.
A committed create or edit makes its keys the record's, and they are forgotten without being
sent. Keys let go of in one task go together, in batches of `DISCARD_BATCH_KEYS`, with
`keepalive`; a network error or a 5xx is retried after 1 s and 5 s, a 4xx is not.
`holdsUpload(scope)` is the question 7.3/03's leave warning asks. Neither `app.js` nor
`desk-window.js` changed.

**A save that never stores its upload.** A Handler can answer ok without writing a file the
save carried, and the form then counts the upload saved. `releaseUnclaimedFiles`
(`src/runtime/data/access/file-claims.ts`), called at the end of the router's save in
`handler-invocation.ts`, gives up every key the save carried that is still `pending`, inside the
save's own transaction; a refused or failed save rolls it back. This path is new to the design
and came out of the adversarial review: ADR-0009's Consequences and PLAN decision 32 now name
it. Its one cost: if that save's answer was lost and the person sends the form again, the
resend is refused with the platform's "add the file again" sentence, as a second tab's is.

**What the route guarantees.** The spec line now reads "The route never moves an owned key".
The client sends only keys it holds unsaved, but a key whose save it never heard back from (a
severed answer, or a save aborted because its window left the desk) still goes, and the route
leaves it alone if that save committed. PLAN decision 32 expects exactly that for a leave during
a save.

**Docs.** PLAN decision 32 and the 7.1 epic text, ADR-0009 Consequences,
`docs/architecture.md`, `CONTEXT.md` (Pending upload), superseded-in-part notes on 7.1/04,
7.1/05, 7.1/08 and 7.2/07, and a note on 7.3/03 saying what this issue left for it.

## Findings from adversarial review, all fixed

Two passes (Opus): a review of the change, then a review of the fixes.

- Race test pinned which request wins `Promise.all` (LOW). The either-order case now asserts
  only the invariant; the deterministic cases cover each branch.
- A key a committed save carried but never stored was forgotten client-side while still
  pending (LOW). Fixed on the server with `releaseUnclaimedFiles`; two older router tests that
  pinned "stays pending" now expect "given up".
- Docs narrowed the leave case to a deleted record, put long asides between subject and verb,
  and still said "Nothing waits on a timer" (LOW). Rewritten.
- The delete test stood in for the page's sweep (LOW). It now starts `startRegionScopes` with a
  MutationObserver double and tells it the view was removed.
- Owned keys can reach the route when a save's outcome is unknown (INFO). The spec line and
  docs now say what is true: the route never moves one.
- A leave during a save can cost that save (INFO). Recorded for 7.3/03, which decides what
  those exits do while a save is out.
- An upload aborted after its row committed leaves a key the client never learns (INFO). The
  desk-load sweep (7.3/04) is its path; nothing on the client can know the key.
- The client ignored the discard's answer and could overrun the keepalive budget (INFO).
  Retries on network errors and 5xx, none on 4xx, a malformed answer counts as a failure, and
  batches of 200 keys.
- `discarded()` existed only for tests (INFO). Removed.
- `within()` copied region-scope's `holds()`, and a second listener repeated
  `onCreateFinished`'s form lookup (INFO). `holds` is exported and reused; `onCreateFinished`
  now hands its callback whether the create was saved.
- A vacuous assertion, singleton state leaking between cases, race test 2 using the route's
  write without saying why, and missing coverage for a list create's claim and the late-answer
  fallback (INFO). All fixed, with new cases.
- ADR-0009 and PLAN 32 did not name the save's give-up (MEDIUM, second pass). Both do now.
- "However it left" claimed a reload or closed tab discards (LOW, second pass). Now "its window
  or record left the desk".
- The list branch of `releaseUnclaimedFiles` had no test (INFO). `router.file-list.test.ts`
  covers it.
- `claimed()` also forgot keys still arriving, which the save never carried (INFO). It forgets
  only held keys now.
- An answer with no status would have been an unhandled rejection (INFO). Treated as a failure
  and retried.

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 4429 tests, 0 failed.

New suites: `src/server/files/discard/discard-route.test.ts`,
`src/server/files/discard/discard-route.race.test.ts`,
`src/presentation/controls/file/held/held-uploads.test.ts`,
`held-uploads.form.test.ts` (the drawn control over the real transfer),
`held-uploads.delete.desk.test.ts` (a record view's delete on a desk), and
`src/runtime/router/dispatch/files/router.file-unclaimed.test.ts`. The writing-route walk in
`src/server/app.writing-route-guards.test.ts` picked up `/files/discard` on its own. Each new
client test was checked to fail with its wiring removed.

Live on `:3030` (Personal photos): picking a photo in the create panel and then another removed
the first one's ledger row and its file in `storage/` while the second stayed `pending`;
Cancel removed the second. A record created for the probe kept its photo `owned`, and nothing
was sent to the route. Opening that record, picking a new photo and deleting the record sent
only the new key to the route, and both files and rows were gone afterwards. No console errors.
