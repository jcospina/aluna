# Remove the mutation-coordinator admission demo

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decision 30 (one coordinator; "direct/demo build paths must use the same
coordinator or be removed"):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0002 (route
namespacing))

## What to build

Epic 4.2/01 built the atomic mutation coordinator and, alongside it, a preview
page that let a human watch a lease change hands across two browser tabs. The
coordinator is now the platform's real admission gate on every shared-connection
write:

- record `create | update | delete` — `tryAcquireRecordWrite` (`src/router/router.ts`)
- new-capability builds — `reserveBuild` / `withBuildLease` (`src/pipeline/build/prompt-pipeline.ts`)
- evolution — `src/pipeline/build/evolution-pipeline.ts`
- deflection and non-build platform writes — `src/pipeline/build/deflection-pipeline.ts`

A demo surface earns its place only while the real functionality cannot be
exercised. This one no longer qualifies: the lease it demonstrates is now
reachable from the prompt bar and from every record write on the running app.

Delete the surface, not the coordinator.

- **Remove the routes.** `GET /demo/mutation-coordinator`,
  `GET /demo/mutation-coordinator/state`, and
  `POST /demo/mutation-coordinator/slow-build` in
  `registerPreviewDemoRoutes` (`src/app/app.ts`). The `/slow-build` route exists
  only to hold the global write lease for 15 seconds so a second tab can be seen
  queueing behind it; nothing in the product should be able to park the lease on
  request.
- **Remove the preview module.** `src/mutation-coordinator/preview.ts` in full —
  `renderMutationCoordinatorPreviewPage`, `abortableDelay`, and
  `DEFAULT_MUTATION_PREVIEW_HOLD_MS`. Every one of them has exactly one caller,
  and it is the route group above.
- **Remove the demo-only dependency knob.** `mutationPreviewHoldMs` on `AppDeps`
  and `ResolvedAppDeps`, and its default in `resolveAppDeps` (`src/app/app.ts`).
  It is a test override for the demo's artificial delay and has no production
  meaning. `mutationCoordinator` itself stays on `AppDeps` — the router and the
  build pipelines are wired through it.
- **Delete the demo's tests outright — this one needs no re-pointing.** The two
  tests in `src/app/app.test.ts` (`GET /demo/mutation-coordinator (Module 4.2
  admission preview)`) assert the preview page's own markup and drive the
  coordinator through `mutationPreviewHoldMs`; they cover the demo, not the
  coordinator. The coordinator's own behavior is already proved by
  `src/mutation-coordinator/index.test.ts` and its production admission by
  `src/app/app.resolver-pipeline.test.ts` ("the production resolved-build route
  waits on the injected shared coordinator"). Nothing needs to move: the exact
  scenario the demo staged — a record write queueing behind a build — is already
  `index.test.ts`'s "record writes cannot pass a queued build even before it
  acquires the lease", alongside FIFO admission, stale-lease release refusal,
  single-owner acquisition, platform writes waiting behind builds, expiry vs.
  abort cancellation, release in `finally`, and deletion never queueing. Confirm
  those pass, then delete the block.

The third test in that `app.test.ts` block — "the legacy spec-build demo cannot
bypass the shared coordinator" — belongs to `/demo/spec-build` and is owned by
issue 08, not this one. Leave it alone; it will be re-pointed or removed there.

## Acceptance criteria

- [x] No route, module, or composition-root dependency under `src/` references
      `/demo/mutation-coordinator`, `renderMutationCoordinatorPreviewPage`,
      `abortableDelay`, `DEFAULT_MUTATION_PREVIEW_HOLD_MS`, or
      `mutationPreviewHoldMs`
- [x] `GET /demo/mutation-coordinator` and
      `POST /demo/mutation-coordinator/slow-build` return 404
- [x] `src/mutation-coordinator/preview.ts` is deleted; `index.ts` and
      `index.test.ts` are untouched
- [x] Coordinator behavior is unchanged end to end: a record write is refused
      while a build reservation exists, a build lease is held through success,
      failure, abort, and presenter teardown, and the lease releases in
      `finally`
- [x] FIFO admission (a record write queueing behind a build) remains covered by
      `src/mutation-coordinator/index.test.ts`, not by an app route test
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Nothing visible changes on the homepage. The lease the demo used to illustrate
is already the thing that runs: submit a prompt, and a record `create` on
another capability is warmly refused until the build releases.

## Notes

Independent of every other issue in this epic and the cheapest of the four
removal issues (05–08) — no test needs re-pointing, so it can land first and in
isolation.

ADR-0002 records the precedent: `/demo/*` is throwaway and freely removable, and
two earlier surfaces (`/demo/stream`, `/demo/swap-proof/*`) were retired the same
way, taking no decision with them.

## Implementation notes

- Deleted `src/mutation-coordinator/preview.ts` (297 lines) in full.
  `index.ts` and `index.test.ts` are byte-for-byte untouched.
- Removed all three routes from `registerPreviewDemoRoutes` (`src/app/app.ts`).
  With the coordinator gone from that group, the function no longer needs the
  resolved dependency set at all: it dropped its `ctx` parameter and its doc
  comment now says plainly that every surface left in it is provider-free and
  db-free. `registerPreviewDemoRoutes(app)` is the one call site.
- Removed `mutationPreviewHoldMs` from `AppDeps`, `ResolvedAppDeps`, and
  `resolveAppDeps`. `mutationCoordinator` stays on all three — the router and
  the build pipelines are wired through it.
- Deleted the two demo tests from `src/app/app.test.ts`. The surviving third
  test belongs to `/demo/spec-build` (issue 08), so the enclosing `describe`
  was renamed from "GET /demo/mutation-coordinator (Module 4.2 admission
  preview)" to "shared mutation-coordinator admission on the legacy demo build
  path" — accurate for what is left, and no longer naming a dead route. Every
  helper it imports (`createMutationCoordinator`, `wait`, `createScratchDbEnv`)
  is still used. The file-header comment lost its "mutation coordinator" entry.
