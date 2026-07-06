# List scaffolding container (feed | grid) + accessible item wrapper

Status: done — all acceptance criteria met, human visual sign-off received (2026-07-06)

> **HITL — human visual sign-off required.** The list layout and item chrome are
> the visible product surface; a human confirms feed/grid layout and the wrapped
> item read on a running `/demo` surface before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.2 — Platform presentation modules
(the thick shell) (`docs/modules.md` §3.2, ARCH §6.1, ADR-0005 §1 & §6,
PLAN decisions 1 & 5: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The platform list scaffolding and the accessible **item wrapper** — the container
an item renderer's output lands in, and the standardized trigger each rendered
record is wrapped in. Structural chrome, platform-owned, presentational only.

- **Container**: renders the list scaffolding with its closed `feed | grid` layout
  modes (mapped from `ui_intent.collection.layout` to a token-consuming layout
  class), the empty state, and the "New X" button (opening the create form from
  3.2/01). `table`/`masonry` are out of scope (deferred, ADR-0005 §6).
- **Accessible item wrapper**: wraps one record's generated inner markup in the
  standardized accessible trigger, embeds the full record as an **escaped
  `data-item` payload** (`file` fields as references, never bytes), and carries
  the click-to-open affordance. Escaping/payload/accessibility are platform
  invariants (deterministic tests, ADR-0005 §4), not model concerns.
- Demonstrated with a **hand-written** item renderer (no AI yet): its output
  round-trips through the wrapper into the container in both `feed` and `grid`.

Before 3.3/01 lands, default the layout to `feed` (PLAN decision 5).

## Acceptance criteria

- [x] The container renders `feed` and `grid` from `collection.layout` via a
      token-consuming layout class; an unknown layout is unrepresentable
      (closed enum)
- [x] Empty state and a "New X" button (opening the create form) render
- [x] The item wrapper emits the standardized accessible trigger with an escaped
      `data-item` payload (file fields as references) and a click-to-open
      affordance
- [x] Platform tests pin the wrapper's escaping/payload/accessibility invariants
- [x] Demo: a hand-written item renderer round-trips through the wrapper into the
      container in both feed and grid on a `/demo` surface; human visually confirms
      layout + item chrome before done
      <!-- Preview live at /demo/list-container: the same hand-written items round-trip
           through the wrapper into both feed and grid, plus the empty state. Human
           visual sign-off received (on-brand) 2026-07-06. -->

## Delivered

- `src/presentation/list-container.ts` — the platform list scaffolding + accessible
  item wrapper:
  - `renderCollection` — the "New X" disclosure (an Alpine toggle opening the live
    create form from 3.2/01, closing on this capability's `RECORD_CREATED_EVENT`), the
    records region (`id="<id>-records"`, the create form's target, carrying the layout
    class), and the empty state. Data-free: records arrive through `read` (3.2/03),
    never baked into the chrome.
  - `collectionLayoutClass` — the closed `feed | grid` → token-consuming class map
    through a **total switch** (`assertNever` fails the build on an unknown layout —
    unrepresentable, symmetric with an unknown field type). Defaults to `feed` until
    3.3/01 (PLAN decision 5).
  - `renderItemWrapper` — the standardized `role="button"` trigger with
    `aria-haspopup="dialog"` and the full record as an **escaped `data-item` payload**;
    `serializeItemPayload` neutralizes raw bytes to `null` (`file` fields are
    references, never bytes — ADR-0005 §3). Frames already-safe inner markup; the
    enforcer runs on inner markup via the 3.4/01 adapter, not on the wrapper.
- `public/css/collection.css` — the feed/grid layouts, the `:empty`-driven empty state,
  and the item-wrapper card chrome (surface/border/radius + the shared gentle press +
  accent focus ring; tokens only). Wired into `public/app.css`; `.capability-item` added
  to the a11y reduced-motion reset.
- `src/presentation/list-container.test.ts` — 22 tests: the closed layout map +
  fail-closed guard + CSS parity, the container (New X, empty state, region id, seeded
  vs data-free, label escaping, scoped close-on-created), and the wrapper's
  accessibility + payload escaping/round-trip/byte-guard invariants.
- `src/presentation/list-container-preview.ts` + route `GET /demo/list-container` — the
  HITL preview: a **hand-written** item renderer → runtime enforcer → wrapper →
  container in **feed and grid**, plus the empty state and a click-to-open payload
  stand-in for the 3.2/04 modal.
- `docs/design-system.md` — new "Collection layout + item wrapper (Module 3 · epic
  3.2/02)" section (the closed-layout table, the data-free container, the wrapper's
  payload/enforcement boundary).

Verified: `bun run typecheck` clean · `bun run lint` clean · `bun test` 281 pass / 0
fail · `GET /demo/list-container` returns HTTP 200 with the live feed/grid/empty output
(escaped `data-item` payload, conforming inner markup unchanged by the enforcer) on the
running server.

## HITL — how to verify

1. Run the app: `bun run dev`
2. Open `http://localhost:3030/demo/list-container`
3. Confirm on the running surface:
   - **Feed** shows the sample records as single-column cards; **Grid** shows the *same*
     wrapped items as a responsive multi-column grid — item chrome reads on-brand in both.
   - The **empty state** section shows the "Nothing here yet…" message (no cards).
   - **“New Reading list”** opens the live create form (submit is inert here); it closes
     if a create succeeds.
   - **Click any card** (or focus + Enter/Space): its `data-item` payload pops in the
     detail stand-in, proving the escaped record round-trips.
4. Sign off that the feed/grid layout and the wrapped item chrome are on-brand and
   complete, then check the final acceptance box.

## Blocked by

- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/01-centralized-field-renderer.md
