# Wire item click-to-open → prefilled read-only detail modal

Status: done — all acceptance criteria met; human visual sign-off received
(2026-07-09) on `/demo/detail-interaction`. Real built-capability click-to-open
lands with the read→wrapper integration in **epic 3.4** (the item renderer +
presentation adapter): the build pipeline still emits M2 artifacts until 3.4/3.7, so
`reading_log` (four M2 units, `.reading-item` read markup) needs a `bun run reset` +
rebuild under the M3 shape before its items open the modal — this issue delivers the
platform mechanism 3.4 feeds.

> **HITL — human visual sign-off required.** This is the end-to-end detail
> interaction the user performs; a human clicks an item and confirms the
> prefilled read-only modal on the running app before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.3 — Presentation intent + detail
modal (read-only) (`docs/modules.md` §3.3, ARCH §6.3, ADR-0005 §3 & §6,
PLAN decision 7 & flow step 6:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Wire the accessible item wrapper's click-to-open to the shared modal (3.2/04),
prefilled **read-only** from the escaped `data-item` payload and showing the
fields/order in `detail.shows`. This is the detail interaction the user sees.

- Clicking a rendered item opens the shared modal prefilled from that item's
  escaped payload — no round-trip, no read-single route.
- The modal shows the `detail.shows` fields in order via the centralized field
  renderer (3.2/01).
- Keyboard activation and focus management work through the accessible trigger.

## Acceptance criteria

- [x] Clicking any rendered item opens the shared modal prefilled from its escaped
      payload
- [x] The modal shows the `detail.shows` fields in the specified order, read-only
- [x] Full record content shows even when the item visually truncates; no
      read-single route is used
- [x] Keyboard activation + focus management work through the accessible trigger
- [x] Demo: click an item in a built (or hand-written) capability list and the
      read-only modal opens prefilled; human visually confirms before done
      <!-- HITL surface live at /demo/detail-interaction (port 3030). Human visual
           sign-off received 2026-07-09 (click + Tab/Enter open the read-only modal
           honoring detail.shows). Note surfaced during sign-off: a REAL built
           capability (reading_log) does NOT open the modal because it is a pre-M3 (M2)
           artifact whose read.ts emits its own `.reading-item` markup, never routed
           through the platform wrapper — and the build pipeline still emits M2 units.
           Real built-capability click-to-open is epic 3.4 (item renderer + adapter) +
           the 3.7 reset/rebuild cutover; 3.3/02 is the mechanism it feeds. -->

## Delivered

The click-to-open interaction is the seam between the accessible item wrapper (3.2/02)
and the shared read-only modal's mechanics (3.2/04). Three shipped-or-tested links carry
it, so the only unexecuted step is the browser running the glue on a real click — the
human's sign-off:

- **`detail.shows` now drives the detail body.** `src/presentation/field-renderer.ts`
  gained `RenderableCapability.detail?.shows`; `renderDetailFields` renders exactly those
  fields in that order via `detailFieldOrder` (falls back to every field in spec order when
  absent — a demo/test or a pre-reshape row still renders). `renderDetailContent` /
  `renderDetailContentTemplate` (the modal's body seam) inherit it unchanged. Spec
  validation already guarantees `shows ⊆ fields`, so the surface follows the model's
  per-capability intent, not spec order.
- **The item wrapper carries its open target.** `renderItemWrapper` takes an optional
  `ItemDetailRef { templateId, title }` and, when given one, emits `data-detail-template`
  (the record's inert detail `<template>` id) and `data-detail-title` (the capability
  label) alongside the existing escaped `data-item`. Optional so the 3.2/02 frame-only
  stand-in demo is untouched; the real read path (3.4) always passes it. Both hook values
  are escaped.
- **The generic click controller.** `public/item-detail.js` (authored browser glue,
  `@ts-check`, no build step): a delegated document-level click/keydown handler that
  resolves the clicked/activated `.capability-item`, reads the two `data-detail-*` hooks,
  and dispatches the shared `aluna:open-detail` event `{ title, sourceId }`. Keyboard
  activation (Enter + Space, `preventDefault`) matches a native button; the already-shipped
  `public/detail-modal.js` clones the `<template>` and opens via `showModal()` (focus trap +
  restore, Escape, backdrop). No client-side field formatting, no read-single route.
- **Wired into the served shell.** `public/index.html` mounts a placeholder + loads both
  controllers; `src/web/fragments.ts` `injectDetailModal()` replaces the placeholder with
  the one `renderDetailModal()` instance on every rendered shell (cold-start included, so a
  first-built capability can open it without a refresh) — loud on a missing placeholder,
  no drift from the modal module. (The live `read` path emits wrapper items in 3.4; until
  then the shell modal is present but exercised via the demo below.)
- **HITL demo.** `src/presentation/detail-interaction-preview.ts` + route
  `GET /demo/detail-interaction`: a hand-written capability list run through the real
  wrapper + real modal + real controllers, each record paired with its detail `<template>`.
  `detail.shows` is a reordered subset (`[title, rating, note, author]`, dropping
  `finished`) so the modal visibly follows the intent, not the card or spec order; a
  hostile record proves escaping; a long note proves the card truncates while the modal
  shows it whole.
- **Tests.** `field-renderer.test.ts` (`detail.shows` order/subset/fallback/defensive-skip),
  `list-container.test.ts` (wrapper detail hooks + escaping + the server↔client controller
  contract: attr ↔ `dataset` agreement, `.capability-item`, the open event, click + Enter +
  Space), `detail-modal.test.ts` (body honors `detail.shows`), `fragments.test.ts` (modal
  mounts on every shell incl. cold-start; fail-fast on a missing placeholder),
  `app.test.ts` (served shell mounts one modal + both controllers; the demo route).

Verified: `bun run typecheck` clean (server + browser) · `bun run lint` clean · `bun test`
326 pass / 0 fail · on the running server (port 3030): `GET /demo/detail-interaction` = 200
with 3 wrapper items each paired with a detail `<template>`, the detail body in
`detail.shows` order (`Title, Rating, Note, Author`, no `Finished`), hostile values escaped;
`GET /` mounts exactly one shared `<dialog>` + loads both controllers; `item-detail.js`
served as JavaScript dispatching `aluna:open-detail`. The one path a headless check can't run
— a browser executing the glue on a click — is the human sign-off below.

## HITL — how to verify

1. Run the app: `bun run dev` (or use the running server on port 3030).
2. Open `http://localhost:3030/demo/detail-interaction`.
3. Confirm on the running surface:
   - **Click** any item — the shared modal opens on-brand (surface card, ink backdrop),
     prefilled **read-only** with that record.
   - **`detail.shows` honored**: the modal shows **Title, Rating, Note, Author** in that
     order — it drops the card's Finished/Reading status (the `finished` field is not in
     `detail.shows`), and the order differs from the schema. It is the detail intent, not
     the card or spec order.
   - **Full content when truncated**: the first record's note is clamped to two lines in the
     card but shows **in full** in the modal.
   - **Sparse / hostile**: the sparse record shows the “—” placeholder; the hostile record's
     `<script>`/tags/quotes render as **visible text**, never executing — nothing pops.
   - **Keyboard + focus**: **Tab** to an item and press **Enter** or **Space** — it opens.
     While open, Tab cycles **only inside** the modal; on close, focus **returns to the item**.
   - **Close** three ways: the ✕, **Escape**, and a **click on the dimmed backdrop**.
4. Sign off that the click-to-open read-only modal is correct, then check the final
   acceptance box.

## Blocked by

- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/04-shared-read-only-detail-modal.md
- modules/03-opinionated-ui-design-contract/3.3-presentation-intent-and-detail-modal/issues/01-reshape-ui-intent-and-spec-generation.md
