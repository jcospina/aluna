# Field labels, lifecycle, nullable storage, logical requiredness, and the created_at descriptor

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.1 — Incarnation-keyed,
evolution-ready field and input contract
(PLAN decisions 2, 3, 7, 8, 9: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006; ADR-0005 platform presentation)

## What to build

The evolution-ready field model, live in the current create/read loop:

- **Label vs name.** Field `name` is stable identity; `label` is changeable
  wording. Platform form/detail chrome renders labels. The item renderer
  receives only the names/types/labels declared by `ui_intent.item.shows`.
- **Lifecycle.** Every field carries `active | inactive`. Inactive fields never
  leave `schema.fields` (soft-hide, non-destructive): they keep identity, type,
  column, and stored values, but are absent from create/detail/search surfaces,
  `item.shows`/`detail.shows`, runtime-generation contexts, requiredness, and
  structured required-field errors.
- **Nullable storage + logical requiredness.** Every user-authored column is
  physically nullable. `required` is a logical invariant validated by the
  platform mutation side on create (update arrives in 4.2) using the one
  total-by-type definition: `null` is missing for every type; a required
  `string` needs at least one non-whitespace character (storage is not
  implicitly trimmed); `date`/`datetime` must be non-empty and type-valid;
  finite `0` is a valid number; both boolean values are valid. Historical rows
  with `null` remain readable and show the platform empty value. Aluna never
  invents or AI-backfills data.
- **`created_at` descriptor.** One immutable platform descriptor — name
  `created_at`, label `Created`, type `datetime`, read-only — allowed as an
  entry in `ui_intent.item.shows` / `detail.shows` and supplied to item
  generation/Gate samples. It is absent from `schema.fields`, forms, mutations,
  and search. `id`, `extra`, and inactive fields are forbidden in `shows`.

## Acceptance criteria

- [x] Required fields create physically nullable columns; a `null` historical
      value renders as the platform empty value
- [x] Create with a missing/empty required field fails with the structured
      `missing_required_fields` semantics naming exactly the active required
      fields (inactive and optional fields never appear)
- [x] The total-by-type requiredness definition is pinned by tests for every
      type (whitespace-only string, finite `0`, both booleans, empty date)
- [x] An inactive field persists in `schema.fields` and storage but renders
      nowhere (form, detail, item context) and is excluded from requiredness
- [x] Labels render in platform form and detail chrome; the item renderer
      context carries name/type/label for `shows` entries only
- [x] `created_at` is accepted in `shows`, supplied to Gate samples, and
      rejected in `schema.fields`/forms/mutations; `id`/`extra`/inactive fields
      are rejected in `shows`
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A hand-written dev spec (exercised through the real registry/router path)
carries labels, an inactive field with stored data, and a required field:
labels visible, inactive field invisible but persisted, required-empty blocked
with a warm error on the homepage surface.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/01-incarnation-keyed-registry-and-artifact-path.md

## Implementation notes

- The strict registry contract now separates stable field `name` from authored
  `label`, requires explicit `active | inactive` lifecycle, and validates item
  and detail `shows` against active fields plus the one immutable, read-only
  `created_at` descriptor. `id`, `extra`, inactive fields, and unknown fields are
  rejected at the spec boundary.
- Capability DDL keeps every user-authored column nullable. The scoped mutation
  tool enforces logical create requiredness in schema order with total rules for
  string, number, boolean, date, and datetime values, while leaving stored string
  bytes untrimmed and historical nulls readable.
- Active-field projection is shared across forms, detail, the data-tool runtime
  row, item-renderer input, generation prompts, Gate smoke samples, and
  behavioral-test generation. Item renderers receive exactly the descriptors and
  record values named by `item.shows`, including `created_at` when requested.
- Structured required-field failures return a warm 422 fragment with stable
  markers. The router retargets it into the form's aria-live error region, and
  authored HTMX glue permits that validation swap without marking the request
  successful, so the form stays open and retains its values.
- `bun run reset` cleared the stale pre-contract runtime row/table before the
  repository-wide suite. The idempotent `bun run demo:field-lifecycle` installer
  now commits a hand-written spec and artifacts through the real registry/router
  path and seeds a historical null plus an inactive stored value.

## Verification

- `bun run reset`
- Focused registry, storage, presentation, Gate, router, app, and living-demo
  tests during implementation
- `bun test` — 382 pass, 0 fail, 2 snapshots
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- Live browser verification on the existing `localhost:3030` server: authored
  labels rendered, `retired_note` stayed absent, whitespace-only create showed
  the warm error without closing the form, valid create prepended its item, and
  the seeded historical row showed `—` plus `Created` in detail.
- Final demo installation wrote
  `capabilities/field_lifecycle_demo/20df7928-6e48-44ed-a396-efb8589857e6/v1/`.

## HITL test instructions

1. Run `bun run demo:field-lifecycle`, then reuse the server on port 3030 (or
   start it with `bun run dev`).
2. Open `http://localhost:3030/` and choose **Field lifecycle**.
3. Open **New Field lifecycle**. Confirm the form says **What happened?** and
   **A small reflection**, with no retired-note field.
4. Enter only spaces in **What happened?** and select **Add**. Confirm the warm
   “I still need a little more” message appears, the form remains open, and no
   record is added.
5. Enter a real value and select **Add**. Confirm the form closes and the item is
   prepended with its created date.
6. Open the seeded `—` item. Confirm detail uses the authored labels, renders `—`
   for the historical required null, includes **Created**, and never exposes the
   inactive stored field.
