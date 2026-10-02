# The fault battery, and the recovery half of the verify script

Status: done

Type: HITL — the recovery half of the verify script is the epic's done-when test, and it
is run live. A human kills the app mid-upload and mid-form and confirms nothing is lost
or left behind.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.3 — Ownership holds
(PLAN decisions 13, 30–33 and the 7.3 epic; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A battery of fault tests proves ownership holds when things go wrong at the worst moment,
and then the verify script's recovery half runs live. Every fault ends by checking one
invariant against the real store:

- every byte in `storage/` has a `pending` or `owned` ledger row, or is waiting in
  `cleanup_enqueued`
- every `owned` row has its bytes
- `storage/.incoming/` is empty once the process is at rest

**The battery.**

- **A post-commit cleanup failure.** An unlink fails after the save commits. The row
  stays enqueued with its error, the committed file is untouched, and a later retry
  finishes the job.
- **Killed mid-stream.** Boot empties `storage/.incoming/`, and no row exists.
- **Killed between the row and the rename.** A `pending` row whose bytes never moved.
  The next desk-load sweep takes it.
- **Killed mid-form.** A `pending` upload no form holds any more. The next desk-load
  sweep takes it.
- **A deletion racing an upload.** Each of 7.3/05's three cases.
- **A cleanup racing a rename.** The staging-first unlink order leaves no bytes behind,
  whichever side wins.
- **A second tab.** 7.3/04's refusal, with no orphan.

The kill cases run the server as a real process that the test kills, not a simulated
exception.

**What 7.3/04 left for this issue.** Only a browser loading the page into a tab sweeps, so
a test's desk load must send what a browser sends for one: `Sec-Fetch-Mode: navigate` and
`Sec-Fetch-Dest: document`, as `pageNavigation()` in
`src/server/files/sweep/desk-load.test-support.ts` does. A plain `fetch` or `curl` sends
neither and sweeps nothing. The demo's desk loads happen in a browser.

## Acceptance criteria

- [x] Each fault in the battery has a test, and each test ends by asserting the ledger
      and store invariant
- [x] The kill cases kill a real server process and restart it
- [x] A post-commit failure leaves the committed file untouched and its displaced key
      retried to completion
- [ ] **Sign-off gate (the owner's to tick):** the human has run the recovery half below and confirmed every
      abandoned, replaced and orphaned byte is gone and every committed byte still renders
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

This is the recovery half of the verify script in `docs/modules.md`. Use the Aluna
running on `:3030` with Photos built.

1. Upload a photo and save. Replace it, then delete another record's photo. Force one
   post-commit failure, for example by making `storage/` read-only for a moment. Confirm
   every saved photo still renders and the displaced bytes are recovered once the fault
   clears.
2. Open a record, pick a photo, and try to leave. The warning asks first.
3. Kill the app mid-upload, restart it, and load the desk: nothing is left in
   `storage/.incoming/`.
4. Kill the app with an upload held in a form, restart it, and load the desk: the sweep
   takes it.
5. Hold an upload in one tab, load the desk in a second, and save in the first. The save
   is refused with a sentence.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/03-leaving-a-form-that-holds-an-upload-asks-first.md
- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/04-a-reload-sweeps-what-no-form-holds.md
- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/05-deleting-a-capability-takes-its-files.md

## What landed

The battery is tests only. Production code changed in one place: the boot's "listening" log
line now comes from a shared constant.

- **The invariant.** `expectStoreAtRest(db, root)` in
  `src/platform/files/store/store-at-rest.test-support.ts` checks three things: every byte under
  the root has a ledger row in any state, every `owned` row has its bytes, and `.incoming/` is
  empty. It also fails on a root that does not exist, so a wrong path cannot pass by default.
- **Kill cases**, in `src/server/files/faults/server-killed.test.ts`. Each test spawns the real
  server (`src/index.ts`) on a scratch database, store and artifacts root, with its providers
  aimed at a closed loopback port. It SIGKILLs the server, boots it again, and loads the desk with
  a browser's navigation headers.
  - *Mid-stream:* the next boot empties staging, and no row exists.
  - *Between the row and the rename:* the window is microseconds, so a real upload completes, the
    server is killed, and the bytes are moved back into staging. That is exactly the disk such a
    kill leaves (the route commits the row before it renames). The `pending` row survives boot,
    and the desk load takes it.
  - *Mid-form:* the placed bytes and their `pending` row survive boot, and the desk load takes
    both.
- **Post-commit failure**, in `router.file-edit.test.ts`. `storage/` is made read-only, so the
  displaced photo's unlink really fails after the edit commits. The row stays `cleanup_enqueued`
  with its attempt and error, and the new photo and its bytes are untouched. Then the worker's own
  scheduled retry, captured by `usePhotosRouter().retry()` and run after its real delay, takes the
  old bytes and row.
- **Second tab**, in `router.file-swept.test.ts`. Both the create refusal and the edit refusal end
  on the invariant. The edit case now places the record's own photo bytes, so the check also
  proves those bytes survive.
- **Cases already covered by earlier tests.** Deletion racing an upload
  (`capability-deletion.test.ts`, three cases) and a cleanup racing a rename
  (`desk-load-sweep.race.test.ts`, both orders) already end on an empty ledger, an empty store and
  empty staging. That is the invariant in its strongest form. A new store test,
  `object-store.test.ts` "leaves no bytes behind when a rename lands between a delete's two
  unlinks", interleaves the rename inside `delete`. It is the only window where the staging-first
  order matters, and swapping the two unlinks fails it.

## Mutation testing (`bun run mutate`)

| Source (range) | Against | Result |
|---|---|---|
| `src/index.ts:39-44` (boot clears staging) | kill cases | removing the call is killed. The one survivor rewords a log line, and copy is not pinned |
| `object-store.ts` `clearStaging` | store suite | 100%, after a new test for a store never written to (a first boot) |
| `desk-load-sweep.ts` | sweep suites + kill cases | 94.6%, then fixed. Only the log wording survives |
| `file-cleanup.ts` `pass` / `record` | worker suite + edit test | 100%, after a new test: an empty pass takes no platform write |
| `file-cleanup.ts:198-235` (retry scheduling) | worker suite + edit test | 79% → 91.7% |

The unlink order is a swap Stryker does not generate. It was checked by hand: swapping the two
`rm` calls fails the interleaving test.

New behaviour tests that came out of the survivors:
- a sweep taken over by a later load logs nothing;
- a sweep that moved nothing wakes no cleanup;
- "stopped retrying" is said on the drain that spends the last retry, not on a later one;
- a key that goes on its last retry says nothing;
- a retry timer for one key leaves an exhausted key alone;
- repeated wakes keep a single retry timer.

Survivors left, none observable:
- `outcomes[at]?.error`: the `?.` is required by `noUncheckedIndexedAccess`, and there is always
  one outcome per key.
- the `due`-map pruning (lines 199 and 235): no pass reads those entries.
- the stale-timer slot (line 220): the worst case is an extra no-op pass, since every pass filters
  by each key's own due time.

## Findings from adversarial review, all fixed

1. MED. The "later retry" ran on a fresh worker's drain, a path production does not take at that
   moment. It now fires the worker's own scheduled retry after its delay.
2. MED. The staging-first unlink order was untested at its only meaningful interleaving. Added the
   interleaving test.
3. LOW. The rewind in the between-row-and-rename case was not explained. Added a comment, and
   recorded it here.
4. LOW. The second-tab create refusal did not end on the invariant. It does now.
5. LOW. The invariant passed silently on a missing root. It asserts the root exists.
6. LOW. `photos.storage()` fell back to the repo's real `storage/`. It now throws outside a test.
7. LOW. The URL could be read from half a log line. `waitForLog` now waits for the whole line.
8. LOW. `kill()` could drop the wrong process from tracking. The index is guarded.
9. LOW. The tests restated the log text. `LISTENING_LOG` in `src/server/serve-options.ts` is now
   shared by `src/index.ts` and every test that spawns the server.
10. LOW. The spawned server could reach real providers. `OMNI_BASE_URL` and `RECRAFT_BASE_URL`
    point at a closed loopback port.
11. INFO. Spawned-process hygiene: it runs on `process.execPath`, and an exit hook SIGKILLs any
    server still tracked.

## Verification

- `bun run test`: 4547 passed, 0 failed (2 shards, about 91s).
- `bun run typecheck` and `bun run lint` are clean.
- The kill cases run against the real process in about 1.3s for all three.

