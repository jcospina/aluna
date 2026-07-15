# Model-authored `string[]` form input mode

Status: done

Category: enhancement

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.1 — Incarnation-keyed,
evolution-ready field and input contract
(PLAN decisions 5, 6, and 10:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0004,
ADR-0005, ADR-0006)

## Agent Brief

**Category:** enhancement

**Summary:** Let Aluna author the appropriate form input mode for every active
`string[]` field while preserving one canonical ordered-array Handler contract.

**Current behavior:**

Every active `string[]` field renders the same repeatable-row control with
**Add another** and **Remove** actions. That control is correct for free-form
list elements that may contain commas, but it is unnecessarily heavy for
comma-free atomic values such as tags, genres, categories, or skills.

The completed `string[]` tracer already provides the deep canonical seam:
repeated raw values normalize to an ordered array, blank placeholders are
discarded, required/optional empty semantics are enforced, JSON storage
round-trips the array, and generated Handlers receive `readonly string[]`.

**Desired behavior:**

The authored spec records exactly one closed list-input mode for every active
`string[]` field under form presentation intent:

- `comma_separated` — for short atomic values whose grammar does not use commas,
  such as tags, genres, categories, or skills. The platform renders one text
  control with explicit “separated by commas” guidance. Raw values split on
  commas; surrounding whitespace is trimmed; empty segments are discarded;
  order and duplicates are preserved. A comma is always a separator in this
  mode—there is no quoting or escaping syntax.
- `repeatable` — for free-form values that may contain commas, such as quotes,
  addresses, citations, or names as entered. The existing Add another/Remove
  interaction remains. Each repeated control is one value, retained exactly;
  a comma remains ordinary data.

The Capability Builder chooses the mode from field semantics. Users state the
capability outcome; they never select controls or implementation details. Both
modes normalize before generated code runs, so Handlers, validation, storage,
detail presentation, and generated-unit contracts continue consuming the same
ordered `string[]`.

**Key interfaces:**

- Authored form presentation intent — a strict `list_inputs` collection with
  entries shaped as `{ field, mode }`, in active `string[]` schema-field order.
  Every active `string[]` appears exactly once; scalar, inactive, unknown,
  missing, duplicate, or invented modes fail spec validation.
- Capability Builder spec prompt — explains the semantic promise made by each
  mode, with positive examples (tags/genres/categories) and counterexamples
  (quotes/addresses/citations). It must not choose `comma_separated` when an
  element may meaningfully contain a comma.
- Platform list-input module — owns both the chosen control and normalization
  of its raw form representation. Create uses it now; Module 4.3 edit forms must
  reuse the same module rather than inventing a second interpretation.
- Parsed Handler input — remains `string | readonly string[]` plus the validated
  submitted-field set. The chosen control is not exposed to generated Handlers.

**Acceptance criteria:**

- [x] The strict spec accepts exactly `comma_separated | repeatable` and requires
      one mode entry for every active `string[]` in schema-field order; it rejects
      missing, duplicate, scalar, inactive, unknown-field, and unknown-mode entries
- [x] The Builder prompt teaches the semantic selection rule and pins both good
      and bad examples; a prompt-built tags/genres capability can select
      `comma_separated`, while a quotes capability can select `repeatable`
- [x] `comma_separated` renders one accessible text control with visible or
      programmatically associated comma-separation guidance; `repeatable` keeps
      the existing accessible Add another/Remove behavior
- [x] Comma-mode input such as `Drama, Historical fiction, Classic` reaches the
      Handler as `['Drama', 'Historical fiction', 'Classic']`; surrounding
      whitespace and empty segments are discarded while order and duplicates
      remain
- [x] Repeatable input containing `Doe, Jane` or a quotation with commas reaches
      the Handler as one unchanged element; a comma is never split in this mode
- [x] Required blank/delimiter-only comma input fails through the existing
      structured required-field error; optional empty comma input stores `[]`
- [x] The Field lifecycle homepage demo shows both modes side by side and proves
      create → Handler → JSON storage → item/detail rendering through the real route
