# Opening a record swaps the collection for the form under a back control, and the detail modal is deleted

Status: done

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

- [x] Clicking a record swaps the collection for its form under a back control;
      back swaps the collection in again
- [x] No modal opens, and no page-wide inertness is ever applied
- [x] A record opens in edit mode; an absent value is an empty input
- [x] Each swap releases the outgoing content's fetches, search controller and
      read tokens through the region rule
- [x] The modal scripts, state module, renderer, stylesheet and mount are deleted
      from the codebase; `showModal()`, the focus trap, the inert clone and the
      `mutationBusy` gate are gone with them
- [x] Page assembly now has exactly the logo-layer anchor; no dead replacement
      branch or test fixture for the old content/modal anchors survives
- [x] A record is a real `<button>` with no hand-written key handling and no
      dialog ARIA
- [x] The handbook's modal and item-wrapper sections are deleted
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a capability, click a record, and confirm the collection is replaced by the
record's form inside the same window with a back control — no modal, no dimmed
page. Press back and confirm the collection returns. Click a record while a
mutation is in flight and confirm it opens rather than being silently swallowed.

## Blocked by

- modules/05-the-desk/5.6-window-and-developer-panel/issues/04-the-developer-panels-second-window.md

## What landed

**The record's own view.** `src/presentation/record-view.ts` renders a back
control above the record's form; `public/record-view.js` performs the swap. The
form rides the inert `<template>` the adapter already emitted beside each item, so
there is still no read-single route: opening a record is a DOM clone, taken
*before* the collection is released, because the template stands inside the
content that goes.

**Back is a fresh read**, not a restored snapshot — the same
`GET /capability/:id` a logo makes, aimed at the same content region. A committed
Save leaves the same way. The collection therefore comes back unfiltered with an
empty search rail; a search term is DOM-only state that lived in the collection
the swap took away (PLAN decision 6), and every open is a fresh read.

**The bar is shared with the create view.** The design states the form "always
arrives under a back control, reached either from a record or from **New
record**", so `renderCollection` now puts the same bar above the create panel.
The record-title half of the design's bar is *not* rendered: the platform has no
record-title concept, and `ui_intent.item.shows[0]` would be an inference the spec
does not authorize. Flagged for a decision rather than invented.

**The busy gate came back in its honest form.** `mutationBusy` is deleted, but the
one thing it was right about is not: the back control is disabled for exactly as
long as a mutation is in flight, because leaving aborts the request and a save the
server may already have committed must not be cancellable from above the form. A
second press while the collection is on its way is refused, and a refused or
severed read leaves the record standing with a control that still works.

**Deletions.** `public/detail-modal.js`, `detail-modal-state.js`,
`item-detail.js`, `public/css/detail-modal.css`, `src/presentation/detail-modal.ts`
and its three suites, `renderDetailFields`/`renderDetailField`/the em-dash
`EMPTY_VALUE`, the modal mount and its page-assembly anchor, `injectDetailModal`,
and the `role="button"`/`aria-haspopup="dialog"`/Enter-and-Space wrapper.
`detail-modal-refresh.js` moved to `public/records-refresh.js` rather than being
deleted: it is the committed-records refresh, which create and the search chrome
both use, and only its name was ever about the modal. The request-feedback half of
the modal controller moved to `public/record-mutations.js`.

**Adversarial findings, all fixed.** Two hostile reviews (runtime correctness;
spec + design compliance) produced 35 findings. Beyond the busy gate above: focus
restore now yields to a user who has already clicked elsewhere; a frame with
nothing to open renders `<article>` rather than a focusable button that does
nothing; `user-select: text` is restored on the record card; the action row
follows the design (save and cancel on the left, save first) and the record view's
class is `capability-record-view` so it cannot be confused with
`capability-records`; `controls` left the media attribute allow-list, because a
transport control inside a record button is unreachable and invalid; the live
generator prompts stopped telling the model about a shared modal; and the
region-rule criterion is now executed against structural doubles rather than
grepped for.

**Out of this issue by the plan's own sequencing:** record deletion has no UI
between this issue and 5.7/02, which re-homes the confirmation into the form's
action row. `capabilityDeleteErrorId` is kept as the wire contract
`src/router/failure-responses.ts` retargets to; nothing renders its element until
02 lands.

## Verification

- `bun run test` (1742), `bun run typecheck`, `bun run lint` clean.
- Live, on the running dev server: created a record from the create view (now
  under its own back control), opened it by click, confirmed the form arrives in
  edit mode with an absent value as an empty input, pressed back, edited and
  saved, and confirmed focus returns to the record each time.
- The region rule, proved live: a `search` read held open by a stubbed `fetch`,
  then a record clicked. The record opened (no swallow), the collection and its
  search form left the DOM, and the held read reported `aborted: true` — which is
  what frees the server's read token.
- `document.querySelectorAll('dialog').length === 0` and `[inert]` is empty on
  every shell, cold start included. No console errors.

## HITL

1. Start the dev server (`bun run dev`) and open `http://localhost:3030`.
2. Click a capability logo, then **New <capability>** — confirm the form arrives
   under a back control that looks like a link, not a button, and that **Add**
   sits before **Cancel** on the left. Add a record.
3. Click the record. Confirm the collection is *replaced* by the record's form in
   the same window: no modal, no dimmed page, nothing behind it. An absent field
   is an empty input, never an em dash.
4. Press the back control. The collection returns, and focus lands back on the
   record you opened. Press <kbd>Tab</kbd> to a record and <kbd>Enter</kbd> — it
   opens, with no key handling of our own (this one is browser-native and could
   not be driven through the automation harness).
5. Change a field and press **Save**. The record view leaves and the collection
   comes back with the change.
6. Search for something, then click a record while the results are still
   settling. It opens rather than being swallowed.
