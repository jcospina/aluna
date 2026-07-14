# string[] end-to-end behind one extensible list seam

Status: ready-for-agent

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
  and order. A literal comma is one value, never an implicit split.
- Storage: SQLite JSON encoding/decoding for list columns.
- Presentation: platform form control for entering repeated values (create
  form), detail rendering, and the item-renderer context carry the list type.

## Acceptance criteria

- [ ] Epic tracer: `tags=a&tags=b` submitted through the real create route
      reaches the Handler as the ordered array `["a","b"]`, stores as JSON, and
      renders as the same ordered list in item and detail
- [ ] A value containing a literal comma round-trips as one element
- [ ] Required `string[]`: empty/blank-only submission blocks create with the
      structured required-field error; optional empty list stores `[]`;
      blank placeholders are discarded, order and text preserved
- [ ] Historical `null` list values render as the platform empty value
- [ ] Gate samples exercise a `string[]` field
- [ ] The seam is extensible: adding a future list type is a closed extension
      point, pinned by a test or type-level check
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Create a record with a tags-style `string[]` field on the homepage: the form
accepts repeated values, and the stored list renders in the collection item and
the detail modal in submitted order.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/03-reserved-wire-protocol-and-parsed-handler-input.md
