# Opening a record swaps the collection for the form under a back control, and the detail modal is deleted

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.7 — Everything a capability shows lands in the window
(PLAN decision 1 (the modal's deletion), 29 (a record opens in edit mode);
design D2: `modules/05-the-desk/PLAN.md`)

## What to build

A record now opens through an ordinary view swap inside the window. Nothing opens
over anything else.

- Clicking a record swaps the collection for that record's form, under a back
  control. Pressing back swaps the collection in again.
- **A record opens in edit mode, in the form.** Nothing renders a record
  read-only, so no field ever reaches that state. An absent value is an empty
  input rather than a muted em dash.
- **The swap runs through 5.3/01's region rule**, so the collection's fetches,
  search controller and read tokens are released when the record replaces it, and
  the record's are released on the way back. A window-scoped hook would leak on
  every swap, which is exactly why cleanup belongs to the content.

**Deletions, not ports.** The shared read-only detail modal and everything behind
it goes:

- the browser-side modal script, its refresh companion and its state module,
- the server-side modal renderer,
- `showModal()`, the focus trap, the inert template clone, the page-wide
  inertness,
- the `mutationBusy` gate that silently swallowed a record click,
- the modal's stylesheet and the modal mount in page assembly.

This is also where page assembly reaches its final one-anchor shape. 5.6/01 kept
the modal anchor deliberately so record opening stayed functional until this
replacement existed; after these deletions the logo layer is the only full-page
assembly anchor, and its missing-anchor case remains loud.

The accessible item wrapper goes with them: the design's record is a real
`<button>`, so it needs no `role="button"`, no `aria-haspopup="dialog"` and no
hand-written Enter and Space handling. The handbook sections describing these
components are deletions rather than rewrites.

## Acceptance criteria

- [ ] Clicking a record swaps the collection for its form under a back control;
      back swaps the collection in again
- [ ] No modal opens, and no page-wide inertness is ever applied
- [ ] A record opens in edit mode; an absent value is an empty input
- [ ] Each swap releases the outgoing content's fetches, search controller and
      read tokens through the region rule
- [ ] The modal scripts, state module, renderer, stylesheet and mount are deleted
      from the codebase; `showModal()`, the focus trap, the inert clone and the
      `mutationBusy` gate are gone with them
- [ ] Page assembly now has exactly the logo-layer anchor; no dead replacement
      branch or test fixture for the old content/modal anchors survives
- [ ] A record is a real `<button>` with no hand-written key handling and no
      dialog ARIA
- [ ] The handbook's modal and item-wrapper sections are deleted
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a capability, click a record, and confirm the collection is replaced by the
record's form inside the same window with a back control — no modal, no dimmed
page. Press back and confirm the collection returns. Click a record while a
mutation is in flight and confirm it opens rather than being silently swallowed.

## Blocked by

- modules/05-the-desk/5.6-window-and-developer-panel/issues/04-the-developer-panels-second-window.md
