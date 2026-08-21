# Remove the platform-presentation preview surfaces

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(ADR-0002 (route namespacing: `/demo/*` is throwaway and freely removable);
Module 3 epics 3.2–3.3, whose HITL surfaces these were)

## What to build

Epics 3.2 and 3.3 each shipped a deterministic preview page so a human could
sign off the platform presentation modules on the running app before any
generated capability could show them. Four of those pages have outlived that
purpose. Every module they preview is now served in production — `cached-view.ts`
renders committed capabilities through the real `renderCollection`, which
composes the field renderer, the item wrapper, and the shared modal — and Module
4.3 put full CRUD, edit mode, delete confirmation, and search chrome on that same
live surface.

Remove four; keep two.

**Remove:**

- `GET /demo/field-renderer` → `src/presentation/field-renderer-preview.ts`
- `GET /demo/list-container` → `src/presentation/list-container-preview.ts`
- `GET /demo/detail-modal` → `src/presentation/detail-modal-preview.ts`
- `GET /demo/detail-interaction` → `src/presentation/detail-interaction-preview.ts`

**Keep, deliberately:**

- `GET /demo/few-shot-gallery` (`src/builder/units/few-shot-gallery-preview.ts`)
  — it previews the repo-owned exemplars *and the exact prompt section the
  item-renderer generator receives*. That prompt text has no other inspection
  surface; production shows you the generated output, never the injected input.
- `/static/primitives-preview.html` — the closed vocabulary from 3.1/01 on one
  page. `design/design-system.md` links it as the canonical visual reference and
  `vocabulary.test.ts` cross-checks `ALLOWED_CLASSES` against
  `primitives.css`, so the page and the enforcer stay honest together.

Work to do:

- **Remove the four routes** from `registerPreviewDemoRoutes` (`src/app/app.ts`)
  and their four imports at the top of the file, then delete the four preview
  modules. Verify no production symbol is orphaned: `renderCreateForm`,
  `renderDetailFields`, `OPEN_DETAIL_EVENT`, `renderDetailContentTemplate`,
  `renderItemWrapper`, and `enforceItemMarkup` each have production callers
  beyond these pages and must all survive.
- **Keep `registerPreviewDemoRoutes` itself**, now holding only the few-shot
  gallery route. Update its doc comment, which currently describes the 3.2–3.5
  previews plus the 4.2 coordinator demo — both of those groups are gone once
  this and issue 05 land.
- **Gate the surviving route.** `createApp()` registers every route
  unconditionally, so `/demo/few-shot-gallery` ships inside `dist/index.js` and
  answers requests under `bun run start`. Put it behind a dev-only check so a
  production bundle does not serve a developer inspection surface. Gate whatever
  `/demo/*` routes still exist when this lands — issues 04, 05, and 08 delete the
  rest, and this is order-independent: a guard around a route that a sibling
  issue later deletes costs nothing. Keep it to one guard, not a framework — no
  configuration machinery, no per-route flags.
- **Delete the two route tests; keep one assertion if it is unique.** The
  `GET /demo/list-container` and `GET /demo/detail-interaction` blocks in
  `src/app/app.test.ts` are the only tests these four pages have —
  `/demo/field-renderer` and `/demo/detail-modal` have none at all. Their
  substance is already covered by the modules' own suites:
  `field-renderer.test.ts` (create-cancel button, `data-list-field-add`),
  `adapter.test.ts` (`data-detail-template` keying per record, escaping),
  `detail-modal.test.ts`, `enforcer.test.ts`, and `router.views.test.ts:142`
  (`data-detail-template` on the real serving path). Confirm each assertion has
  a home before deleting the block. The hostile-record escaping test in the
  detail-interaction block is real security coverage — if `adapter.test.ts` and
  `enforcer.test.ts` do not already prove that a `<script>`/`<img src=x>` record
  reaches neither the list nor the detail template, move that test there rather
  than dropping it.
