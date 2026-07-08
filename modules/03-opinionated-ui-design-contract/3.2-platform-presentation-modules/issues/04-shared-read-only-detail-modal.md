# Shared read-only detail modal

Status: done — all acceptance criteria met, human visual sign-off received (2026-07-08)

> **HITL — human visual sign-off required.** The modal is visible product
> surface; a human confirms it opens on-brand and read-only on a running preview
> before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.2 — Platform presentation modules
(the thick shell) (`docs/modules.md` §3.2 & §3.3, ARCH §6.1, ADR-0005 §1 & §3,
PLAN decisions 3 & 7: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The shared platform modal every capability uses — open/close/prefill/focus
mechanics — rendering **read-only** detail content in Module 3 (M4 adds the Save
button to the same module). Prefilled from the escaped `data-item` payload so the
full record shows even when the item visually truncates; no read-single route is
added (ADR-0005 §3).

- One shared modal instance, a platform invariant (`modal: true` is never
  model-authored state, ADR-0005 §6): open, close, focus trap + restore, prefill
  from a record payload.
- Read-only detail content rendered via the centralized field renderer (3.2/01).
- Field selection/order defers to `detail.shows` once 3.3/01 lands; until then it
  renders spec order. Click-to-open wiring is 3.3/02.

## Acceptance criteria

- [x] One shared modal module with open/close/prefill/focus mechanics and correct
      focus trapping/restore
- [x] Renders read-only detail content from a record payload via the centralized
      field renderer
- [x] No read-single route added; content comes from the escaped payload
- [x] Platform tests pin the modal open/close/focus invariants
- [x] Demo: a dev trigger opens the modal prefilled read-only; human visually
      confirms it is on-brand before done
      <!-- Preview live at /demo/detail-modal (port 3030). Human visual sign-off
           received (on-brand + read-only) 2026-07-08, after a follow-up fix giving
           the modal responsive width (was too narrow — native <dialog> shrank to
           content): 600px desktop / 80vw tablet / ~full-width mobile. -->

## Delivered

- `src/presentation/detail-modal.ts` — the shared modal markup + read-only content:
  - `renderDetailModal()` — the **one shared `<dialog>` instance** (a platform
    invariant, not one-per-capability): `aria-labelledby` heading, a native
    `<form method="dialog">` ✕ close, and an **empty, data-free** body region
    (content is prefilled on open, never baked in). A native modal dialog, so
    `showModal()` supplies the focus trap, focus restore, Escape, and `::backdrop`.
  - `renderDetailContent(cap, record)` — the read-only body, rendered through the
    **centralized field renderer** (3.2/01) so create + detail never drift; spec
    order today (defers to `detail.shows` in 3.3/01; M4 adds Save here).
  - `renderDetailContentTemplate(id, cap, record)` — wraps that body in an inert
    `<template>` the modal clones on open (no `innerHTML`-from-string, **no
    read-single route**, ADR-0005 §3). Shared ids + `OPEN_DETAIL_EVENT` exported.
- `public/detail-modal.js` — the client controller (`@ts-check`, browser-typechecked):
  prefills (title as text, body cloned from the `<template>`) and opens via
  `showModal()`; listens on `aluna:open-detail` (the seam 3.3/02's item click fires);
  adds backdrop-click light-dismiss. The mechanics live in the native `<dialog>` —
  no hand-rolled focus trap.
- `public/css/detail-modal.css` — on-brand modal chrome (surface card, 1px border,
  `--radius-md`, `--shadow-md`, ink `::backdrop`, bounded height + scrolling body with
  a bottom gutter; tokens only). **Explicit responsive width** (a native `<dialog>`
  otherwise shrinks to its content — the "too narrow" sign-off finding): almost full
  `<480px`, 80vw on small tablets, 600px on desktop (breakpoints mirror the shell's
  768px line). Wired into `public/app.css`.
- `src/presentation/detail-modal.test.ts` — 19 tests: the single-dialog instance +
  labelling + native close + empty body, field-renderer delegation + type formatting +
  hostile-value escaping, the `<template>` wrapper + id escaping, CSS parity, and the
  **server ⇄ client controller contract** (shared ids, open event, `showModal()`,
  backdrop close) — the no-DOM analogue of the container's CSS-parity test.
- `src/presentation/detail-modal-preview.ts` + route `GET /demo/detail-modal` — the
  HITL preview: the real shared modal + real controller, opened by **dev triggers**
  (full / sparse / hostile / long records) that fire the same `aluna:open-detail`
  event 3.3/02 will fire from item clicks.
- `docs/design-system.md` — new "Shared read-only detail modal (Module 3 · epic
  3.2/04)" section (native-dialog mechanics, the three close paths, prefill without a
  read-single route).

**Scope boundary (surfaced, not hidden — CLAUDE.md living demo):** this issue ships the
modal + mechanics + a dev-trigger demo. Wiring the shared instance + controller into the
served shell and opening it from a **clicked item's** `data-item` payload is **3.3/02**;
narrowing/ordering the body by `ui_intent.detail.shows` is **3.3/01**. Both hook the
exported seams (`renderDetailContent`, `OPEN_DETAIL_EVENT`) without changing this module.

Verified: `bun run typecheck` clean (server + browser) · `bun run lint` clean · `bun test`
305 pass / 0 fail · `GET /demo/detail-modal` returns HTTP 200 with the live shared
`<dialog>`, 4 record `<template>`s carrying real field-renderer detail, the controller
script, and hostile values escaped to text on the running server.

## HITL — how to verify

1. Run the app: `bun run dev` (or use the running server on port 3030).
2. Open `http://localhost:3030/demo/detail-modal`.
3. Confirm on the running surface:
   - **Open** any of the four buttons — the modal opens on-brand (surface card, ink
     backdrop dimming the page) prefilled read-only with that record's fields.
   - **Full record** shows every pantry type (Yes/No, a `<time>` date/datetime, the “—”
     placeholder on absent values); **sparse** shows the placeholders.
   - **Hostile record**: the `<script>`/tags/quotes render as **visible text**, never
     executing — nothing pops.
   - **Long record**: the body **scrolls** inside the card and keeps a bottom gutter.
   - **Focus**: after opening, Tab cycles **only inside** the modal (focus trapped);
     close and focus **returns to the button** you opened it from.
   - **Close** three ways: the ✕, **Escape**, and a **click on the dimmed backdrop**.
4. Sign off that the modal is on-brand and read-only, then check the final acceptance box.

## Blocked by

- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/01-centralized-field-renderer.md
- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/02-list-scaffolding-container-and-item-wrapper.md
