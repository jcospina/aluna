# A reload sweeps what no form holds

Status: ready-for-agent

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
`{ refusal: "gone", message }` and the add-it-again sentence. The test "whose row went in but
whose bytes a cleanup took first asks for the file again" in
`src/server/files/upload-route.concurrency.test.ts` stages that race by hand. The sweep itself,
and the race run against it, are this issue's.

## Acceptance criteria

- [ ] Every key `pending` when a desk load arrives moves to `cleanup_enqueued`, and the
      render does not wait for the sweep
- [ ] A sweep queued behind a build does not take an upload whose row was written after
      the load arrived
- [ ] A save naming a swept key is refused before generated code runs, with a sentence
      asking for the file again
- [ ] A sweep and a save racing on one key produce exactly one winner, and the loser
      fails cleanly
- [ ] An upload whose row was swept before its rename answers with the same sentence and
      leaves no bytes behind
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open a Photos record in one tab and pick a new photo
without saving. Load the desk in a second tab. Back in the first tab, press Save. The
field shows the sentence asking for the photo again. The swept upload's row is enqueued,
and its bytes leave `storage/`.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/01-a-displaced-files-bytes-go.md
