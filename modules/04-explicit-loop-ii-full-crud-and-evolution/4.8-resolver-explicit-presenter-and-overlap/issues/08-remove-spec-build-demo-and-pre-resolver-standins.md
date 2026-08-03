# Remove the `/demo/spec-build` build demo, the pre-resolver stand-ins, and residual dead exports

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decisions 28 (admission vs. generation metrics), 30 ("direct/demo build
paths must use the same coordinator or be removed"), and 31 (presenter is an
adapter): `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0002 (route namespacing))

## What to build

`/demo/spec-build` ran Module 2's whole build pipeline end to end before the
production prompt flow existed. Epic 2.6 superseded it — the route's own comment
in `src/app/app.ts` says so — and it has had no entry point in the shell since:
the prompt bar posts to `/prompt`. Both paths call the same `runSpecBuildStages`
in `src/pipeline/build/build-run.ts`. The demo's remaining difference is that it
hardcodes a `new_capability` intent instead of resolving one, and drives a GET
`EventSource` instead of the job queue.

This is not only redundant. `runDemoUnderLease` / `runDemoStages` /
`presentDemoFailure` in `src/pipeline/demo/spec-build-demo.ts` are a hand-copied
duplicate of `streamNewCapabilityBuild` / `runAdmittedBuildStages` /
`failAdmittedBuild` / `cancelAdmittedBuild` in
`src/pipeline/build/prompt-pipeline.ts`, and the copy has fallen behind:

- **On cancellation**, production delivers the captured View through
  `deliverRestoredPresentation`. The demo returns `"terminal-sent"` and sends
  nothing.
- **On failure**, production restores the captured descriptor via
  `restorationFor(input)`. The demo passes `neutralRestoration` — a blank
  fragment.

Both gaps are 4.5/04's complete-View restoration, which the demo never received.
A verification surface that behaves worse than the thing it verifies is actively
misleading. Deleting the copy is the fix.

Delete the surface and the stand-ins; move the coverage first.

- **Re-point the coverage, do not delete it — do this before removing the
  route.** These suites drive the demo but assert real production behavior:

  | File | Coverage that must survive |
  |---|---|
  | `src/app/app.spec-build-failures.test.ts` | commit-stage failure rolls back and leaves the prior capability intact; behavioral-gate failure sends developer evidence without leaking into narration; behavioral test-generation provider error reaches the developer preview; validation-marker mismatch is visible |
  | `src/app/app.spec-build.test.ts` | a committed capability immediately exercises full CRUD and search through the router; the search Handler repaired by the always-on smoke fixture commits |
  | `src/app/app.metrics-lifecycle.test.ts` | the durable running row exists before the first Builder provider call; a disconnected initial preview closes the row as cancelled; an abort after admission is cancelled, not misclassified as a stage failure |
  | `src/app/app.artifact-reconciliation.test.ts` | lease-head pre-build reconciliation removes a proven abandoned staging build |
  | `src/app/app.spec-build-behavioral-repair-metrics.test.ts` | the successful repair provider call is counted exactly once |
  | `src/app/app.rehydration.test.ts` | an interrupted build is visible in the developer metrics preview after restart; the M2 closing beat — build, refresh rehydrates the toolbar, the note is still there |
  | `src/app/app.test.ts` | "the legacy spec-build demo cannot bypass the shared coordinator" — re-point at `/prompt` or drop it as already proved by `app.resolver-pipeline.test.ts` |

  Run them against `POST /prompt` → `GET /build/:id/stream` with a fake resolver
  classification, the same way issue 04 re-points the evolution suites. The
  helpers already exist in `src/app/app.test-support.ts` (`makeScratchApp`,
  `postPrompt`, `buildJobIdFromSubscriber`, `collectSseEvents`, `readSse`);
  `makePromptBuildProvider` currently lives inside
  `src/app/app.resolver-pipeline.test.ts` and should be promoted to
  `app.test-support.ts` rather than copied.

  Two assertions are genuinely demo-only and go with the route: "falls back to
  the default prompt when the field is empty"
  (`app.spec-build.test.ts`) and anything asserting the `demo-` build-id prefix.

- **Remove the route.** `app.get("/demo/spec-build", …)` in
  `registerSpecBuildDemoRoute` (`src/app/app.ts`) — the whole function, which
  exists only for this route — and update the file header, which still describes
  it. (Issue 06 named this function `registerShellAndLivenessRoutes`; that
  function registered `/` plus the removed `/stream` and is now
  `registerShellRoute`, a separate group that stays.)
- **Remove the demo module.** `src/pipeline/demo/spec-build-demo.ts` in full —
  `streamSpecBuildDemo`, `DEMO_SPEC_PROMPT`, and `handleSpecBuildError` — plus
  their re-exports from `src/pipeline/index.ts`. `handleSpecBuildError` is
  already dead: it is exported from the barrel and called by nothing.
  After issue 04 relocates `hard-evolution-fixture.ts` to test support,
  `src/pipeline/demo/` should be empty; delete the directory and drop the
  `demo/` line from the `src/pipeline/index.ts` header comment.
- **Remove the pre-resolver intent stand-in.** `hardcodedNewCapabilityIntent`
  (`src/builder/spec/spec-gen.ts`, exported from `src/builder/index.ts`), its
  explanatory comment block above it, and the `describe` that only covers it in
  `src/builder/spec/spec-gen.test.ts`. With the resolver in front of every
  build, a hardcoded classification has no caller. This is the `new_capability`
  twin of the `handSuppliedEvolutionIntent` deletion in issue 04.
- **Remove the residual dead export.** `SEARCH_NORMALIZE_SQL_FUNCTION`
  (`src/persistence/sqlite-functions.ts`) — unrelated to the demo, and the only
  other genuinely unreferenced value export in `src/`. The function name is
  hardcoded as a string literal where it is actually registered, so the constant
  never took. Either delete it or make the registration use it; do not leave
  both.

**Explicit non-goals.** `DemoBuildAccumulator` and the `Demo*Preview` types in
`src/pipeline/streaming/previews.ts` are production types with a legacy prefix,
used throughout the real pipeline. Renaming them is a wide mechanical diff with
no behavior change and is not part of this issue. Likewise the `spec-build-*`
element ids in `public/index.html` and the `demo.css` filename: they are live
product chrome under a historical name, and renaming them is separate work.

## Acceptance criteria

- [ ] No route, module, or barrel export under `src/` references
      `/demo/spec-build`, `streamSpecBuildDemo`, `handleSpecBuildError`,
      `DEMO_SPEC_PROMPT`, `hardcodedNewCapabilityIntent`, or
      `SEARCH_NORMALIZE_SQL_FUNCTION`
- [ ] `GET /demo/spec-build` returns 404 and `src/pipeline/demo/` no longer
      exists
- [ ] Every row of the coverage table above runs against `POST /prompt` →
      `GET /build/:id/stream` with no loss of assertions
- [ ] `makePromptBuildProvider` lives in `src/app/app.test-support.ts` and is
      shared, not duplicated
- [ ] A new-capability build through the prompt bar is unchanged end to end:
      spec, migration, units, Gate, publication, activation, one View `commit`,
      and one durable lifecycle row
- [ ] Cancellation and failure both restore the captured View — the behavior the
      deleted copy lacked — proved on the `/prompt` path
- [ ] An unresolved `new_capability` intent is unrepresentable: no code path
      reaches the Builder without a resolver classification
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage loses nothing — it has posted to `/prompt` since 2.6. Typing "I
want to keep track of my notes" builds and activates a capability exactly as
before, and now a cancelled or failed build restores the View it interrupted on
every path, because there is only one path left.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.8-resolver-explicit-presenter-and-overlap/issues/04-remove-evolution-demo-surface.md

## Notes

The largest of the four removal issues (05–08) — roughly 260 lines of source but
about 1,100 lines of tests to move — and the only one with a blocker. It follows
04 so the fake-resolver re-pointing pattern and any `app.test-support.ts`
additions land once and get reused here, rather than being invented twice and
merged.

Sequencing within the issue matters: re-point and run the tests green against
`/prompt` first, then delete the route. Doing it in the other order leaves no
signal that the coverage actually moved.
