# Remove the `/demo/spec-build` build demo, the pre-resolver stand-ins, and residual dead exports

Status: done

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

- [x] No route, module, or barrel export under `src/` references
      `/demo/spec-build`, `streamSpecBuildDemo`, `handleSpecBuildError`,
      `DEMO_SPEC_PROMPT`, `hardcodedNewCapabilityIntent`, or
      `SEARCH_NORMALIZE_SQL_FUNCTION`
- [x] `GET /demo/spec-build` returns 404 and `src/pipeline/demo/` no longer
      exists
- [x] Every row of the coverage table above runs against `POST /prompt` →
      `GET /build/:id/stream` with no loss of assertions
- [x] `makePromptBuildProvider` lives in `src/app/app.test-support.ts` and is
      shared, not duplicated
- [x] A new-capability build through the prompt bar is unchanged end to end:
      spec, migration, units, Gate, publication, activation, one View `commit`,
      and one durable lifecycle row
- [x] Cancellation and failure both restore the captured View — the behavior the
      deleted copy lacked — proved on the `/prompt` path
- [x] An unresolved `new_capability` intent is unrepresentable: no code path
      reaches the Builder without a resolver classification — see *A note on
      "unrepresentable"* below for the exact sense in which this holds
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

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

## What actually happened

Followed the prescribed order: all six suites were re-pointed and run green
against `/prompt` **before** anything was deleted.

**The shared factory.** `makePromptBuildProvider` moved from
`app.resolver-pipeline.test.ts` into `app.test-support.ts` and *replaced*
`makeSpecProvider` outright rather than sitting beside it — once every caller
needs a resolver answer first, a spec-first factory has no honest user. It took
over `makeSpecProvider`'s wider `units` options (`updateRepair`, `searchRepair`,
`repairs`), so it is the superset of both. Two more helpers landed with it:
`NEW_CAPABILITY_INTENT` (the classification six suites were otherwise each going
to redeclare) and `runPromptBuild(app, prompt)`, which does POST → job id →
drain stream and returns `{ jobId, payload, events }`. That helper is why the
re-point is a small diff: it collapses the four-line dance every suite would
have repeated.

**Two assertion shapes changed on purpose, both stronger.**

- `eventNames[0] === "metrics-preview"` became `[0] === "narration"` **and**
  `[1] === "metrics-preview"`. Resolution narrates before admission, so the
  admitted row's preview is now the second event, not the first — and pinning
  both positions says more than pinning one did.
- The `/demo/spec-build` 404 moved out of the production-only dev-guard test and
  into *the retired build surfaces are unregistered in every environment*,
  alongside the evolution tracer's. It now runs under both `NODE_ENV`s.

**One test was rewritten rather than re-pointed.** `a missing key streams a warm
apology, not a crash` used `throwingProvider`, which makes `getProvider()` itself
throw — and on the production path `getProvider()` is called *before*
classification (`prompt-pipeline.ts`), so on `/prompt` it can no longer reach the
admitted region the test was actually about. It is now *a provider that dies
after admission…*, driven by a local `providerFailingAfterResolution` fake that
answers the resolver and then throws on every Builder-owned call. Every one of
the original eleven assertions survives verbatim, and it gained a scratch
environment: the old version ran `reconcileCapabilityArtifacts` — which
*deletes* — against the developer's real `data/omni-crud.db` and real
`capabilities/` tree, because it never injected `buildDatabases`/`artifactsRoot`.
The dropped case (a provider unavailable before classification) is covered more
thoroughly at `app.resolver-pipeline.test.ts`, which also asserts the SSE
headers and no-leak across *every* narration and fragment.

**The commit-rollback test needed a different prompt.** It pre-inserts a `notes`
row so commit's registry insert collides — but on `/prompt` the deterministic
duplicate guard sees `"track notes"` and deflects to `extend_capability` before
the resolver is even called, so the build would never reach commit. Verified
directly against `duplicateIntentForPrompt`: `"track notes"` and `"track my
notes"` both deflect (`track` is a stop word, `notes` → `note` matches the row's
id and label); `"log the books I finish"` builds. The prompt is now the latter,
and `expect(eventNames).toContain("gate-preview")` fails loudly if that ever
stops being true. It is the only re-pointed test with a pre-existing capability
row, so no sibling can silently deflect.

**`app.metrics-lifecycle.test.ts` was rewritten wholesale.** Two of its three
cases need a subscriber that misbehaves — a `send` that throws, a `send` that
cancels mid-build — which no HTTP response can express. They now drive
`BuildJobQueue.stream` directly, wired through the same
`createBuildJobQueue({ pipeline: createPromptBuildPipeline({…}) })` the route
builds, and the abort case passes an `AbortController` signal as the route does,
so it exercises `abortableProvider` propagation and not just `isAborted()`
polling.

**Token arithmetic moved by exactly one call everywhere.** The resolver's usage
is seeded into the accumulator at `core-builder.ts`
(`usages: [request.resolver.usage]`), so every `53 * N` and every
`prompts.toHaveLength(N)` gained one: 12→13, 13→14, `53*13`→`53*14`,
`53*17`→`53*18`. Each `prompts[i]` shifted by one, and `prompts[0]` now asserts
the resolver prompt so index 0 stays non-vacuous.

## Deferred, deliberately

- **Seven more unreferenced value exports in `src/pipeline/index.ts`.** The issue
  says `SEARCH_NORMALIZE_SQL_FUNCTION` was "the only other genuinely unreferenced
  value export in `src/`". That is not accurate: `runCoreBuild`,
  `revalidateResolvedRequest`, `createExplicitPresenter`,
  `createExplicitEvolutionPresenter`, `resolvedNewCapabilityRequest`,
  `resolvedExistingCapabilityRequest`, and `finalizeMeasuredNoChange` each have
  **zero** consumers outside `src/pipeline/` — every real user imports them by
  deep path. They are a different kind, though: barrel re-exports of live,
  heavily-used code, not a constant nothing touches. Removing them changes the
  folder's advertised public shape, which is a decision this issue was not asked
  to make, so they are left standing and filed separately.

