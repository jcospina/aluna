# Toolbar rehydration & cached-view serving

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.1 — Capability
Registry (`docs/modules.md` §2.1 & §2.6, ARCH §6.1, ADR-0004 "views are
data-free", PLAN 2.1(b):
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The registry's read-side payoff: Aluna *remembers you*. On shell load, the
capability toolbar rehydrates from the registry, and clicking an entry serves
the capability's cached view — instantly, with no AI involved.

- **Rehydration on load.** The sidebar renders one entry per registry row,
  reusing the canonical toolbar-entry fragment defined by the commit-swap issue
  (so the on-load path and the out-of-band path can never drift). With at least
  one capability, the shell's `hasCapabilities` presentation state flips and
  the sidebar shows; a fresh user keeps the untouched cold-start state.
- **Click serves the cached view as-is.** A toolbar click loads the
  capability's cached, data-free `list` view into the content area straight
  from the version directory the registry points to — no regeneration, no AI
  call (the version-keyed cache is never stale because data never enters it,
  ADR-0004). The view's dynamic region then loads live records through the
  capability's `read` action.

This is the last piece of the module's acceptance demo: refresh the page → the
toolbar rehydrates → the note is still there.

## Acceptance criteria

- [x] Fresh user (empty registry): sidebar hidden, cold-start state unchanged
- [x] With registry rows: entries render on load and `hasCapabilities` flips
- [x] Entry markup is the canonical fragment from the commit-swap issue — one
      definition, two consumers
- [x] Clicking an entry serves the cached `list` view as-is (no regeneration,
      no AI call) and its dynamic region loads live data via the `read` action
- [x] The M2 demo's closing beat passes: after a build and a page refresh, the
      toolbar rehydrates and the added note is still there

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.1-capability-registry/issues/01-registry-store-and-capability-spec-shape.md
- modules/02-explicit-loop-i-build-your-first-capability/2.3-deterministic-router/issues/01-capability-router-and-handwritten-tracer.md
- modules/02-explicit-loop-i-build-your-first-capability/2.6-shell-render-and-commit-swap/issues/03-commit-swap-content-and-toolbar-oob.md

## Implementation notes

- `GET /` no longer serves `public/index.html` verbatim. It now rehydrates the
  capability toolbar from the registry via the new `renderRehydratedShellPage`
  (`src/web/cached-view.ts`): read the rows, read the shell file, inject one
  canonical entry per row, flip the shell into `has-capabilities`. An empty
  registry returns the shell untouched, so a fresh user keeps the cold-start page.
- The entry markup is the canonical `renderCapabilityToolbarEntry`
  (`src/web/fragments.ts`) — the same renderer the commit-swap OOB path uses. The
  new `renderRehydratedShell` and the existing `renderCapabilityShell` now share
  one private `injectToolbarEntries` helper (placeholder insertion + class flip),
  so the on-load path, the OOB path, and direct `/capability/:id` navigation cannot
  drift in how an entry is rendered or placed.
- The load path restores chrome only: it never pre-serves a capability view into
  the content area. A toolbar click loads the cached, data-free `list` view through
  the existing `GET /capability/:id` route (`hx-get` on the entry), whose dynamic
  region then loads live records via the `read` action (ADR-0004) — already wired
  by the commit-swap issue; this issue reuses it unchanged.
- `app.js` needed no change: its `init()` already mirrors `hasCapabilities` from a
  server-rendered `[data-capability-entry]`, so injecting entries into the shell
  flips the Alpine state with no flash (the server also sets the root class so the
  CSS is correct before Alpine boots).
- Resilience for an uninitialized registry: added `isRegistryInitialized`
  (`src/registry/store.ts`). The shell must render *before* the platform's first
  migration (a brand-new db, or a checkout where `data/omni-crud.db` does not yet
  exist), so the rehydration treats a missing registry table as an empty registry
  (cold-start) instead of failing on `no such table`. Every other registry reader
  runs post-migration and need not ask.
- The `/` route reads the registry through the same read-only connection the
  capability router serves from (resolved once in `createApp`), so a toolbar entry
  click hits `/capability/:id` on a consistent view of the registry. Tests inject a
  scratch pair via `capabilityRouter.databases`; a freshly committed build shows up
  in the rehydrated toolbar on the next `GET /`.

## Verification

- `bun test src/web/fragments.test.ts` — 4 pass (empty registry returns the shell
  byte-for-byte; rows render one canonical entry each, flip `has-capabilities`,
  preserve the placeholder, and never inject a content surface; missing placeholder
  throws)
- `bun test src/app.test.ts` — 28 pass (new `GET /` block: cold-start for an empty
  registry; rows rehydrate + flip; the M2 closing beat — build → create a note →
  refresh rehydrates the toolbar → click serves the cached view → `read` returns
  the persisted note)
- `bun test src/registry/store.test.ts` — 7 pass; `bun test src/router/router.test.ts`
  — 8 pass
- `bun test` — 169 pass
- `bun run typecheck`
- `./node_modules/.bin/biome check src/app.ts src/web/fragments.ts src/web/cached-view.ts src/web/index.ts src/web/fragments.test.ts src/registry/store.ts src/registry/index.ts src/app.test.ts`
- `git diff --check`
- Resilience smoke: `GET /` against a db with no migrations (registry table
  missing) and against a migrated-but-empty registry both return the cold-start
  shell with no error.
- Live server smoke on `localhost`: against the real registry (Notes + Recipes
  committed), `GET /` returns `class="shell has-capabilities"` with both entries
  pointing at `/capability/:id`; a `GET /capability/notes` HX click returns the
  cached `capability-surface` (no AI), and `GET /capability/notes/read` returns the
  live persisted note.

## HITL test instructions

1. Run `bun run dev` (no `OMNI_API_KEY` needed for the rehydration path itself; you
   do need it to *build* a new capability in step 4).
2. Open `http://localhost:3030/` (or the printed port). If the registry already has
   capabilities, the left sidebar is present and shows one entry per capability with
   no build; if it is empty, you see the untouched cold-start page (no sidebar).
3. Click a toolbar entry: the cached list view loads into the content area instantly
   (no narration, no build), and its records region populates with live data via the
   `read` action.
4. End-to-end refresh beat: with `OMNI_API_KEY` set, type
   `I want to keep track of my notes`, **Make it**, and add a note. Then **refresh
   the page**. Confirm the toolbar rehydrates with the Notes entry, the sidebar is
   shown, and clicking Notes shows the list with the note you added still there — all
   with no build call on load.
5. Fresh-user check (optional): `bun run reset`, restart `bun run dev`, open `/`, and
   confirm the sidebar is hidden and the cold-start page is unchanged.