- [x] The form-intent projection cannot be dropped between registry, cached View,
      router, Gate, and preview/demo callers; deterministic tests cover every
      platform projection that constructs a renderable capability
- [x] The current DDL, JSON storage shape, generated Handler interface, item
      renderer input, and behavioral meaning of `string[]` remain unchanged
- [x] `bun test`, `bun run typecheck`, `bun run lint`, `git diff --check`, and
      local Markdown-link validation are clean
- [x] **Human sign-off:** both modes are exercised on the running homepage before
      the issue closes

**Out of scope:**

- Quoting or escaping commas inside `comma_separated` values
- User-facing control selection or a form-builder workflow
- Generated form markup or a second generated creative surface
- New list field types (`number[]`, `boolean[]`, date lists, or `file[]`)
- Implementing Module 4.3 edit mode in this issue; that issue must consume this
  platform list-input contract when it lands

## Implementation notes

- The authored spec now carries strict `ui_intent.form.list_inputs` entries in
  active `string[]` schema-field order. The closed mode registry and semantic
  validation reject missing, duplicate, scalar, inactive, unknown, reordered, and
  invented entries.
- `src/list-input/` is the shared platform seam. Rendering and raw request
  normalization resolve the same authored mode; `comma_separated` splits, trims,
  flattens, and drops empty segments, while `repeatable` preserves each occurrence
  exactly. Generated Handlers still receive only the canonical ordered array.
- Renderable capability projections now require form intent at compile time. The
  registry, cached View, router, Gate, previews, and demo all pass it explicitly,
  so a dropped projection fails TypeScript or the list-input module's fail-closed
  lookup rather than silently falling back.
- The Builder prompt teaches positive atomic-value examples and comma-bearing
  counterexamples. The Field lifecycle demo authors Tags as `comma_separated` and
  Other names as `repeatable` through the existing real Handler, JSON storage,
  item renderer, and detail modal.

## Verification

- Focused registry, list-input, wire-protocol, presentation, Builder, Gate,
  storage, and demo tests: 114 pass, 0 fail.
- `bun test` — 404 pass, 0 fail, 2 snapshots.
- `bun run typecheck`.
- `bun run lint`.
- `git diff --check`.
- Local Markdown-link validation.
- `bun run reset` preserved `data/omni-crud.db` and cleared stale pre-contract
  runtime rows; `bun run demo:field-lifecycle` installed
  `capabilities/field_lifecycle_demo/89a80faf-de42-47f1-8e40-e9c6cb6affe3/v1/`.
- Live browser verification on the existing `localhost:3030` server: Tags showed
  one associated comma-guidance control; Other names retained Add another/Remove;
  `fantasy, historical fiction, classic` stored/rendered as three ordered tags;
  `Doe, Jane` rendered as one detail-list element; delimiter-only Tags kept the
  form open with the structured required-field error and added no item.
- Human sign-off confirmed on 2026-07-15 after exercising both modes on the
  running homepage.

## Living demo

Use the existing Field lifecycle capability: **Tags** uses
`comma_separated`; **Other names** uses `repeatable`. Submit Tags as
`fantasy, historical fiction, classic` and one Other names value as
`Doe, Jane`. The stored item/detail must show three tags in order and one
unchanged comma-bearing name.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/04-string-array-end-to-end.md

## HITL test instructions

1. Run `bun run demo:field-lifecycle`, then reuse the server on port 3030 (or
   start it with `bun run dev`).
2. Open `http://localhost:3030/`, choose **Field lifecycle**, and open
   **New Field lifecycle**.
3. Confirm **Tags** is one comma-separated control with clear guidance and
   **Other names** keeps Add another/Remove controls.
4. Enter Tags as `fantasy, historical fiction, classic`; add `Doe, Jane` as one
   Other names value; complete the other required fields and select **Add**.
5. Confirm the item and detail show three ordered tags while `Doe, Jane` remains
   one unchanged list element.
6. Submit a required comma-mode field containing only spaces and commas; confirm
   the warm required-field error appears, the form remains open, and no item is
   written.
