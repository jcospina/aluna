# Shared modal edit mode and Save→update

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.3 — Full CRUD
platform presentation
(PLAN decisions 17 and 6: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0005 platform presentation)

## What to build

Explicit read and edit modes in the one shared modal, exercised on 4.2's
hand-written reference capability so the complete interaction is visible before
model generation exists.

- Item activation keeps opening complete **read-only** detail. A platform edit
  affordance switches the same modal to a prefilled spec-rendered form; only
  edit mode shows Save. Save invokes committed `update`.
- The edit form emits repeated `__aluna_present` values for every rendered
  active field and exactly one nonblank `__aluna_record_id`, giving decision
  6's unambiguous clear-vs-preserve semantics; required empties block Save with
  the structured error in warm product voice.
- The collection remains a reading surface: no per-item edit/delete chrome,
  overflow menus, bulk selection, or a second record shell.
- Inactive fields and `extra` never appear in the edit form or the DOM.

## Acceptance criteria

- [ ] Item activation opens read-only detail; the edit affordance swaps the
      same modal to a prefilled form; Save appears only in edit mode
- [ ] Module-acceptance interaction: open an existing record, patch one field,
      clear one optional field, uncheck a boolean, submit an empty list —
      presence semantics apply, omitted active fields / inactive data / `extra`
      survive, required empties block Save
- [ ] The form emits the presence markers and exactly one record target; the
      router strips them (nothing reserved reaches generated code or the DOM)
- [ ] No per-item edit chrome appears in the collection
- [ ] Focused tests cover mode switching and form emission; `bun test`,
      `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: the edit interaction on the reference capability is
      validated on the running app before this issue closes

## Living demo

On the homepage, open a reference-capability record, enter edit mode, save a
partial change, and watch the updated values — the first visible update in the
product.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/05-record-targeted-merge-update-and-delete.md
