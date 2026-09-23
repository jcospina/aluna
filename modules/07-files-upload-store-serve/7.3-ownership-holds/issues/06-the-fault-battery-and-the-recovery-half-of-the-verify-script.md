# The fault battery, and the recovery half of the verify script

Status: ready-for-agent

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

## Acceptance criteria

- [ ] Each fault in the battery has a test, and each test ends by asserting the ledger
      and store invariant
- [ ] The kill cases kill a real server process and restart it
- [ ] A post-commit failure leaves the committed file untouched and its displaced key
      retried to completion
- [ ] **Sign-off gate:** the human has run the recovery half below and confirmed every
      abandoned, replaced and orphaned byte is gone and every committed byte still renders
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

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
