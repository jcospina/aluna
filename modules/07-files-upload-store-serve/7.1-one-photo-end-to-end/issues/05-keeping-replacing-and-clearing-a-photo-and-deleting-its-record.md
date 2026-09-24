# Keeping, replacing and clearing a photo, and deleting its record

Status: done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decisions 16, 17, 19, 21 and 31; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

An edit can keep a record's photo, replace it or clear it, and deleting the record gives
up its files. Each displaced key moves to `cleanup_enqueued` inside the transaction that
displaced it. Until 7.3/01 builds the worker, an enqueued key keeps its bytes, which is
enough for the tracer.

**Keeping.** On update, a file field may carry the key this record's field holds now,
which means keep it. A kept key the record no longer holds is refused with a platform
sentence saying the record changed in another window. A record that no longer exists
answers record-not-found before either check runs. An update that leaves the field out
also keeps it, by the merge-patch rule every other field follows.

**Replacing.** An update carrying a new pending reference for the field promotes it as
7.1/04 does. The save works out what it displaced inside its own transaction, from the
stored value and the value it wrote, and moves the displaced row to `cleanup_enqueued`
there. A Handler that updates and then fails rolls everything back, so the old file stays
`owned` and its bytes stay put.

**Clearing.** Only an explicit clear from the platform control empties a file field. This
issue fixes the wire value for that clear. It differs from leaving the field out, and
from a `null` the Handler returns. A `null` the control never asked for is refused before
anything is written, so a slip in generated code never destroys a file. A clear displaces
the old key as a replacement does.

**Update follows the written-value rule.** The Handler passes the projection back or
leaves the field out, and the router-checked submission is what gets written. This is the
same rule 7.1/04 set for create, and the mutation interface checks it on
`mutation.update` too.

**Deleting a record enqueues its files.** One update on the ledger's record column moves
every key the record holds to `cleanup_enqueued`, inside the delete's transaction. Keys in
fields evolution has hidden are included.

A displaced file that was never saved, meaning a pending upload the form replaced, is not
this issue's: it stays `pending` until 7.3/02's pending-only route.

## Acceptance criteria

- [x] An update carrying the record's current key keeps the file, and an update that
      omits the field keeps it too
- [x] A kept key the record no longer holds is refused with the "changed in another
      window" sentence, and a missing record answers record-not-found first
- [x] Replacing promotes the new key and moves the displaced key to `cleanup_enqueued`
      in the same transaction
- [x] A Handler that updates and then fails leaves the old key `owned` and the new key
      `pending`
- [x] The control's explicit clear empties the field and enqueues the old key; a `null`
      from generated code is refused before anything is written
- [x] `mutation.update` returns the projection and enforces the written-value rule
- [x] Deleting a record moves every key it holds to `cleanup_enqueued`, hidden fields
      included, in the delete's transaction
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless, for the same reason as 7.1/04: the router tests prove it against the fixture
capability, and 7.1/08 is the first place a person can replace or clear a photo.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/04-a-record-claims-a-pending-photo-when-it-saves.md

## What landed

**The wire.** An edit posts a file field's presence marker and one value. The key the record
holds keeps it, and `""` says the field holds nothing. A pending key minted for this incarnation
and field replaces it. `FILE_CLEAR_VALUE` (`__aluna_clear`, built from the reserved field prefix
in `src/runtime/data/access/file-claims.ts`) clears it. An empty value never clears, and a create
refuses the clear as a malformed reference. A marked file field with no value reads as `""` on
either save.

**The check.** `resolveSubmittedFiles` resolves each submitted file field to a claim, a keep or a
clear. On an edit it reads the record first, so a record that is gone answers `record_not_found`
before any key is judged. A key this record's field once held, or `""` while it holds a photo,
throws `RecordChangedError`. Its code is `record_changed`, platform-owned, in both builder prompts'
list and in `public/app.js`'s rescue list. It answers 422 with "This entry changed in another
window. Mind opening it again?", retargeted to the edit form's error region with the field named.
Anything else a create would refuse is refused the same way. The router runs this check after
taking the read token, because an edit's check reads the capability's own table, and before any
generated code loads. It runs again in `handler-invocation.ts` after `BEGIN IMMEDIATE`. The update
port checks a third time as it writes.

