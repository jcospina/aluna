# Shared modal edit mode and Save→update

Status: ready-for-human

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
- Active `string[]` fields reuse their authored list input mode from create:
  comma-separated fields split/trim/discard empty segments, while repeatable
  fields prefill one exact element per control, including comma-bearing values.
- The collection remains a reading surface: no per-item edit/delete chrome,
  overflow menus, bulk selection, or a second record shell.
- Inactive fields and `extra` never appear in the edit form or the DOM.

## Acceptance criteria

- [x] Item activation opens read-only detail; the edit affordance swaps the
      same modal to a prefilled form; Save appears only in edit mode
- [x] Module-acceptance interaction: open an existing record, patch one field,
      clear one optional field, uncheck a boolean, submit an empty list —
      presence semantics apply, omitted active fields / inactive data / `extra`
      survive, required empties block Save
- [x] The form emits the presence markers and exactly one record target; the
      router strips them (nothing reserved reaches generated code or the DOM)
- [x] Edit prefill and Save round-trip both authored `string[]` input modes
      through the same platform list-input contract used by create
- [x] No per-item edit chrome appears in the collection
- [x] Focused tests cover mode switching and form emission; `bun test`,
      `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: the edit interaction on the reference capability is
      validated on the running app before this issue closes

## Living demo

On the homepage, open a reference-capability record, enter edit mode, save a
partial change, and watch the updated values — the first visible update in the
product.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/05-model-authored-string-array-input-mode.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/05-record-targeted-merge-update-and-delete.md

## Implementation notes

- The platform field renderer now owns one exhaustive edit-form path for every
  active schema field. It prefills scalar and boolean controls, reuses the
  authored comma-separated or repeatable `string[]` mode, and emits one
  presence marker per active field plus exactly one record target.
- The shared detail modal has explicit read and edit surfaces. Edit clones the
  record's pristine server-rendered form, Cancel restores that pristine state,
  and a successful update replaces only the stable collection item, closes the
  modal, and restores focus to the updated item.
- HITL feedback originally moved Edit beside the fixed modal title. Issue 4.3/02's
  responsive UX research superseded that interim placement once read detail gained
  a complete action set: the header now isolates Close, while visibly labelled
  Delete/Edit share the docked read footer. Horizontal overflow is suppressed,
  only the field stack scrolls, and the Cancel/Save bar remains docked at the
  bottom without covering controls. Save feedback and close-on-success live on
  the persistent modal controller, so the first processed click owns the complete
  request lifecycle.
- Structured update validation is retargeted into the edit form's live error
  region. Required empty fields keep the modal open with warm product copy;
  create-form validation behavior remains unchanged.
- The reference capability now exposes an active optional boolean so the full
  clear/uncheck/list-empty interaction is visible. Its update Handler exercises
  the committed merge contract while preserving inactive data and `extra`.
- The design-system guidance now documents the shared read/edit modal,
  platform-owned Save wiring, presence semantics, and both list-input modes.

## Verification

- `bun test` — 486 passing, 0 failing, 2 snapshots
- `bun run typecheck`
- `bun run lint` — 177 files checked, no fixes
- `git diff --check`
- Focused edit-form/modal/wire/demo run — 44 passing, 0 failing
- In-app browser on `http://localhost:3030`: confirmed read-only detail, exact
  edit prefills (including two repeatable rows with comma-bearing **Doe, Jane**
  preserved as one value), no horizontal overflow, the labelled pencil beside
  the title, docked actions throughout field scrolling, scalar/list/boolean
  update, explicit optional scalar and list clearing, focus restoration, Cancel
  reset, and warm required-field validation. Five consecutive pointer-driven
  first-click saves each updated and closed the modal; the exercised HTTP 422
  kept it open, restored Save, and moved the validation error into view.

## HITL test instructions

1. Reuse the app server on port 3030 (or run `bun run dev` if it is not already
   running), then run `bun run demo:five-action-reference`.
2. Open `http://localhost:3030`, choose **Journal entry**, and activate **A quiet
   beginning**. Confirm the modal opens in read mode with **Delete** and **Edit**
   in the docked footer, Close isolated at the top-right, no Save button, and no
   horizontal or flickering scrollbar.
3. Choose **Edit**. Confirm the title, reflection, tags, exact **Doe, Jane**
   and **J. Doe** repeatable rows, and checked **Cherished** value are prefilled.
   The comma in **Doe, Jane** must stay inside one row. Scroll the field stack and
   confirm **Cancel** and **Save** remain visible at the modal bottom without
   covering a field.
4. Change the title, clear the reflection, change the tags, clear both alias
   rows, and uncheck **Cherished**, then click **Save once**. Confirm immediate
   Saving feedback, the modal closes from that first click, focus returns to the
   updated collection item, and the item shows the changed title/tags. Reopen it
   and confirm the reflection and aliases display `—`, **Cherished** displays
   **No**, and the created value is unchanged.
5. Enter edit mode again, set **What happened?** to spaces and **Tags** to
   `, ,`, then choose **Save**. Confirm the modal stays in edit mode and says
   **I still need a little more before I can save this.** Choose **Cancel** and
   confirm the last successful values are restored in read mode.
6. Optionally verify the server-only data survived:

   ```sh
   sqlite3 -json data/omni-crud.db \
     'SELECT retired_note,extra FROM cap_field_lifecycle_demo WHERE id="merge-target";'
   ```

   Confirm `retired_note` is `hidden survives update` and `extra` remains the
   original merge-demo object. If the visible interaction is correct, mark the
   remaining Human sign-off criterion and change this issue to `Status: done`.