- **Update the docs.** `design/design-system.md` links the four removed pages at
  lines 248, 285, 372, 450, and 452. Replace each link with the module it
  documents (or with the live capability surface, where that is the honest
  answer) — do not leave dead `/demo/*` links in the design system. The
  `/static/primitives-preview.html` link at line 180 stays. Earlier issue files
  keep their historical HITL text unchanged.

## Acceptance criteria

- [x] No route, module, doc, or test references `/demo/field-renderer`,
      `/demo/list-container`, `/demo/detail-modal`, or `/demo/detail-interaction`
- [x] Those four routes return 404; `GET /demo/few-shot-gallery` still renders
      the exemplars and the injected prompt section in a dev run
- [x] `/demo/few-shot-gallery` is not served by a production bundle
- [x] The four preview modules are deleted and every presentation symbol they
      used still has a production caller
- [x] A committed capability's live surface is unchanged: create disclosure with
      cancel, list in its declared layout, click-to-open read-only detail, edit
      mode, confirmation-gated delete, and debounced search
- [x] Hostile-record escaping is proved in the presentation module suites, not
      in an app route test
- [x] `design/design-system.md` contains no link to a removed route
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage keeps every behavior these pages previewed — they were a way to see
the platform chrome without owning a capability, and an active capability now
shows all of it directly. Open a capability from the toolbar: the create form,
the collection layout, the detail modal, and search are the same modules the
previews rendered.

## What shipped

- **Four routes and four modules gone.** `registerPreviewDemoRoutes`
  (`src/app/app.ts`) lost the `/demo/field-renderer`, `/demo/list-container`,
  `/demo/detail-modal`, and `/demo/detail-interaction` registrations and their
  four imports; `src/presentation/{field-renderer,list-container,detail-modal,
  detail-interaction}-preview.ts` are deleted (939 lines). All six named
  presentation symbols keep production callers — `renderCreateForm`
  (`list-container.ts:246`), `renderDetailFields` (`detail-modal.ts:179`),
  `renderDetailContentTemplate` / `renderItemWrapper` / `enforceItemMarkup`
  (`adapter.ts:121-123`, plus `gate-design-lint.ts:256`), and
  `OPEN_DETAIL_EVENT` as the pinned string `detail-modal.test.ts:263` and
  `list-container.test.ts:376` check against the browser controllers.
- **`registerPreviewDemoRoutes` survives** holding only
  `/demo/few-shot-gallery`, with a doc comment that now says why that one page
  outlives the rest: it is the only surface where the *injected* item-renderer
  prompt section can be read.
- **One dev-only guard.** `demoSurfacesEnabled()` (`src/app/app.ts`) returns
  `process.env.NODE_ENV !== "production"`, and `bun run build` now passes
  `--define process.env.NODE_ENV='"production"'` so it folds to `false` in the
  bundle. It wraps `/demo/spec-build` and `/demo/few-shot-gallery`.
  It deliberately does **not** wrap the evolution tracer:
  `renderEvolutionDemoControl` (`src/web/fragments.ts:154`) renders an
  `hx-post="/demo/evolution/:id"` form on *every* capability surface, so gating
  that route alone would ship a visible dead button rather than remove a
  surface. Route and control retire together in issue 04. The guard is a
  function, not a module constant, so a test can actually flip `NODE_ENV` and
  prove it — a frozen constant would have left the gate unprovable and free to
  be deleted under a green suite.
- **Tests.** Both route blocks deleted from `src/app/app.test.ts`. Three
  assertions were unique and were rehomed rather than dropped:
  - the `app.js`-before-`alpine.min.js` ordering moved into the `GET /` shell
    block — it pins the invariant documented at `public/index.html:38-39`, and
    the shell had no other test for it;
  - `data-list-field-label` / `data-list-input-id` / the `Add another` label
    moved into `field-renderer.test.ts:160` — a live cross-file contract that
    `syncListFieldRows` (`public/app.js:364-365`) reads to re-key every repeated
    row's `input.id` and `aria-label`, and which had **zero** assertions
    anywhere else;
  - hostile-record escaping moved to `adapter.test.ts` as a new test over the
    record's detail `<template>`. The pre-existing sibling at `adapter.test.ts`
    already covered the *list* half; the detail half — read mode **and** the
    edit-mode input seed — was genuinely uncovered.
  Two new tests pin the guard itself (`app.test.ts`): production serves `/` but
  404s the two gated routes, and the evolution tracer still answers.
