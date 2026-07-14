# Field labels, lifecycle, nullable storage, logical requiredness, and the created_at descriptor

Status: ready-for-agent

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

- [ ] Required fields create physically nullable columns; a `null` historical
      value renders as the platform empty value
- [ ] Create with a missing/empty required field fails with the structured
      `missing_required_fields` semantics naming exactly the active required
      fields (inactive and optional fields never appear)
- [ ] The total-by-type requiredness definition is pinned by tests for every
      type (whitespace-only string, finite `0`, both booleans, empty date)
- [ ] An inactive field persists in `schema.fields` and storage but renders
      nowhere (form, detail, item context) and is excluded from requiredness
- [ ] Labels render in platform form and detail chrome; the item renderer
      context carries name/type/label for `shows` entries only
- [ ] `created_at` is accepted in `shows`, supplied to Gate samples, and
      rejected in `schema.fields`/forms/mutations; `id`/`extra`/inactive fields
      are rejected in `shows`
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A hand-written dev spec (exercised through the real registry/router path)
carries labels, an inactive field with stored data, and a required field:
labels visible, inactive field invisible but persisted, required-empty blocked
with a warm error on the homepage surface.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/01-incarnation-keyed-registry-and-artifact-path.md
