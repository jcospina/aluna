# Remove the platform-presentation preview surfaces

Status: ready-for-agent

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
  page. `docs/design-system.md` links it as the canonical visual reference and
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
- **Update the docs.** `docs/design-system.md` links the four removed pages at
  lines 248, 285, 372, 450, and 452. Replace each link with the module it
  documents (or with the live capability surface, where that is the honest
  answer) — do not leave dead `/demo/*` links in the design system. The
  `/static/primitives-preview.html` link at line 180 stays. Earlier issue files
  keep their historical HITL text unchanged.

## Acceptance criteria

- [ ] No route, module, doc, or test references `/demo/field-renderer`,
      `/demo/list-container`, `/demo/detail-modal`, or `/demo/detail-interaction`
- [ ] Those four routes return 404; `GET /demo/few-shot-gallery` still renders
      the exemplars and the injected prompt section in a dev run
- [ ] `/demo/few-shot-gallery` is not served by a production bundle
- [ ] The four preview modules are deleted and every presentation symbol they
      used still has a production caller
- [ ] A committed capability's live surface is unchanged: create disclosure with
      cancel, list in its declared layout, click-to-open read-only detail, edit
      mode, confirmation-gated delete, and debounced search
- [ ] Hostile-record escaping is proved in the presentation module suites, not
      in an app route test
- [ ] `docs/design-system.md` contains no link to a removed route
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage keeps every behavior these pages previewed — they were a way to see
the platform chrome without owning a capability, and an active capability now
shows all of it directly. Open a capability from the toolbar: the create form,
the collection layout, the detail modal, and search are the same modules the
previews rendered.

## Notes

Independent of 05, 06, and 08.

The four removed pages imported the real modules rather than copying markup, so
they could not silently drift — a signature change broke the typecheck. That is
why they are being retired for redundancy, not for rot, and why the gate on the
surviving gallery matters more than its deletion would.