- **Docs.** The five dead `/demo/*` links in `design/design-system.md` now point
  at the live capability surface or the owning module. Also fixed two stale
  comments the deletion exposed: `detail-modal.ts:60` still credited "the demo's
  dev trigger" for dispatching `OPEN_DETAIL_EVENT` (the only dispatcher left is
  `public/item-detail.js`), and `public/css/demo.css:57` claimed the prompt bar
  opens `/demo/spec-build` (it posts to `/prompt`).

## Verification

`bun run test` 1021 passed / 0 failed · `bun run typecheck` clean ·
`bun run lint` clean.

Adversarial review (SOTA subagent) found two substantive defects, both fixed
above: the untestable module-constant guard, and the silent loss of the
`data-list-field-*` contract coverage. It independently verified every other
deleted assertion has a home, that `--define` does no collateral damage to the
other `process.env` readers (`OMNI_CRUD_SQLITE_LIBRARY`, `PORT`, `CC`, and the
whole-object reads in `provider/config.ts` and `gate.ts:661` all survive), and
that the new escaping test fails under two independent un-escaping mutations of
`field-renderer.ts`. The always-on mutation of `demoSurfacesEnabled()` was also
confirmed to fail the new guard test.

Live, on the dev server (port 3030): the four routes 404,
`/demo/few-shot-gallery` 200 with all three exemplar captions, six wrapped
items, the shared modal, and the "Injected prompt preview" section;
`/static/primitives-preview.html` 200; `/` 200; a capability page still carries
its evolution control.

Production bundle (`bun run build`, booted from a scratch cwd): all six `/demo`
preview and spec-build paths 404, `/` and `/static/primitives-preview.html` 200,
`/demo/evolution/*` still answered. Note the gated modules are still *bytes* in
`dist/index.js` — Bun folds the check to `false` but does not eliminate the
branch. The criterion is "not served", which holds.

## HITL

1. Dev server on port 3030 (`bun run dev` if it is not already up).
2. Confirm the four pages are gone — each should render a 404, not a preview:
   `http://localhost:3030/demo/field-renderer`,
   `/demo/list-container`, `/demo/detail-modal`, `/demo/detail-interaction`.
3. Confirm the two deliberate keeps still work:
   `http://localhost:3030/demo/few-shot-gallery` shows the three exemplar cards
   *and* the "Injected prompt preview" block, and
   `http://localhost:3030/static/primitives-preview.html` shows the primitives.
4. Open a capability from the toolbar and confirm nothing regressed on the live
   surface — this is where the removed previews' behavior now lives: "New X"
   opens the create form and Cancel closes it; records list in the declared
   layout; clicking a record opens the read-only detail modal; Edit switches to
   edit mode; Delete asks for confirmation; typing in search filters after a
   short pause. If the capability has no records yet, add one first.
5. Optional, to see the gate: `bun run build && bun run start`, then hit
   `/demo/few-shot-gallery` — it must 404 there while `/` still loads.

Sign-off gate: the four routes 404, the gallery and primitives page still
render, and a capability's live surface behaves exactly as it did before.

## Notes

Independent of 05, 06, and 08.

The four removed pages imported the real modules rather than copying markup, so
they could not silently drift — a signature change broke the typecheck. That is
why they are being retired for redundancy, not for rot, and why the gate on the
surviving gallery matters more than its deletion would.

Left deliberately unchanged: the HITL steps in sibling issue
`05-remove-mutation-coordinator-demo.md` (lines 156, 159, 170) tell a reader to
confirm `/demo/field-renderer` returns 200. That is the historical record of a
verification performed when 05 landed, and this issue's spec says earlier issue
files keep their historical HITL text unchanged — so it stays, noted here rather
than rewritten.
