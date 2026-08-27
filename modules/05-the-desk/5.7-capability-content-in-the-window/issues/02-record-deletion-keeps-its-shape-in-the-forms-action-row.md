# Record deletion keeps the shape it has today, in the form's action row

Status: done

## Epic

Module 5 — The Desk · Epic 5.7 — Everything a capability shows lands in the window
(PLAN decision 22: `modules/05-the-desk/PLAN.md`)

## What to build

Record deletion changes container and nothing else. The confirmation replaces the
record's action row **in place** — *"Delete this record? You won't be able to
bring it back"*, with Cancel beside Delete record — exactly as the modal renders
it today. The modal's action row becomes the form's action row inside the window.

Two consequences follow and are the deliverable's real shape:

- **Deleting a record starts by opening it.** There is no shortcut from the
  collection.
- **The list carries no per-row delete.** Nothing in the collection destroys a
  record.

This is a port with a deliberate lack of ambition: the interaction was already
right, and the only thing wrong with it was that it lived in a modal.

## Acceptance criteria

- [x] The confirmation replaces the form's action row in place, with the same
      copy and the same Cancel-beside-Delete arrangement
- [x] Cancel restores the action row and leaves the record untouched
- [x] Confirming deletes the record and returns to the collection
- [x] The collection carries no per-row delete control
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a record, press Delete record, and confirm the action row is replaced in
place by the confirmation. Cancel and confirm the row comes back. Delete and
confirm the collection returns without the record. Check the collection and
confirm no row offers a delete of its own.

## Blocked by

- modules/05-the-desk/5.7-capability-content-in-the-window/issues/01-a-record-opens-by-view-swap-and-the-modal-is-deleted.md

## What landed

**The trigger is in the row, the question stands in its place.** The record form's
action row gains **Delete** — `btn--danger`, pushed to the far side away from Save
and Cancel, the way `design/index.html` "The record form" draws it. Pressing it
hides the row and shows the confirmation in exactly the box the row occupied: the
same rule above it, the same fill, the same padding, measured live at the same
`top` and `bottom` to the pixel. The copy and the Cancel-beside-Delete-record
arrangement are the deleted modal's, unchanged.

**It is the form's sibling, not its child**, because a form cannot nest inside
another form and the confirmation posts a delete of its own. `renderRecordView`
composes the pair, which is why the confirmation lives in
`src/presentation/record-view.ts` and `public/css/record-view.css` rather than
with the form: the class `capability-record-delete` and the file it is rendered
from now say the same thing.

**A committed delete leaves the record the way a committed update does** — the
collection comes back as a fresh read, without the record in it, through
5.7/01's `leaveRecordView`. Focus lands on the collection's New control, which is
the path 01 already wrote for "the record is gone from the collection it came
back to". A refused delete leaves the question standing, because the router
retargets its refusal into the live region the confirmation carries.

**The collection carries no per-row delete**, and nothing needed removing to make
that true: a record is a `<button>` whose only act is to open, and the generated
item vocabulary forbids interactive descendants. The delete markup a collection
does carry rides each record's inert `<template>`, which is not rendered, not
scripted and not clickable until the record is opened.

**Adversarial findings, all fixed.** Two hostile reviews (runtime correctness;
standards and design compliance) produced 16 findings.

- *The form beneath the question was still submittable.* A hidden submit button is
  still a form's default button, so Enter in any field saved the record — and,
  once Delete record was pressed, raced the delete it was answering. The modal
  had closed this by hiding the edit surface outright; the port had not. A
  capture-phase `submit` guard now refuses the update for exactly as long as the
  question stands.
- *A refusal outlived the question it answered.* Cancelling left the message under
  the next asking, describing an attempt never made. Every asking now starts with
  an empty error region.
- *The question did not land where the row was.* `.capability-record-view`'s
  column gap dropped it `--space-3` below the rule. The gap is gone and the bar
  carries its own spacing, so the two are interchangeable to the pixel.
- *Escape did not dismiss it.* The `<dialog>` supplied that for free and the view
  swap could not inherit it. Escape now cancels the question, and is refused
  mid-delete for the same reason Cancel is disabled there.
- *A refusal rendered in body ink.* No `.notice` rule existed in any loaded
  stylesheet, so a structured refusal was indistinguishable from the question it
  answered. `.notice[data-role="error"]` now takes `--signal`, the palette's
  alert colour, which also fixes create and update.
