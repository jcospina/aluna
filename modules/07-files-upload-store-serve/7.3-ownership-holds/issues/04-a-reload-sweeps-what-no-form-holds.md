# A reload sweeps what no form holds

Status: ready-for-agent — built and verified; waiting on the owner's sign-off

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.3 — Ownership holds
(PLAN decisions 13, 16 and 32; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A reload destroys any open form, so every upload still `pending` when the desk loads is
an orphan. The desk-load sweep takes them, with no timer, TTL or cron. The sweep covers
what the leave question can't: a reload, a killed tab, a dead battery, a restarted
server.

**The sweep rides the existing desk-load recovery.** The recovery that retries logos
(`createDeskLoadRecovery`) also takes every `pending` key standing when the desk loads
and moves it to `cleanup_enqueued` for 7.3/01's worker. It is queued on the coordinator
when the load request arrives, and the render doesn't wait for it.

**The queue's order is the cutoff.** A sweep waiting behind a build never takes an
upload recorded after the load, because that upload's ledger write queues behind the
sweep. The sweep and a save both go through the coordinator, so exactly one of them wins
each key.

**A second tab's save is refused with a sentence.** Loading the desk in a second tab
sweeps the upload an open form holds in the first. That form's save then names a key
that is no longer `pending`. The router refuses it before generated code runs, with a
platform sentence asking the person to add the file again.

**An upload the sweep overtook answers with the same sentence.** The sweep can take a
row whose upload hasn't answered yet. The cleanup unlinks `storage/.incoming/<key>`
first, so the rename then finds its source gone, and the upload answers with the
second tab's sentence instead of a reference.

**What 7.1/07 landed for this issue.** The upload's half of the race is built:
`StagedObject.place()` answers `false` when the staged bytes are gone, and the upload route then
moves its own row to `cleanup_enqueued` (a no-op once the sweep has taken it) and answers 409 with
`{ refusal: "gone", message }` and the add-it-again sentence (this issue made it 404 when the
field or capability has gone since). The test "whose row went in but
whose bytes a cleanup took first asks for the file again" in
`src/server/files/upload/upload-route.concurrency.test.ts` stages that race by hand. The sweep itself,
and the race run against it, are this issue's.

**What 7.3/03 left for this issue.** A leave while a save is out neither asks nor sends the
keys that save carries to the pending-only route, so a discard can never reach the coordinator
before the save. When the leave cuts the save off before its answer, the page never learns the
outcome. A key that save did not commit stays `pending`, and this sweep is the only thing that
takes it.

## Acceptance criteria

- [x] Every key `pending` when a desk load arrives moves to `cleanup_enqueued`, and the
      render does not wait for the sweep
- [x] A sweep queued behind a build does not take an upload whose row write queued after
      the load arrived
- [x] A save naming a swept key is refused before generated code runs, with a sentence
      asking for the file again
- [x] A sweep and a save racing on one key produce exactly one winner, and the loser
      fails cleanly
- [x] An upload whose row was swept before its rename answers with the same sentence and
      leaves no bytes behind
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open a Photos record in one tab and pick a new photo
without saving. Load the desk in a second tab. Back in the first tab, press Save. The
field shows the sentence asking for the photo again. The swept upload's row is enqueued,
and its bytes leave `storage/`.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/01-a-displaced-files-bytes-go.md

## What landed

**The sweep.** `createDeskLoadSweep` (`src/server/files/sweep/desk-load-sweep.ts`) runs one
platform write, `enqueueAllPendingFiles` (`src/platform/files/store/ledger.ts`), which moves
every `pending` row to `cleanup_enqueued`, and wakes the 7.3/01 worker once that write commits
if a key moved. `createDeskLoadRecovery` in `src/server/app.ts` starts it first, before the logo
pass and the forced cleanup retry, and does not await it. A sweep calls `withPlatformWrite`
before its first await, so it holds its place in the coordinator's queue from the moment the
load arrives, and that place is the cutoff. A failure is logged, and the desk still draws.

**Which loads sweep.** A browser loading `/` or `/capability/:id` (either spelling) into a tab
sweeps: a GET whose Fetch Metadata says `navigate` and `document`, with no `Sec-Purpose`
(`isPageNavigation`). An htmx swap, an image a card's markup points at `/capability/…`, an
iframe or object, a HEAD, and a request from outside a browser are not desk loads and sweep
nothing. Missing a sweep only leaves an orphan for the next load, while a wrong one takes an
upload an open form holds. The logo pass and the cleanup retry keep their old triggers.

**Speculative loads are declined.** A browser's prefetch or prerender of `/` or
`/capability/:id` (any `Sec-Purpose`) answers 503 with no body and `no-store`. A prerendered
desk would otherwise open with no request reaching the server, and so with no sweep; declined,
the browser drops the speculation and the real load arrives. The desk gives up browser
preloading, which it never relied on. This holds for browsers that mark speculation with
`Sec-Purpose` (Chrome, Edge, Firefox). A preload a browser does not mark, as Safari's
address-bar Top Hit may not, looks like a load and sweeps; that case is HITL-only.

**What a sweep takes.** Its place in the queue is the cutoff. A load that finds no committed
`pending` row on the read-only connection queues nothing, so a desk load during a build takes
no place in the queue. A later load takes over a sweep that is still last in the queue, and its
own sweep takes everything that one would have, so repeated reloads queue one sweep. A sweep
with anything queued behind it, a build or an upload's write, keeps its place.

**The pending index.** Migration `0019_file_ledger_pending_index` adds a partial index on
`pending` rows, so the sweep and its pre-check walk only those rows while holding the write.
The ledger test asserts the query plan uses it, as it does for 7.3/01's cleanup index.

**An upload the sweep overtook.** 7.1/07 covered the case where the cleanup unlinks the staged
bytes first and the rename finds its source gone. The other order was open: if the rename lands
before the cleanup runs, the upload used to answer 201 with a key already swept. The route now
re-reads its row after a successful rename. A row no longer `pending` answers 409 `gone` with
the add-it-again sentence. The cleanup's second unlink, of `storage/<key>`, removes the placed
bytes. In either order, an upload whose field or capability has gone since answers 404 rather
than asking for the file again, as a fresh upload to that address would; 7.1/07's `!placed`
branch now does the same.

**The save.** The refusal was already built: `claimRefusal` in
`src/runtime/data/access/file-claims.ts` refuses a non-pending key before the Handler and again
inside the save's transaction, and `invalidFileReferenceFailure` answers with
`ADD_FILE_AGAIN_SENTENCE`. This issue runs it against the real sweep.

**Docs.** PLAN decisions 13 and 32, ADR-0009 Consequences, `docs/architecture.md` §7 (and the
run-on line after "No pending upload expires on a timer."), and `CONTEXT.md` (Desk-load sweep).

## Findings from adversarial review, all fixed

Three passes (Opus): a review of the change, a review of the fixes, and a focused review of
the speculation decline. A spec and standards review (Sonnet) ran beside the first.

- Any non-htmx GET of `/` or `/capability/*` swept, so an image a card's markup points under
  `/capability/` could take an upload the same tab's open form held (MEDIUM). Only a GET
  navigation of a document, with no `Sec-Purpose`, sweeps now (`isPageNavigation`).
- `HEAD /` swept while `HEAD /capability/:id` did not (LOW). Covered by the GET rule.
- A later load taking over a waiting sweep pushed it behind a build queued after it (LOW). A
  sweep is taken over only while it is still last in the queue.
- An upload test now woke the cleanup worker into a closed database, and an older one did the
  same (LOW). The new path no longer sweeps there, and the older test awaits the worker.
- Gaps: migrations 0018 and 0019 untested, queueing at arrival untested, the trailing-slash
  address untested, the failure test read only the first log line (INFO). Each has a test now,
  and each new test was checked against a mutant.
- The post-rename refusal would ask for the file again for a capability deleted meanwhile
  (INFO). `gone()` answers 404 when the field or capability has gone, on both branches.
- A 7.3/06 kill test sending a plain GET would sweep nothing (LOW-MEDIUM, second pass). Issue
  06 now says what a test's desk load must send.
- A prerendered desk would open with no request, and so no sweep (LOW, second pass). A
  speculative GET of a desk address answers 503 with `no-store`, and the real load arrives.
- PLAN 32 named only a build behind a waiting sweep and read the wrong sweep as the subject;
  the new 404 was undocumented; issue wording said the logo pass ran for every request and
  that an uncommitted row was "never standing"; CONTEXT said "a probe" (LOW/INFO, second
  pass). All rewritten; acceptance criterion 2 now says "row write queued after".
- Neither Fetch Metadata check was pinned alone, and the `!placed` 404 had no test (LOW, second
  pass). Iframe, object and fetch rows, and the 404 test over both orders.
- A dead line and an imprecise comment in the sweep (INFO, second pass). Removed and reworded.
- `/` declined a HEAD carrying `Sec-Purpose` while capability pages did not (LOW, third pass).
  Both decline only a GET, pinned by a test, with the trailing-slash spelling.
- Safari's address-bar preload may send nothing that marks it as speculative (LOW, third pass).
  The server cannot tell; PLAN 32 and this issue state the limit, and it is a HITL check.
- A link preview of the desk shows nothing, and a `Retry-After` would suppress later
  speculation (INFO, third pass). The decline's comment names the preview; no `Retry-After`
  is sent.
- Spec review: a test pinned log copy, comments said "lease" for a platform write and read
  densely, `enqueueEveryPendingFile` read oddly, `hasPendingFile` had no plan assertion. Fixed:
  the test matches the error it throws, comments rewritten, `enqueueAllPendingFiles`,
  `ANY_PENDING_FILE_SQL` asserted on the pending index.

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 4520 tests, 0 failed.

New suites: `src/server/files/sweep/desk-load-sweep.test.ts`,
`src/server/files/sweep/desk-load-sweep.race.test.ts`,
`src/runtime/router/dispatch/files/router.file-swept.test.ts`, with new cases in
`ledger.test.ts` and `migrations.test.ts`. The rename-first race, the arrival-time queueing,
the takeover rule, both Fetch Metadata checks, the decline and both 404 branches each fail
against a mutant.

Live on `:3030` (Personal photos): migration 0019 built `file_ledger_pending` on the real
ledger. An edit form held a new photo (`pending`, bytes in `storage/`). Two image loads under
`/capability/` and a `fetch("/")` from that tab left it `pending`. Loading the desk in a second
tab took it: the row and its bytes were gone within two seconds, and `.incoming/` was empty.
Save in the first tab answered 422 and the field showed "I can’t save that file in this field.
Mind adding it here again?". The record kept its photo, and the ledger held only owned rows. A
GET with `Sec-Purpose: prefetch;prerender` answered 503 with `no-store` and the CSP.

