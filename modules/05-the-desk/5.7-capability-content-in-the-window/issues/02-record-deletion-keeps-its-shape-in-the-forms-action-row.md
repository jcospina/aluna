# Record deletion keeps the shape it has today, in the form's action row

Status: ready-for-agent

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

- [ ] The confirmation replaces the form's action row in place, with the same
      copy and the same Cancel-beside-Delete arrangement
- [ ] Cancel restores the action row and leaves the record untouched
- [ ] Confirming deletes the record and returns to the collection
- [ ] The collection carries no per-row delete control
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a record, press Delete record, and confirm the action row is replaced in
place by the confirmation. Cancel and confirm the row comes back. Delete and
confirm the collection returns without the record. Check the collection and
confirm no row offers a delete of its own.

## Blocked by

- modules/05-the-desk/5.7-capability-content-in-the-window/issues/01-a-record-opens-by-view-swap-and-the-modal-is-deleted.md
