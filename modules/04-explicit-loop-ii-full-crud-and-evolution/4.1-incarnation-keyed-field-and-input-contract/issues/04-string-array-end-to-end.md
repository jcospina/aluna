# string[] end-to-end behind one extensible list seam

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.1 — Incarnation-keyed,
evolution-ready field and input contract
(PLAN decision 5: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006)

## What to build

M4's only new field type, `string[]`, cut vertically through every layer behind
one extensible list seam (so `number[]`/`boolean[]`/`date[]`/`datetime[]` can
follow when a concrete need exists; `file[]` stays M6):

- Spec: `string[]` is a valid field type; Gate samples include it.
- Request parsing: repeated keys (4.1/03) become the ordered array value.
- Validation: a **required** `string[]` must contain at least one non-empty
  string when created or saved. An **optional** submitted empty list stores
  `[]`; historical rows may remain `null`. Control-level blank placeholders are
  discarded; every stored element is non-blank and retains its submitted text
  and order. In the repeatable control shipped by this issue, a literal comma is
  one value, never an implicit split; follow-up 4.1/05 adds the separately
  authored comma-separated mode.
- Storage: SQLite JSON encoding/decoding for list columns.
- Presentation: platform form control for entering repeated values (create
  form), detail rendering, and the item-renderer context carry the list type.

## Acceptance criteria

- [x] Epic tracer: `tags=a&tags=b` submitted through the real create route
      reaches the Handler as the ordered array `["a","b"]`, stores as JSON, and
      renders as the same ordered list in item and detail
- [x] A value containing a literal comma round-trips as one element
- [x] Required `string[]`: empty/blank-only submission blocks create with the
      structured required-field error; optional empty list stores `[]`;
      blank placeholders are discarded, order and text preserved
- [x] Historical `null` list values render as the platform empty value
- [x] Gate samples exercise a `string[]` field
- [x] The seam is extensible: adding a future list type is a closed extension
      point, pinned by a test or type-level check
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Create a record with a tags-style `string[]` field on the homepage: the form
accepts repeated values, and the stored list renders in the collection item and
the detail modal in submitted order.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/03-reserved-wire-protocol-and-parsed-handler-input.md

## Implementation notes

- `string[]` now belongs to the registry's closed `LIST_FIELD_TYPES` vocabulary.
  The wire protocol uses that vocabulary rather than accepting arbitrary `[]`
  suffixes, while exhaustive field-type switches make a future admitted list type
  fail typecheck until storage, Gate samples, and presentation handle it.
- The capability data tool discards blank control placeholders, preserves every
  nonblank string byte-for-byte and in submitted order, stores lists as JSON TEXT,
  and decodes them back to arrays. Required lists reject empty/blank-only input;
  optional submitted empty lists store `[]`; historical `NULL` remains readable.
- The platform create form renders repeatable text rows with Add another/Remove
  controls. Detail uses an escaped semantic ordered list, and `NULL`/`[]` use the
  platform empty value. Builder prompts, smoke/design samples, behavioral fixtures,
  and generated-unit ambient types carry the list contract.
- The Field lifecycle homepage demo now has required Tags plus optional Other
  names. Its real generated-style Handler, item renderer, detail template, and
  historical-null row exercise the complete route/storage/presentation path.

## Verification

- Focused registry, router, storage, presentation, Gate, and demo tests: 108 pass,
  0 fail.
- `bun test` — 397 pass, 0 fail, 2 snapshots.
- `bun run typecheck`.
- `bun run lint` — 136 files clean.
- `git diff --check`.
- `bun run demo:field-lifecycle` installed
  `capabilities/field_lifecycle_demo/51a707f1-59fd-4a92-8cf6-aa5b3cb1d66d/v1/`.
- Live browser verification on the existing `localhost:3030` server: Add another
  created distinct Tags controls; `first`, `one,two`, `last`, and one blank row
  produced an item and detail list in that exact order with the comma intact;
  optional Other names rendered empty; a later blank-only required Tags submission
  stayed open with the structured warm error and wrote no item.

## HITL test instructions

1. Run `bun run demo:field-lifecycle`, then reuse the server on port 3030 (or
   start it with `bun run dev`).
2. Open `http://localhost:3030/`, choose **Field lifecycle**, and open
   **New Field lifecycle**.
3. Enter an event, add Tags rows containing `first`, `one,two`, `last`, plus one
   blank row; leave **Other names** empty and select **Add**.
4. Confirm the new item shows `first`, `one,two`, `last` in order. Open it and
   confirm Tags is the same ordered list, the comma stayed inside one value, and
   Other names shows `—`.
5. Open the create form again, enter an event, leave Tags blank, and select **Add**.
   Confirm the warm “I still need a little more” message appears, the form stays
   open, and no item is added.
