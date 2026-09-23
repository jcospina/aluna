# A record claims a pending photo when it saves

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decisions 4, 12, 16, 17, 20, 21 and 22; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A create whose file field carries a pending reference claims that file for the new
record. The file ledger lands here as the one place ownership is asserted. The platform
checks the reference before generated code runs, and the key moves from `pending` to
`owned` in the same transaction that writes the record.

**The file ledger.** A platform table, added through the platform migrations and emptied
by `bun run reset` with the other platform tables. It holds one row per admitted key:

- the capability, the incarnation and the field
- the record, empty until a save claims the key
- the state: `pending`, `owned` or `cleanup_enqueued`
- the verified kind, type, size and name
- the text encoding when there is one
- when the row was made
- a cleanup attempt count and the last error

It is indexed by record and by incarnation. Only the platform writes it. A row is deleted
once its bytes are gone, which is 7.3/01's work.

**The save carries a reference, and the router checks it first.**
`assertSubmittedFieldValues` gains the file rule. On create, a file field takes a pending
reference minted for this incarnation and this field, or nothing. A key from another
field or another incarnation, an owned key, an unknown key and a malformed value are all
refused, each with a typed code and a platform sentence, the way an undeclared choice is.
This issue fixes the wire shape a save uses for a file field, and 7.1/07's upload answers
with that shape. The check runs again inside the save's transaction, before the Handler,
so a sweep or another save committing in between cannot slip past it.

**Generated code gets the projection in both directions and cannot change a file.** Every
record generated code receives carries each file as `{ url, name, kind, mime, size }`.
That covers:

- the router's input to the Handler
- what `mutation.create` returns
- the rows `query.records()` returns
- what `projectItemRecord` hands the item renderer

The `url` is `/files/<key>`, the same-origin route 7.1/07 builds. An empty field is
`null`. The Handler passes the same projection back or leaves the field out, and either
way the router-checked submission is what gets written. The mutation interface reads the
key out of the `url` it minted and rebuilds the stored value from the ledger row. A
copied or edited projection therefore still saves the ledger's name and type. Any other
value is refused before anything is written, and the mutation interface checks once more.
Update's rules are 7.1/05's.

**Promotion and the record write share one transaction.** Both stores are SQLite, so the
save marks the key `owned`, fills in the record and writes the column from the ledger row
in one transaction. Nothing the browser posts reaches the column. A Handler that fails
rolls all of it back, and the key stays `pending`.

The router tests carry a hand-authored fixture capability with a photo field, next to the
existing `src/runtime/router/__fixtures__/notes`. Test support mints the pending rows
directly, because the upload route is 7.1/07's.

## Acceptance criteria

- [ ] The ledger table exists with every column listed above, indexed by record and by
      incarnation, and `bun run reset` empties it
- [ ] A create carrying a pending reference for this incarnation and field stores
      `{key, kind, mime, size, name}` built from the ledger, and the row becomes `owned`
      with the record filled in, in one transaction
- [ ] A reference for another field, another incarnation, an owned key, an unknown key
      or a malformed value is refused before generated code runs, with a typed code and a
      platform sentence
- [ ] The check runs again inside the save's transaction, and a test flips the row
      between the two checks and proves the save is refused
- [ ] The router input, `mutation.create`'s return, `query.records()` rows and
      `projectItemRecord` all carry `{ url, name, kind, mime, size }`, and `null` for an
      empty field
- [ ] A Handler that passes the projection back with a changed `name` or `mime` still
      writes the ledger's values; a Handler that omits the field writes the submission
- [ ] Any other value from generated code is refused before anything is written
- [ ] A Handler that fails leaves the key `pending` and no record written
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. No capability on the desk has a file field until 7.1/06, and no picker exists
until 7.1/08, so the save is proven in the router tests against the fixture capability.
7.1/08 makes it visible.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/03-a-capability-can-declare-a-photo-field.md
