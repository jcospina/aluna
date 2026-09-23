# Keeping, replacing and clearing a photo, and deleting its record

Status: ready-for-agent

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

- [ ] An update carrying the record's current key keeps the file, and an update that
      omits the field keeps it too
- [ ] A kept key the record no longer holds is refused with the "changed in another
      window" sentence, and a missing record answers record-not-found first
- [ ] Replacing promotes the new key and moves the displaced key to `cleanup_enqueued`
      in the same transaction
- [ ] A Handler that updates and then fails leaves the old key `owned` and the new key
      `pending`
- [ ] The control's explicit clear empties the field and enqueues the old key; a `null`
      from generated code is refused before anything is written
- [ ] `mutation.update` returns the projection and enforces the written-value rule
- [ ] Deleting a record moves every key it holds to `cleanup_enqueued`, hidden fields
      included, in the delete's transaction
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless, for the same reason as 7.1/04: the router tests prove it against the fixture
capability, and 7.1/08 is the first place a person can replace or clear a photo.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/04-a-record-claims-a-pending-photo-when-it-saves.md