**The save.** The update port takes the router-checked submission as a `FileSubmissionBinding` and
always writes inside a savepoint. A replace promotes the new key and writes the column from its
ledger row. A clear writes `NULL`. Either one moves the displaced key to `cleanup_enqueued` with
`enqueueDisplacedFile`, which matches the key's capability, incarnation, field and record. A kept
key the record no longer holds is refused before anything is written. The Handler gets the
projection of what the save will store, or `null`. `mutation.update` accepts, for a submitted
file field, only that projection, that `null`, or nothing. Anything else, including a `null` the
control never asked for, is `FileFieldWriteError` before any write. `mutation.update` returns the
projection. A second update in the same Handler keeps what the first wrote. An update started
from inside another counts only once the outermost one commits.

**The delete.** The delete port takes the incarnation and, in one savepoint with the row's delete,
runs `enqueueRecordFiles`: one update on the ledger's record column, filtered to this capability
and incarnation. It moves every key the record owns to `cleanup_enqueued`, hidden fields included.
A port with no binding, as every Gate port is, never touches the ledger.

**The contract.** The input type a Handler receives is `CapabilitySaveInput` on create and update
alike, in the runtime contract and the Gate's mirror. It widens only for a spec with an active
file field. The update prompt says what a file field arrives as, and to hand it back unchanged or
leave it out and never run it through the scalar extractor. The photos fixture's update passes the
photo through.

**Handoffs.** 7.1/06 gains a criterion: the smoke rung's edits submit file fields the way 7.1/08's
form will, because today no Gate run submits one on an edit. 7.1/08 now records the edit wire and
says the control should carry the clear value in its markup. 7.3/01 gains two criteria. A stale
keep must still answer `record_changed` after the worker deletes the displaced row, which today is
the only evidence. A stale replace or clear must not give up a photo another tab saved, unless PLAN
decision 16 is amended to accept that the last save wins. `docs/architecture.md` lists the two file
codes with the platform-owned structural codes.

## Findings from adversarial review, all fixed

A spec-and-conventions review and an adversarial review, then a verification pass over the fixes.
Each fix that changes behaviour has a test that fails with the fix reverted, checked by reverting it.

- The router's first check read the capability's own table before taking a read token. A deletion
  that closed the gate and dropped the table mid-request turned an edit into a 500 (MEDIUM). The
  check now runs under the read token, and the race answers `read_unavailable`.
- A stale keep is recognised only while the displaced ledger row exists, and 7.3/01 deletes it
  (MEDIUM). This issue's behaviour is correct until 7.3/01 lands, so the fix is a criterion there,
  where the row is deleted.
- The Gate never submits a file field on an edit, so an update Handler that mangles the photo would
  pass the Gate and fail every real edit (MEDIUM). The update prompt now says never to run a file
  field through the scalar extractor, and 7.1/06, which builds the Gate's scratch ledger, has a
  criterion to exercise edits.
- `enqueueDisplacedFile` matched only key, record and state, so a corrupted column could have given
  up a key another field of the record still holds. It matches capability, incarnation and field too.
- An update a Handler started from inside another left the port believing it kept a key that the
  outer rollback undid. Keeps now count only when the outermost update commits.
- A stale replace or clear gives up whatever the record holds now. PLAN decision 16 protects only a
  keep, so this is a decision to make, not a bug. It is a criterion on 7.3/01, where the bytes would
  be deleted, and a stated limit in 7.1/08.
- Tests tightened. A clear test that proved half its title is now two tests. Refusal tests assert
  the refusal's class, not just a 500. The empty-value test asserts `record_changed`. A prompt test
  that could not fail now compares a photo capability's update prompt with a plain one.
- A test restating prompt copy and two restating an error message now use the class or a structural
  check. `RECORD_NOT_FOUND_ERROR_CODE` moved into the registry beside the codes it is listed with.
  Four comments that said only "replaced or cleared" now cover a photo another window added. The
  ledger's two enqueue functions have unit tests.
- The user-facing sentence keeps "another window", because this issue's acceptance criterion
  quotes that phrase, though CONTEXT.md calls the cross-tab case a second tab.

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 3324 tests, 0 failed. New
suites:

- `runtime/router/dispatch/router.file-edit.test.ts`
- `runtime/router/dispatch/router.file-written-value.test.ts`
- `runtime/router/dispatch/router.file-delete.test.ts`

`router.file.test-support.ts` now holds the photos router the file suites share. These suites
gained cases: `file-claims.test.ts`, `ledger.test.ts`, `file-contract.test.ts`,
`file-stand-in.test.ts` and `refusal-rescue.test.ts`. The verification pass also ran a randomized
battery: six seeds of 150 creates, edits and deletes through misbehaving Handlers. After every step,
every live photo was `owned` by its record and field. No key a record references was
`cleanup_enqueued`, and no refused or failed request changed the table or the ledger.

The work is headless, as the Living demo says. 7.1/08 is the first place a person can replace or
clear a photo.
