# A discarded upload is let go at once

Status: ready-for-agent

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
racing a save in flight therefore can never leave a saved record without its file. An
owned key never passes through this route. It refuses a cross-site request and enforces
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

- [ ] The pending-only route moves every still-`pending` key it is given to
      `cleanup_enqueued` in one platform write, and the worker removes their bytes
- [ ] A key already `owned`, `cleanup_enqueued` or deleted counts as success and is not
      touched
- [ ] No byte is unlinked before the route's write commits, and a test races a discard
      against a save of the same key and proves the saved record keeps its file
- [ ] The route refuses a cross-site request and enforces its own body limit
- [ ] Replacing an unsaved upload sends the displaced key to the route at once
- [ ] Deleting a record whose form holds an upload discards that upload
- [ ] The client bookkeeping lives in its own module, and neither `app.js` nor
      `desk-window.js` grows past its ceiling
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open Photos' create panel, pick a photo, then pick
another before saving. The first photo's ledger row goes and its bytes leave `storage/`.
Open a record, pick a new photo, and delete the record from the form. The new upload is
gone too.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/01-a-displaced-files-bytes-go.md
