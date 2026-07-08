# Re-point View serving to spec-rendered platform scaffolding

Status: done — spec-rendered serving confirmed on the running app (2026-07-08); the
platform list scaffolding renders from the spec (no served `list.html`/`create.html`),
records arrive through `read`, and there is no visual regression. Per-record *styling*
is deferred to the item renderer (epic 3.4) by build order — out of this issue's scope.

> **HITL — human visual sign-off required.** Opening a capability now renders the
> platform-built list instead of a served view; a human confirms parity and no
> visual regression on the running app before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.2 — Platform presentation modules
(the thick shell) (`docs/modules.md` §3.2, ARCH §6.1, ADR-0005 §1,
PLAN decision 1 & flow step 6: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Re-point the capability **View**-serving path so the list scaffolding is rendered
**live from the spec** by the platform (3.2/02) instead of being served from a
generated `list.html`/`create.html`. The ADR-0004 "never-stale cache" property is
preserved because data never enters the platform-rendered chrome — records still
arrive through the `read` **Action**.

- `GET /capability/:id` (toolbar-entry clicks) and the rehydration path in the
  cached-view module (`src/web/cached-view.ts`) render the platform list
  scaffolding from the capability's spec — deterministic, no AI, no regeneration.
- The generated `list`/`create` Views are no longer served. (Their *generation*
  is retired later in 3.4/02 and finalized in 3.7; this issue stops *serving*
  them.)
- Records continue to load through the capability's `read` Action into the
  container's live region.

## Acceptance criteria

- [x] `GET /capability/:id` and the cached-view rehydration path render the
      platform list scaffolding from the spec (no served `list.html`/`create.html`)
- [x] Records still arrive through the `read` Action; no user data is baked into
      the platform-rendered chrome
- [x] The layout honors the capability's `collection.layout` (defaulting to `feed`
      until 3.3/01 lands)
- [x] Router/serving tests cover the spec-rendered path and the data-free invariant
- [x] Demo: opening an existing capability from the toolbar shows the
      platform-rendered list; human visually confirms parity / no regression before
      done
      <!-- Human visual sign-off received on the running app 2026-07-08: opening a
           committed capability shows the platform list scaffolding (New X + records
           region + empty state, feed layout) rendered live from the spec, records load
           through `read`, and no visual regression (primary button keeps its accent
           fill). Confirmed on the criterion's own terms — "renders from spec instead of
           HTML" — with the caveat noted at sign-off that per-record visual polish is bare
           until the item renderer (epic 3.4); the SAME container with a real item renderer
           is on-brand (verified at /demo/list-container). That styling is 3.4's scope, not
           this issue's. Open follow-up flagged: revisit the "New X" button placement in
           the container (3.2/02) now that it's seen in the real app. -->

## Delivered

- `src/presentation/list-container.ts` — `renderCollection` gains a **`loadThroughRead`**
  serving mode: the records region is emitted empty and carries
  `hx-get="/capability/<id>/read" hx-trigger="load" hx-swap="innerHTML"`, so htmx fills it
  after the deterministic chrome renders. Mutually exclusive with the demo/server-rendered
  `items` seed. Keeps the chrome **data-free** (ADR-0004): no record is ever baked in.
- `src/web/cached-view.ts` — re-pointed. `renderCachedCapabilitySurface`,
  `renderCachedCapabilityShell`, and `renderCachedCapabilityCommitSwap` no longer read
  `list.html`/`create.html`; they render the platform list scaffolding live from the row
  via a private `renderCapabilityCollection` (canonicalized label so a legacy sentence
  label never leaks into the chrome; `collectionLayoutForRow` is the single seam that will
  read `ui_intent.collection.layout` when 3.3/01 lands, defaulting to `feed`). The
  file-reading helper is gone; the module header is rewritten to match.
- `src/web/fragments.ts` — `renderCapabilitySurface` / `renderCapabilityShell` /
  `renderCapabilityCommitSwap` now take one pre-rendered `collectionHtml` instead of
  `(listView, createView)`. The `capability-surface` marker drops its redundant
  landmark name (the wrapped collection `<section>` already labels the region) while
  keeping `data-active-capability-id`.
- `public/css/demo.css` — retired the Module-2 `.capability-surface :is(input|textarea|
  button|…)` generic child rules (a stopgap for the unstyled generated views). They would
  otherwise override the platform's own `.btn--primary` / `.field__control` chrome —
  removing them is what prevents a visual regression on the primary buttons.
- Tests: `list-container.test.ts` adds a serving-mode block (read-wired region, truly
  `:empty` data-free region, `items` ignored under `loadThroughRead`, create path
  untouched); `router.test.ts` adds a **data-free invariant** test (a committed record
  never enters either serving path's chrome, yet is retrievable through `read`) and
  re-frames the two view tests as spec-rendered; `fragments.test.ts` / `app.test.ts`
  updated to the new signatures/wording.
- `docs/design-system.md` — the collection section's forward-reference to 3.2/03 is
  realized (documents the `loadThroughRead` serving path and why it preserves ADR-0004).

Verified: `bun run typecheck` clean · `bun run lint` clean · `bun test` 286 pass / 0 fail.
Drove the real serving stack over HTTP against the hand-written notes fixture (no AI): a
toolbar click serves the platform `capability-collection` with the read-wired region and
the platform create form, the old `capability-view`/`notes-heading` chrome is gone, a
persisted record is absent from the chrome yet present in the `read` output, and
`bun src/index.ts` boots and serves `GET /` (HTTP 200).

## HITL — how to verify

1. Run the app: `bun run dev`
2. Open `http://localhost:3030` and either build a capability (type e.g. *"track my
   reading list"* in the prompt bar) or, if one already exists, click its **toolbar entry**.
3. Confirm on the running surface:
   - Opening the capability shows the **platform list scaffolding** — the "New X"
     button, the records region, and (before any record) the "Nothing here yet…" empty
     state — styled on-brand, not the old bare generated list.
   - The list is a single-column **feed** (the default until 3.3/01).
   - Records **load into the list** (they arrive through the `read` action); adding one
     via "New X" prepends it and clears the empty state.
   - No visual regression vs. the previously-served view (primary buttons keep their
     accent fill; fields read on-brand).
4. Sign off that parity holds and there is no visual regression, then check the final
   acceptance box.

## Blocked by

- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/02-list-scaffolding-container-and-item-wrapper.md
