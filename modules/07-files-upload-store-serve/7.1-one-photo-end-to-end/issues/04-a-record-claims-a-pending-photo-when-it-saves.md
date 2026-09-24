# A record claims a pending photo when it saves

Status: done

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

- [x] The ledger table exists with every column listed above, indexed by record and by
      incarnation, and `bun run reset` empties it
- [x] A create carrying a pending reference for this incarnation and field stores
      `{key, kind, mime, size, name}` built from the ledger, and the row becomes `owned`
      with the record filled in, in one transaction
- [x] A reference for another field, another incarnation, an owned key, an unknown key
      or a malformed value is refused before generated code runs, with a typed code and a
      platform sentence
- [x] The check runs again inside the save's transaction, and a test flips the row
      between the two checks and proves the save is refused
- [x] The router input, `mutation.create`'s return, `query.records()` rows and
      `projectItemRecord` all carry `{ url, name, kind, mime, size }`, and `null` for an
      empty field
- [x] A Handler that passes the projection back with a changed `name` or `mime` still
      writes the ledger's values; a Handler that omits the field writes the submission
- [x] Any other value from generated code is refused before anything is written
- [x] A Handler that fails leaves the key `pending` and no record written
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. No capability on the desk has a file field until 7.1/06, and no picker exists
until 7.1/08, so the save is proven in the router tests against the fixture capability.
7.1/08 makes it visible.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/03-a-capability-can-declare-a-photo-field.md

## What landed

**The ledger.** Migration `0016_file_ledger` creates `file_ledger` (`src/platform/files/ledger.ts`
names it, mints keys and reads and promotes rows). It has one row per key with `capability_id`,
`incarnation_id`, `field`, `record_id`, `state`, `kind`, `mime`, `size`, `name`, `encoding`,
`created_at`, `cleanup_attempts` and `cleanup_error`, and an index on `record_id` and another on
`incarnation_id`. CHECKs hold `state` to the three states, tie `record_id` to the state (empty while
`pending`, filled when `owned`), and require a non-empty `mime` and a `size` between 0 and the largest
safe integer. `kind` has no `IN (…)` CHECK, for the reason a choice column has none. `bun run reset`
empties the table with the other platform tables.

**The wire.** A create names a file by the bare key its upload answered with: the field's presence
marker and `photo=<key>`. An empty value, or no marker at all, is nothing. An update still refuses a
file marker; that is 7.1/05's. 7.1/07's upload answers with the key, and 7.1/05's "keep" sends the
key the record holds, so one shape serves both.

**The check, three times.** `resolveSubmittedFiles` (`src/runtime/data/access/file-claims.ts`) is
the file rule `assertSubmittedFieldValues` gained. A key must have the minted shape, a ledger row,
this capability and incarnation, this field, a `kind` the field's `accepts` names, and the state
`pending`. Anything else throws `InvalidFileReferenceError` with every offending field and a reason
for each. The router answers 422 with `invalid_file_reference` and "I can't save that file in this
field. Mind adding it here again?", retargeted to the create form's error region. The code is
platform-owned: a capability may not author it, both builder prompts name it (they now build that
sentence from `PLATFORM_OWNED_ERROR_CODES`), and `public/app.js` rescues it. The router checks once
against the read-only connection before generated code loads, and again in `handler-invocation.ts`
after `BEGIN IMMEDIATE`, holding the write lock. The create port checks a third time as it promotes
the key.

**Promotion and the record write.** The create port mints the record id, promotes the key to `owned`
with that id and inserts the row, all inside `database.transaction`. Inside the router's transaction
that is a savepoint, so a Handler that catches a failed insert and answers anyway cannot commit a key
promoted for a record that was never written. The column is `{key, kind, mime, size, name}` built
from the ledger row; nothing the browser posted reaches it.

**The projection.** Reads turn the stored reference into a frozen `{ url, name, kind, mime, size }`
with `url` `/files/<key>`, and fail closed on any other stored shape. The router hands a create
Handler the same projection (`projectFileLedgerRow`, one path for both) or `null`. `mutation.create`
returns it, `query.records()` rows carry it, and `projectItemRecord` hands it to the item renderer.
A Handler hands back the projection or leaves the field out, and the create port always writes the
router-checked submission: it reads the key out of `url` and ignores an edited `name` or `mime`.
Anything else is `FileFieldWriteError` before any write, including `null` in place of a submitted
file and a second create that would write the same file. An edit of another field leaves a stored
photo alone.

**What generated code is told and checked against.** Only a create's input can carry a file, so the
runtime contract and the Gate's mirror (`handlerContractDeclarations(spec)`) split
`CapabilityCreateInput` from the input every other Action keeps. The create input and the record
values widen only for a spec with an active file field, so a capability without one keeps the
contract it had and its Handlers still compile. The mirror declares `CapabilityFileProjection`
either way. The Diff Engine regenerates read, delete and search when a capability gains or loses its
last active file field: they hold `query`, their records change type, and a copied unit would not
compile. The Handler prompt teaches `scalarValue(value: unknown)`, says what a file field arrives as
on create, and no longer claims every field is in `submittedFields` there. The repair advice fires
on the create input's own type name too.

