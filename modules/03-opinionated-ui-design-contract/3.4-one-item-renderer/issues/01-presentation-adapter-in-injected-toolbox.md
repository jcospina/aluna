# Capability-scoped presentation adapter in the injected toolbox

Status: done — all acceptance criteria met; deterministic seam covered by platform tests
and exercised on the live `/demo/detail-interaction` surface through a hand-written renderer
(the generated renderer's visual result lands in 3.4/02).

## Epic

Module 3 — Opinionated Capability UI · Epic 3.4 — One item renderer, shared by
every action (`docs/modules.md` §3.4, ADR-0005 §2 & §3, amends ADR-0004,
PLAN decisions 2 & 3: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The capability-scoped **presentation adapter** the router adds to each **Handler**'s
injected toolbox: it turns one record into safe, wrapped item HTML by composing
the **item renderer**'s inner markup with the runtime enforcer (3.1/02) and the
accessible item wrapper (3.2/02) — accessible trigger, escaped `data-item`
payload, click-to-open. Handlers **call** it; they never import the renderer or
carry their own row markup (ADR-0004 unchanged — Handlers still import nothing).

- Adapter shape: record → safe wrapped item HTML, capability-scoped, supplied
  through the injected toolbox to `create.ts`/`read.ts` (and later `search.ts`).
- Applies the enforcer on every rendered record (ADR-0005 §3) and wraps via the
  platform item wrapper.
- Deterministic; covered by platform tests (invariants the model cannot get wrong,
  ADR-0005 §4). Verifiable now with a hand-written item renderer as the composition
  input, before generation lands (3.4/02).

## Acceptance criteria

- [x] The router injects a capability-scoped presentation adapter into the Handler
      toolbox; Handlers call it and import nothing
- [x] The adapter composes item-renderer markup → enforcer (3.1/02) → accessible
      wrapper (3.2/02) with escaped `data-item` payload and click-to-open
- [x] The enforcer runs on every rendered record; a hostile field value cannot
      escape it through the adapter
- [x] Platform tests pin the adapter's wrapping/payload/enforcement invariants,
      driven by a hand-written renderer
- [x] AFK — a deterministic seam covered by tests; its visual result is exercised
      once generation lands (3.4/02). Additionally dogfooded into the live
      `/demo/detail-interaction` surface through a hand-written renderer.

## Delivered

- `src/presentation/adapter.ts` — the capability-scoped presentation adapter:
  - `createPresentationAdapter({ capability, renderItem })` → a synchronous
    `present(record): string`. Per record it composes, in the order the platform owns:
    `renderItem(record)` → `enforceItemMarkup` (3.1/02, run on **every** record) →
    `renderItemWrapper` (3.2/02: accessible `role="button"` trigger + escaped `data-item`
    payload + the `data-detail-template`/`data-detail-title` click-to-open hooks) +
    `renderDetailContentTemplate` (the inert detail `<template>` the shared modal clones on
    open, honoring `ui_intent.detail.shows`). The item renderer owns *composition only*;
    the adapter owns escaping, safe insertion, accessibility, the payload, and modal wiring
    (ADR-0005 §3). `present` is sync because the router resolves the renderer once, up front.
  - The detail `<template>` id is `detail-<capabilityId>-<recordId>` — namespaced by
    capability, keyed by the record's platform-populated `id`, so the click controller
    (`public/item-detail.js`) opens the matching detail and two capabilities never collide.
  - `unavailablePresentationAdapter(reason, cause?)` — a `present` that throws only when a
    handler actually calls it, for a capability whose renderer isn't on disk yet (see below).
- `src/router/contract.ts` — `CapabilityContext` gains `readonly present: PresentationAdapter`
  (amends ADR-0004's injected-toolbox contract; ADR-0005 §2). Handlers still import nothing.
- `src/router/router.ts` — the router builds the adapter per request and injects it:
  - a new injectable `ItemRendererLoader` seam (`loadItemRenderer`), default loading the
    version-keyed `item.ts` (`ITEM_RENDERER_FILE`) beside the handlers — the shape 3.4/02
    generates — mirroring `defaultLoadHandler`.
  - `buildPresentationAdapter` **tolerates a missing renderer**: a pre-3.4/02 capability
    (M2 handlers emit their own markup and never call `present`) gets
    `unavailablePresentationAdapter`, so those handlers keep working while a handler that
    *does* present without a renderer surfaces the router's warm, internals-free failure —
    never a blank render.
- `src/builder/gate-internal.ts` + `gate-smoke.ts` + `gate-behavioral.ts` — the gate's
  practice toolbox (ADR-0004 "the smoke test runs it") now carries `GATE_PRACTICE_PRESENT`,
  the same throw-on-call adapter, so the rungs compile and M2 handlers run green. 3.4/02
  swaps it for a real adapter built from the generated renderer, so the smoke rung proves
  create and read render identical item markup.
- `src/presentation/detail-interaction-preview.ts` (`/demo/detail-interaction`) — **dogfooded**:
  the preview's hand-rolled enforce→wrap→template composition is replaced by the real
  `createPresentationAdapter`, so the live demo now proves the actual adapter (not a copy).
  Records carry stable ids; template ids became `detail-reading-<id>`.
- Tests: `src/presentation/adapter.test.ts` (9) pins composition, the record-keyed detail
  template, `detail.shows` routing, enforcement on every record (a hostile renderer **and** a
  field value a renderer forgot to escape — both come out inert), payload byte-safety, and
  the unavailable-adapter behavior. `src/router/router.test.ts` adds two: the adapter is
  injected and a handler renders records through it (importing nothing), and a handler that
  presents without a renderer fails cleanly.

## Verification

- `bun test` — **337 pass / 0 fail** across 27 files (no regression; +11 new).
- `bun run typecheck` — clean (`tsc` strict, both configs).
- `bun run lint` — clean (`biome check .`, 124 files).
- Live, against the running dev server on :3030:
  - `GET /demo/detail-interaction` → HTTP 200; the list is live `renderCollection` output
    whose items the real `present` adapter produced (`class="capability-item"`,
    `data-detail-template="detail-reading-left-hand"`, `<template id="detail-reading-left-hand">`).
  - The hostile record renders inert (no live `<script>alert(1)`, no live `<img src=x>`; the
    value survives only as escaped text), and its escaped `data-item` payload round-trips
    exactly back to the record through a real fetch + parse.

## HITL test instructions

1. Run the app: `bun run dev`
2. Open `http://localhost:3030/demo/detail-interaction`
3. Confirm on the running surface (the list is now produced by the real presentation adapter):
   - Each card is a wrapped item; **click** any card (or Tab to it and press
     **Enter**/**Space**) opens the one shared read-only modal, prefilled from that record.
   - The modal shows exactly `detail.shows` (`title, rating, note, author`) — it drops
     `finished` and reorders — even though the card composes fields differently.
   - The **hostile** record (script / tags / quotes) shows as visible **text** in both the
     card and the modal; nothing pops.
4. Focused seam check (the adapter is a deterministic seam): `bun test src/presentation/adapter.test.ts`
   expects **9 pass, 0 fail**; `bun test src/router/router.test.ts` expects **11 pass** (incl. the
   two injection tests).

## Blocked by

- modules/03-opinionated-ui-design-contract/3.1-closed-value-contract-and-primitives/issues/02-runtime-allow-list-enforcer.md
- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/02-list-scaffolding-container-and-item-wrapper.md
