# Commit swap — content area + toolbar out-of-band

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.6 — Shell render
+ commit swap (`docs/modules.md` §2.6, ARCH §6.1, §6.2 step 5, PLAN flow step 7:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The commit moment as the user sees it: the build finishes, and in **one** SSE
response the content area becomes the new capability and the capability toolbar
gains its entry — no reload, no second round-trip.

- **The swap.** On commit, the job's stream delivers the finished view into the
  content area and the new toolbar entry out-of-band (`hx-swap-oob`), then
  `done` closes the stream. Uses the event vocabulary finalized in the epic's
  spike issue.
- **What lands in the content area** is the capability's cached, data-free
  `list` view (ADR-0004) — its dynamic region immediately loads live records
  through the capability's `read` action.
- **Sidebar state.** The new entry appears in the sidebar; when it is the
  user's first capability, the shell's `hasCapabilities` presentation state
  flips and the sidebar appears.
- **Define the toolbar-entry fragment once.** The entry markup this issue
  introduces is the canonical one — load-time rehydration (epic 2.1) reuses it,
  so the out-of-band path and the on-load path can never drift apart. Document
  the fragment's home for that reuse.

## Acceptance criteria

- [x] On commit, one SSE-driven response swaps the content area and updates the
      sidebar out-of-band; no reload, no extra round-trip
- [x] The new entry appears in the sidebar; `hasCapabilities` flips when it was
      the first capability
- [x] The swapped-in view is the cached data-free `list` view, and its dynamic
      region loads live data through the `read` action
- [x] The toolbar-entry fragment is defined once and documented for reuse by
      load-time rehydration
- [x] The M2 demo runs through the commit moment: prompt → narration → the
      Notes entry appears → the list + add-note form show → adding a note
      persists and renders

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/07-commit-and-rollback.md
- modules/02-explicit-loop-i-build-your-first-capability/2.6-shell-render-and-commit-swap/issues/02-prompt-bar-wiring-and-busy-state.md

## Implementation notes

- `renderBuildSubscriber` now listens for the finalized `commit` SSE event. The
  terminal success path sends developer-only `commit-preview`, then one product
  `commit` event, then `done`.
- Added cached-view composition in `src/web/cached-view.ts`: commit reads the
  committed `list.html` and `create.html` from the row's versioned
  `artifacts_path`, renders the cached data-free list view, appends the cached
  create form, and includes the toolbar entry as an `hx-swap-oob` sidecar in the
  same SSE payload.
- Defined the canonical toolbar-entry fragment in `src/web/fragments.ts`
  (`renderCapabilityToolbarEntry`). Commit-time OOB insertion uses it now; the
  load-time rehydration issue should reuse the same renderer.
- Added `GET /capability/:id` to serve the same cached capability surface for
  toolbar entry clicks with no AI call or regeneration. The generated action
  route remains `/capability/:id/:action`.
- Added presentation-only browser glue in `public/app.js`: after HTMX swaps, the
  shell mirrors whether a `[data-capability-entry]` exists into Alpine's
  `hasCapabilities`, revealing the sidebar/toggle when the first capability
  lands.
- Added minimal toolbar and committed-capability CSS so the final state reads as
  the active capability instead of lingering build narration.
- Regression follow-up: tightened generated-unit prompts and checks so `read`
  handlers do not bind unused `input`, `list.html` cannot contain create forms
  or native capability links, and `create.html` must target the list view's live
  records region. Direct `/capability/:id` loads now receive the full shell with
  authored CSS/scripts; HTMX toolbar clicks still receive only the cached
  capability fragment.
- Visibility bug fix: moved the active `#spec-build-output` region out of the
  cold-start-only wrapper, so `.shell.has-capabilities .cold-start { display:
  none; }` no longer hides direct `/capability/:id` surfaces or later toolbar
  reloads. Added an `HTMLRewriter` regression that checks the active surface's
  ancestors, not just that the HTML string contains `capability-surface`.
- Label bug fix: toolbar entries now render a canonical short capability name,
  falling back from legacy sentence-like labels to the title-cased capability id
  (for example, `notes` -> `Notes`). Generated specs are stricter going forward:
  `label` must be a short name, not product-voice narration.
- Commit-time toolbar bug fix: the OOB marker now wraps the canonical toolbar
  entry instead of living on the entry button itself. HTMX's `beforeend` OOB swap
  inserts an OOB root's children, so putting `hx-swap-oob` directly on the button
  appended only the text and left no `[data-capability-entry]` for Alpine to
  reveal the sidebar at first commit. Direct page-load toolbar rehydration remains
  the separate epic 2.1 issue.

## Verification

- `bun test src/web/fragments.test.ts` — proves the commit-time OOB wrapper
  contains the canonical toolbar entry instead of marking the button itself
- `bun test src/router/router.test.ts` — 8 pass, including the direct-view
  visibility and legacy sentence-label regressions
- `bun test src/registry/spec.test.ts src/builder/spec-gen.test.ts` — 22 pass
- `bun test src/app.test.ts` — 25 pass
- `bun test` — 163 pass
- `bun run typecheck`
- `./node_modules/.bin/biome check src/registry/labels.ts src/registry/index.ts src/registry/spec.ts src/registry/spec.test.ts src/web/fragments.ts src/builder/spec-gen.ts src/builder/spec-gen.test.ts src/router/router.test.ts public/index.html public/css/demo.css`
- `git diff --check`
- Fresh runtime smoke on `localhost:3030`: after reset, built Recipes from the
  prompt. The committed artifacts have one create form, no native
  `action`/`href` capability navigation, `read.ts` binds only `{ data }`, and
  `GET /capability/recipes` returns the full styled shell.

## HITL test instructions

1. Optional clean-slate check for the first-capability sidebar flip: run
   `bun run reset` first. This wipes local runtime data.
2. Run `bun run dev` with `OMNI_API_KEY` set for the configured provider.
3. Open `http://localhost:3030/` (or the port printed by the server).
4. Type `I want to keep track of my notes` and submit with **Make it**.
5. Confirm the content area streams narration, then swaps to the Notes capability
   without a reload; the left sidebar appears with a Notes entry from the same
   commit moment.
6. Confirm the Notes view contains a live list region and an add-note form. Add a
   note and confirm the returned note fragment is visible; click the Notes
   toolbar entry and confirm the cached view reloads without another build call.
7. Directly open `/capability/notes` after commit. Confirm the full Aluna shell is
   styled, the toolbar entry is present, there is exactly one create form, and
   submitting the form updates the live records region without navigating to an
   error page. Refresh-time toolbar rehydration remains the follow-up epic 2.1
   issue.