**The write window.** `writeWindow` in `handler-invocation.ts` guards each writing port: a write is
refused once the Handler's answer has settled, which `Bun.peek` reads synchronously. A write the
Handler queued behind its answer is therefore refused, even when it runs before the route has seen
that answer. A Handler that answers with a promise holds the window open until that promise is
adopted, a few turns later. Nothing outside the Handler can see its `return` before that, and a test
pins both sides of the edge.

**The fixture.** `src/runtime/router/__fixtures__/photos/v1/` is a hand-written capability with a
photo field, and its card draws the photo through the projection's `url`. Test support mints ledger
rows directly (`src/platform/files/ledger.test-support.ts`), since the upload route is 7.1/07's.

**Handoffs.** 7.1/06's note now says where the create path landed and that the Gate's scratch pair
has no `file_ledger` yet. Aluna's questions can read a stored key through raw SQL until 7.1/09, whose
acceptance criteria already cover it.

## Findings from adversarial review, all fixed

A spec-and-conventions review and an adversarial review, then two verification passes over the fixes.
Each fix that changes behaviour has a test that fails with the fix reverted, checked by reverting it.

- The Gate compiles generated code against its own copy of the contract, and that copy did not know
  the projection (HIGH). It declares the projection now, and a test ties its keys to the ones the
  runtime builds.
- The Handler prompt still taught `scalarValue(value: string | readonly string[] | undefined)` and
  called `input.values` strings only. Under the wider contract that extractor stopped compiling, so
  the fix loop would have sent the model the same broken shape again (HIGH). The prompt teaches
  `value: unknown`, and a test compiles whichever extractor the prompt teaches.
- Widening the contract for every Action of a capability with a photo broke units an evolution
  copies. A search written with the old extractor failed the Gate once a photo was added, and a hide
  left `CapabilityFileProjection` undeclared (MEDIUM). Now only a create's input widens, the
  projection is always declared, and the Diff Engine regenerates read, delete and search when the
  capability gains or loses its last file field.
- The repair advice keyed on `CapabilityInputValue | undefined` and stayed silent for a photo
  capability's create. It matches the create input's name too.
- A ledger row whose `kind` or `mime` the projection refuses passed both checks and failed the save
  with a 500. The save now refuses a `kind` the field does not accept, and the ledger CHECKs a
  non-empty `mime` and a safe `size`, so every claimed row projects.
- A Handler that created twice got the person-facing "add it again" refusal for its own bug. One
  submission's file now belongs to one record, and a second create that would write it is a
  `FileFieldWriteError`.
- A field named `constructor` read `Object` from the prototype. The create port failed with a 500,
  and a missing text or choice field named that way was refused as invalid. Submissions are now read
  by own property at the router's checks, in `normalizeSpecFieldValues` and at the create port, and
  the wire fills an empty list by own property. The create port also snapshots a Handler's values
  once, so a getter cannot pass the length check with one value and store another.
- A write a Handler queued behind its answer committed without the answer showing it. Each write now
  asks whether the answer has settled. Two things were raised on the way, and both are fixed. The
  first version closed only after the route resumed, which a Handler that awaited could still outrun.
  The comment also overstated the reach for a Handler that answers with a promise, where adoption
  takes a few turns. It now states that edge, and a test pins both sides of it.
- A refused late write throws in the Handler's own detached code and is logged, and the server keeps
  serving. The probe confirmed this. It is the refusal reaching the Handler the way every port
  refusal does.
- A plain function answering with a hand-made thenable has its writes refused. The structural rung
  requires `export default async function`, so a Handler's answer is always a native promise.
- Guarded port methods lost their `name` and `length`. Both are restored.
- The refusal sentence overstated "again" for another field's key. It now reads "I can't save that
  file in this field. Mind adding it here again?", which is true for every reason, and its test
  checks the voice (the file, and no internal word) instead of restating the copy.
- Aluna's questions can see stored keys through raw SQL. 7.1/09's acceptance criteria already scrub
  them, so the work stays there.

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 3273 tests, 0 failed. New
suites:

- `platform/files/ledger.test.ts`
- `runtime/data/access/file-claims.test.ts`
- `runtime/data/access/own-values.test.ts`
- `runtime/router/dispatch/router.file-claim.test.ts`
- `builder/units/generation/file-contract.test.ts`

These suites gained cases: `file-stand-in.test.ts`, `wire-protocol.test.ts`,
`file-evolution.test.ts`, `refusal-rescue.test.ts`, `migrations.test.ts`, `reset-runtime.test.ts`,
`spec-gen.choice.test.ts`, `spec-gen.form-intent.test.ts` and `units.test.ts`.

The save is headless, as the Living demo says, and is proven in the router tests against the photos
fixture. The dev database had applied an earlier draft of `0016` while this was built. Its
`file_ledger` was empty and was recreated from the final migration.