- *The mechanics tests could not fail.* All four were `toContain` greps over the
  controller's source that passed against a mutilated build. The toggle and the
  finished-delete disposition are now pure exported rules
  (`applyDeleteConfirmation`, `deleteOutcomeDisposition`) executed in Bun against
  structural doubles, the way 5.7/01's release rule is; the wiring that remains
  grep-pinned asserts call sites rather than declarations, so deleting a listener
  fails it.
- *The collection test proved less than it claimed.* Its fixture omitted the
  record templates the adapter actually emits. It now builds the collection the
  adapter's way and asserts on what is reachable, with the inertness of the
  template content asserted separately.
- Also: the action row gained the design's own narrow-width `flex-wrap` (three
  controls need more room than two, and only the replacement row had a narrow
  rule); the confirmation validates its own record id rather than relying on the
  form's guard running first; and four duplicated comments, a stale "docking"
  claim, an orphaned test comment and two stale sheet headers were corrected.

Two findings needed no change and are recorded rather than actioned. The
`actions.includes("delete")` guards are unreachable while `capabilityToolsSchema`
requires the full five-Action inventory — they are the fail-closed default this
repo keeps everywhere, and a hypothetical read+delete capability has no record
surface at all because 5.7/01 deleted the read view. And the copy says "record"
rather than the capability's own noun: that is the issue's own instruction
("exactly as the modal renders it today"), carried deliberately.

**Found in HITL: a scrollbar flashed on the first press of Delete.** The cause was
not the confirmation but the ink system. `mountInk` claims an element the moment
it enters the DOM, and `refresh` declines to draw one it cannot measure — which is
every element inside a `hidden` subtree, so the confirmation's two buttons were
mounted undrawn. An `<svg>` with no width, height or viewBox takes the default
replaced size, 300×150, so the instant the confirmation was shown those two layers
reached 41px past the window's content region and flashed its scrollbar for the
frame before the resize watch drew them for real. Once per record view, because a
drawn layer stays drawn.

Fixed in `design/scripts/ink.js`, where the defect is: a layer is created out of
flow at zero size, and `.is-ink` — which is what makes the host's own border
transparent — is claimed on the first successful draw rather than at mount, so an
element never sits with neither a border nor a line. This also fixes the create
view, whose Add and Cancel are mounted the same way behind `x-show`.

## Verification

- `bun run test` (1767), `bun run typecheck`, `bun run lint` clean.
- Live, on the running dev server: opened a record, pressed Delete, measured the
  action row's box before and the confirmation's after — identical `top` and
  `bottom`. Cancelled and confirmed the row and focus both came back. Created a
  throwaway record, deleted it, and watched the collection return without it with
  focus on the New control.
- The refusal path, live: a delete aimed at a missing record answered 404,
  retargeted into the confirmation, which stayed standing and rendered the message
  in `rgb(214, 48, 75)` — `--signal`. Cancelling and re-asking cleared it.
- The submit guard, live: with the question standing, a `submit` on the edit form
  came back `defaultPrevented` and never reached htmx; no `/update` request
  appears in the network log.
- Escape, live: dismissed the question and returned focus to Delete.
- Narrow window (region at 488px, under the 620px breakpoint): the confirmation
  stacks, copy above two full-width controls.
- The ink fix, live: sampled the region's overflow across the first Delete press on
  a fresh record view — 0 at every sample, where it was 41px before. Both
  confirmation buttons end up `is-ink` with drawn paths at their real 36px height,
  and carry their own border until that draw. The create view opens with no
  overflow either.
- No console errors on any path.

## HITL

1. Start the dev server (`bun run dev`) and open `http://localhost:3030`.
2. Open a capability and click a record. The form arrives with **Save** and
   **Cancel** on the left and a red **Delete** alone on the right.
3. Press **Delete**. The action row is replaced *in place* by "Delete this record?
   You won't be able to bring it back." with **Cancel** beside **Delete record** —
   nothing above it moves, and the record is still readable.
4. Press <kbd>Esc</kbd>, or **Cancel**. The action row comes back, focus lands on
   **Delete**, and the record is untouched.
5. With the question standing, click into a field and press <kbd>Enter</kbd>.
   Nothing is saved and nothing navigates — the question is the only thing that
   can be answered.
6. Press **Delete**, then **Delete record**. The collection returns without the
   record, and focus lands on the **New** control.
7. Go back to the collection and confirm no row offers a delete of its own:
   clicking a record opens it, and that is all a row does.