- Production admission is untouched and still covered: `src/router/router.ts`,
  `src/pipeline/build/prompt-pipeline.ts`, `src/pipeline/build/evolution-pipeline.ts`,
  and `src/pipeline/build/deflection-pipeline.ts` were not modified.
- Documentation the removal invalidated, fixed in the same pass:
  `TECHNICAL-GUIDE.html` told a reader to open the now-404 route to watch
  admission; it now points at the product path. Following the `/demo/swap-proof`
  precedent, `4.2/01-atomic-mutation-coordinator.md` had its build note marked
  "Proving scaffold (now removed)" and a banner added above its HITL steps
  saying step 3 no longer applies.

## Adversarial review

A SOTA adversarial pass confirmed nothing non-demo was deleted, no dangling
reference survives in `src/`, and no behavior lost its only test — it verified
each deleted assertion against a surviving one (FIFO and queued-build blocking at
`index.test.ts:20,42`; release-in-`finally` at `:70,:113`; expiry vs. abort at
`:90`; the production route waiting on the injected shared coordinator at
`app.resolver-pipeline.test.ts:212`; the `withBuildLease(..., { signal })` abort
path at `provider/abort.test.ts:43`). It raised four low-severity leftovers; three
were documentation and are fixed above.

The fourth was out of scope and pre-existing: `bun run demo:field-lifecycle` and
`bun run demo:five-action-reference` are referenced across the module docs but no
longer exist in `package.json` (removed in `66223e9`, "Final greenfield reset").
It was handled in a separate follow-up pass, which decided against restoring the
scripts — both aliased one installer that POSTs to a route 4.4/05 deliberately
deleted — and instead annotated the 15 affected issue walkthroughs and rewrote
the two live instruction boxes in `TECHNICAL-GUIDE.html`.

## Verification

- `bun run test` — 1020 pass, 0 fail (8 shards, 35s)
- `bun run typecheck` — clean
- `bun run lint` — 289 files clean
- In-process route assertions via `app.request`: `GET /demo/mutation-coordinator`
  404, `GET /demo/mutation-coordinator/state` 404,
  `POST /demo/mutation-coordinator/slow-build` 404, while `/demo/field-renderer`
  and `/demo/few-shot-gallery` still 200.
- Live on the running `http://localhost:3030`: the same three routes return 404,
  and `/`, `/demo/field-renderer`, `/demo/few-shot-gallery` still return 200.

## HITL test instructions

1. Keep the existing `http://localhost:3030` server, or start it with
   `bun run dev`.
2. Confirm the surface is gone: `curl -s -o /dev/null -w "%{http_code}\n"
   http://localhost:3030/demo/mutation-coordinator` prints `404`, and so does
   `curl -s -X POST -o /dev/null -w "%{http_code}\n"
   http://localhost:3030/demo/mutation-coordinator/slow-build`.
3. Confirm nothing else was taken with it: open
   `http://localhost:3030/demo/field-renderer` and
   `http://localhost:3030/demo/few-shot-gallery` — both still render.
4. Confirm the lease still runs on the product path: open
   `http://localhost:3030`, submit a prompt, and while it is building open an
   existing capability in a second tab and try to save a record.
5. Expected: the create is warmly refused — the form stays open, every entered
   value is preserved, no row is written, and the message reads "I'm still
   putting something together. Give me a moment, then try that again." Reads
   stay live throughout. Once the build finishes, submitting the same form again
   succeeds.