## A note on "unrepresentable"

The criterion holds in the sense the issue's body describes — the same standard
as the `handSuppliedEvolutionIntent` deletion — but it is enforced by
construction, not by the type system. `runSpecBuildStages` has exactly one caller
(`core-builder.ts`), and `resolvedNewCapabilityRequest` has exactly one
production caller (`prompt-pipeline.ts`, downstream of
`classifyIntentWithUsage`). No hand-constructed `new_capability` classification
survives anywhere in non-test source. But `ResolvedNewCapabilityRequest.resolver`
is a plain measurement, so nothing at the type level stops a *future* caller from
fabricating one — `core-builder.test.ts` deliberately does, which is the
presenter seam working as designed. Ticked on that reading, flagged so nobody
later reads the box as a stronger guarantee than the code makes.

## Review findings, fixed

An adversarial pass over the diff (two independent reviewers) found no
correctness defect, no silently lost coverage, and no arithmetic error. It did
find these, all fixed before closing:

1. **A deleted route named in shipped output.** `build-run.ts` logged
   `Aluna spec-build demo: generated "notes"` on *every production build* — the
   file's header comment was rewritten, its body prose was not. Now
   `Aluna Builder: generated …`, with "Demo-only provider decorator" and "the
   demo's live preview observer" reworded in the same file.
2. **A weakened ordering assertion I introduced.** The old
   *disconnected initial preview* test threw on **every** event, proving the
   admitted row's preview was the first write of any kind. My rewrite threw only
   on `metrics-preview`, so anything could have slipped in before it. Now
   asserts the exact sequence `["narration", "metrics-preview",
   "metrics-preview"]` — resolver line, admitted preview, and the cancellation
   terminal's own swallowed attempt.
3. **A magic string where a constant is exported.** Both new suites matched a
   hardcoded `"Aluna's Intent Resolver"`; the load-bearing one decides which
   provider calls carry the running-row assertion, so a rewording would have
   failed it with an opaque `TypeError`. Now imports
   `INTENT_RESOLVER_PROMPT_PREFIX`.
4. **The abort test dropped the route's `AbortSignal`.** Parity with the old demo
   test, so not a regression — but the new comment claimed route parity it did
   not have. Now passes the signal.
5. **Stale prose** in `pipeline/index.ts` ("for both paths"),
   `app.test-support.ts` ("the demo/prompt app"), `app.ts` ("the demo's metrics
   wiring"), and the `app.spec-build-failures.test.ts` header (still advertising
   a "missing key" slice it no longer has).
6. **A flake surface.** `app.spec-build-behavioral-repair-metrics.test.ts` had no
   `setDefaultTimeout` despite gaining an extra provider round-trip and a second
   HTTP request; now matches its siblings' 15s bound.

## Verification

- `bun run test` — **1040 passed, 0 failed** in 69.8s, and again clean after the
  review fixes.
- `bun run typecheck`, `bun run lint` — clean.
- `bun run build`, then grep of `dist/index.js`: **zero** occurrences of
  `demo/spec-build`, `streamSpecBuildDemo`, `handleSpecBuildError`,
  `hardcodedNewCapabilityIntent`, `SEARCH_NORMALIZE_SQL_FUNCTION`, or the old
  default prompt string.
- **A note on the runner, again.** A full run taken while an analysis agent was
  also running tests reported 45 failures in 425s — *every one* a `TimeoutError`,
  with individual tests at 68–91s that finish in 1–7s idle. Identical to the
  phenomenon 4.8/04 recorded. Nothing here is implicated; re-running on an idle
  machine is green in 70s.
- Live against the dev server on **:3030**:
  - `GET /` → 200, prompt bar intact (`hx-post="/prompt"`, `#spec-build-form`,
    `#spec-build-prompt`), and **zero** occurrences of `demo/spec-build` in the
    served shell.
  - `GET /demo/spec-build` → **404**.
  - `GET /demo/few-shot-gallery` → 200 (the one dev-only survivor).

## HITL — validate the living demo

The dev server should be running on **http://localhost:3030**. If it is not:

```bash
bun run dev
```

**1. The redundant entrance is gone.**

1. Open http://localhost:3030/demo/spec-build directly. You should get a **404**
   — not a stream, not a blank page.
2. Open http://localhost:3030. The page is exactly as before: the prompt bar at
   the bottom, the developer panel down the side. Nothing was removed from the
   shell, because the deleted route never had a button.

**2. The one remaining path still builds.**

3. Type into the **prompt bar**: `I want to keep track of my notes`
4. Press **Make it**.

**What confirms the work:**

- A product-voice line about sorting out whether this is a new place, then the
  build's narration, then the Notes surface swaps into the content area and a
  **Notes** entry appears in the left toolbar. Exactly the flow you already know.
- In the developer panel, every block fills in order: metrics, spec, behavioral
  tests, migration, units, gate, commit. The **metrics** block should show
  `"resolver"` with a `catalogFingerprint` — the proof this went through the
  resolver rather than a hardcoded intent.
- Add a note, then refresh the page. The toolbar rehydrates and the note is
  still there.

**3. A failure still gives you your View back.**

5. With Notes open and showing a note, type something the model will choke on or
   press **Cancel** mid-build.
6. The warm apology appears as the persistent notice **and your Notes View comes
   back underneath it** — the captured View, not a blank fragment. This is the
   4.5/04 restoration the deleted demo copy never received; there is now only one
   path, so it cannot drift again.
