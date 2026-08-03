# Remove the evolution demo surface and its hand-supplied intent seam

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decisions 10, 30, and 32:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The prompt bar is now the only way a user asks for an evolution. Epic 4.6/05
kept the content-area **Evolve this capability** control and the
`/demo/evolution/*` routes as the near-final surface *until the resolver
existed*, and recorded them as "still temporary, and still owned by 4.8"
(`4.6…/issues/05-remove-tracer-seam-engine-tracer-and-matrix-battery.md`).
Epic 4.8/02 wired `extend_capability` and `ui_change` through the same
`runCapabilityEvolution` engine and the same explicit presenter, so the demo
path is now a second, redundant entrance to a shipped capability. A demo
artifact is not part of the finished product; a demo surface earns its place
only while the real functionality cannot be exercised, and this one no longer
qualifies.

Delete the surface, not the engine.

- **Remove the product-facing control.** `renderEvolutionDemoControl` and its
  call inside `renderCapabilitySurface` (`src/web/fragments.ts`), plus the
  `.capability-evolution*` rules in `public/css/demo.css`. Every capability
  surface currently renders this block; after removal the surface is the
  platform collection scaffolding alone, and the prompt bar carries the whole
  evolution interaction.
- **Remove the routes.** `registerEvolutionTracerRoutes` and
  `src/app/evolution-routes.ts` in full — the `POST /demo/evolution/:id` admit
  route and the `/demo/evolution/build/:id/{cancel,stream}` pair — together
  with their registration in `src/app/app.ts`. `/prompt` and its build stream
  become the single admission path for evolution work, so the parallel job
  queue, admission map, and target re-check in the route module go with it.
- **Remove the guided-repair checkbox and its production wiring.** The
  `force_behavioral_failure` control, the `hardEvolutionHandlerFixture` field
  on `AppDeps`/`ResolvedAppDeps`/`EvolutionTracerDeps`, and
  `resolveHardEvolutionFixture` in `src/app/app.ts`. No composition root ships
  a deliberately weak first pass. The `firstPassHandlerFixture` **injection
  seam** on `RunCapabilityEvolutionInput`/`AssembleEvolutionCandidateInput`
  stays: it is how `src/pipeline/evolution/evolution-frozen-repair.test.ts`
  proves 4.7/04's bounded repair deterministically. Relocate
  `src/pipeline/demo/hard-evolution-fixture.ts` (and its test) to test support
  beside that battery so nothing under `src/pipeline/demo/` remains reachable
  from the app.
- **Remove the hand-supplied intent fallback.** With the resolver as the only
  caller, `resolveEvolutionIntent`'s optional `resolvedIntent` parameter
  becomes required and `handSuppliedEvolutionIntent`
  (`src/builder/evolution/candidate-spec-gen.ts`, exported from
  `src/builder/index.ts`) is deleted along with the tests that only cover it.
  An evolution that reaches the engine without a resolver classification is a
  type error, not a runtime fallback.
- **Re-point the coverage, do not delete it.** `src/app/app.evolution.test.ts`,
  `app.evolution-streaming.test.ts`, `app.evolution.test-support.ts`,
  `app.complete-view-restoration.test.ts`, and `src/web/fragments.test.ts`
  currently drive evolution through the demo route and assert the demo markup.
  The presenter, cancellation, streaming, and View-restoration assertions they
  carry are real behavior and must survive against the `/prompt` path with a
  fake resolver classification.
- **Update the docs that reference the surface.** The guided-repair steps in
  `docs/prd/01-structured-action-owned-behavioral-intent.md` (story 21 and its
  acceptance walkthrough) describe a control that no longer exists; the
  bounded-repair story is now demonstrated by the frozen-repair battery, not by
  a checkbox. Earlier issue files keep their historical HITL text unchanged.

## Acceptance criteria

- [x] No route, template, stylesheet, or composition-root dependency under
      `src/` or `public/` references `/demo/evolution`,
      `capability-evolution`, `force_behavioral_failure`, or
      `hardEvolutionHandlerFixture`
- [x] A capability surface (HTMX toolbar click and a full-page
      `GET /capability/:id`) renders the collection scaffolding with no
      evolution form, and `POST /demo/evolution/:id` returns 404
- [x] Evolution through the prompt bar is unchanged end to end: candidate,
      Diff facts, work plan, Gate, publication, activation, and one View
      `commit`, with the same durable lifecycle row
- [x] Presenter, cancellation, streaming, and complete-View-restoration
      coverage previously driven through `/demo/evolution/*` runs against
      `/prompt` with no loss of assertions
- [x] `handSuppliedEvolutionIntent` is gone and an unresolved evolution intent
      is unrepresentable at the type level
- [x] 4.7/04's bounded repair still has its deterministic battery through the
      retained `firstPassHandlerFixture` test seam
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage loses its second entrance: an active capability shows only its
records surface, and "add a due date and make it stand out in the list" typed
into the prompt bar still evolves it in place with the same foreground story.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.8-resolver-explicit-presenter-and-overlap/issues/02-active-context-classification-and-overlap-naming.md

## Notes

Independent of 4.8/03 and cheaper to land first: removing this path leaves the
explicit presenter with a single caller before 03 splits it from the core
Builder.

## What landed

- `src/app/evolution-routes.ts` — **deleted in full**. With it went the parallel
  build-job queue, the `expected` admission map, and the route's own under-lease
  target re-check. The core Builder's lease-head revalidation
  (`revalidateResolvedRequest`, `core-builder.ts`) already does strictly more:
  the same incarnation + version bindings, *plus* the catalog fingerprint, *plus*
  a durable direct `failed/stale` row the route never wrote.
- `src/web/fragments.ts` — `renderEvolutionDemoControl` gone;
  `renderCapabilitySurface` is now the collection scaffolding inside the active
  marker and nothing else. `public/css/demo.css` lost the
  `.capability-evolution*` block.
- `src/app/app.ts` — `registerEvolutionTracerRoutes`, the
  `hardEvolutionHandlerFixture` field on `AppDeps`/`ResolvedAppDeps`, and
  `resolveHardEvolutionFixture` all removed. The composition root can no longer
  express a deliberately weak first pass.
- `src/pipeline/demo/hard-evolution-fixture.ts` →
  `src/pipeline/evolution/hard-evolution-fixture.test-support.ts` (test moved
  beside it). The `firstPassHandlerFixture` seam stays and is now documented as
  test-only in both `evolution-run.ts` and `evolution-assembly.ts`.
- `handSuppliedEvolutionIntent` deleted from `candidate-spec-gen.ts` and
  `src/builder/index.ts`. The suites that used it as a *fixture* (not as their
  subject) now call `evolutionIntentFor` in
  `builder/evolution/candidate.test-support.ts`; the one test whose subject it
  was is gone with it.
- Coverage re-pointed onto `POST /prompt` → `GET /build/:id/stream`. The new
  `resolvedBy(intent, inner)` helper answers only the resolver's own prompt
  (matched on the exported `INTENT_RESOLVER_PROMPT_PREFIX`) and delegates
  everything else, so each engine provider's recorded `prompts` — and
  `pausingProvider`'s call index — are byte-identical to the demo-route era.
- Docs: PRD story 21 and its acceptance walkthrough now point at the
  frozen-repair battery instead of a checkbox; the module TECHNICAL-GUIDE no
  longer tells the reader evolution runs on a tracer "rather than the homepage".

## Adversarial findings fixed

1. **Warm-404 story lost its user-facing assertion.** The replacement for
   `an unknown capability is a warm 404` asserted only `done === "error"`, so the
   warm copy and the View restoration could both have regressed to nothing
   unnoticed. Now asserts `FAILED_BUILD_NOTICE` narration *and* a restoring
   `fragment` carrying `capability-surface` +
   `data-active-capability-id="journal"`.
2. **Dead parameter on `renderBuildSubscriber`.** Its `paths` override existed
   solely so the demo route could point the subscriber at
   `/demo/evolution/build/:id/{stream,cancel}`. Removed; the two paths are
   inlined.
3. **`onExpiredPendingJob` became production-dead.** Its only production consumer
   was the deleted route's admission-map cleanup. Removed from
   `BuildJobQueueOptions`, along with the test that existed only to exercise it —
   pending-job expiry itself is still pinned by the `missing` assertion.
4. **The type was wider than the contract.** `resolvedIntent` was required but
   typed `IntentClassification`, so a `reject`/`data_query`/`new_capability`
   classification stayed representable and was caught only at runtime — by a
   branch unreachable from the sole production caller. Now narrowed to the new
   `EvolutionIntentClassification` (`extend_capability | ui_change`), which
   deletes half the runtime guard. What survives is the `target_capability` /
   `active.id` pairing check, documented as defence-in-depth for Module 7's
   implicit loop rather than for `/prompt`.
5. **Panel-scoped assertions had been weakened to page-scoped.** The surface test
   again slices the `<aside id="developer-panel">` region and asserts the
   candidate preview lives *inside* it while the content area carries no
   evolution markup.
6. **Two structurally vacuous assertions.** `eventData()` returns `""` for an
   event that never fired, so `expect(eventData(events, "candidate-preview"))
   .toBe("")` could not fail. Both now assert against the emitted event-name
   list.
7. **Magic-string coupling to the resolver prompt.** The fake resolver matched a
   hard-coded `"You are Aluna's Intent Resolver"` in two files. `resolver.ts` now
   exports `INTENT_RESOLVER_PROMPT_PREFIX` and builds its first line from it, so a
   rewording cannot silently stop the fake from matching.
8. **Blank-prompt guard.** The deleted route refused a blank `intent` with a warm
   422; `/prompt`'s input carried no `required` attribute, so after the removal a
   blank submit would reach the resolver and spend a real call. Added `required`
   to `#spec-build-prompt`, which is the same browser-level guard the demo form
   had. See *Deferred* below for what this deliberately does **not** cover.

## Deferred, deliberately

Items 1 and 3 below are now filed as
`issues/09-blank-prompt-refusal-and-vestigial-control-assertion.md`.

- **Server-side blank/whitespace refusal on `/prompt`. → 4.8/09.** `required`
  stops an empty submit in the browser, but a whitespace-only string still passes
  HTML5 validation, and a non-browser POST bypasses it entirely. Adding a server
  422 would change `/prompt`'s response contract — HTMX does not swap a non-2xx by
  default, so a blank submit would silently do nothing on screen — and designing
  that terminal shape is product work this issue did not authorize. Flagged
  rather than guessed at.
- **`src/pipeline/demo/spec-build-demo.ts` still exists and is still reachable**
  from `src/app/app.ts` behind `demoSurfacesEnabled()`. The "nothing under
  `src/pipeline/demo/` remains reachable" phrasing above is about the relocated
  fixture; the spec-build demo is issue 4.8/08's scope, not this one.
- **`src/builder/artifacts/activation.test.ts:184` → 4.8/09.** Splits the commit
  swap on `'<div id="developer-evolution-control"'`, a marker that never existed
  in this tree (it predates the change and was already inert). Left alone here:
  touching it is a separate correctness question about that assertion, not part
  of removing this surface.

## Verification

- `bun run test` — **1044 passed, 0 failed**, both before the review fixes and
  again after them.
- `bun run typecheck`, `bunx biome check src/ public/`, `bun run build`,
  `git diff --check` — all clean.
- **A note on the runner, for whoever hits this next.** The post-fix re-runs at
  the default shard count reported 29–41 failures, *every one* a `TimeoutError`
  and several in files this issue never touched
  (`gate-behavioral-selection.test.ts`, `evolution-assembly.test.ts`,
  `app.spec-build*.test.ts`). Those same tests pass in 0.9–2.4s on an idle
  machine; under load the slowest reached 186s against the runner's 30s
  hang-bound. `scripts/test.ts:34-42` already names this as "the single largest
  source of 'it passes for me' disagreements". Dropping to `--shards=2` on a busy
  machine reproduces the green run. Nothing in this change is implicated — a
  logic fault here cannot time out a gate test that imports none of it.
- `dist/index.js` (production bundle, `NODE_ENV=production`) contains **zero**
  occurrences of `demo/evolution`, `capability-evolution`, or
  `hard-evolution-fixture`.
- Live against the dev server on **:3030**:
  - `GET /` → 200, no evolution-form markers anywhere in the shell.
  - `GET /capability/contacts` (full page) → 200, carrying
    `data-active-capability-id="contacts"`, `hx-get="/capability/contacts/read"`,
    and the developer panel's `spec-candidate-preview` — and none of
    `capability-evolution`, `/demo/evolution/`, `force_behavioral_failure`,
    "Evolve this capability", "Show me the guided repair".
  - `GET /capability/contacts` with `HX-Request: true` → same, fragment form.
  - `POST /demo/evolution/contacts` → **404**.
  - `GET /demo/evolution/build/:id/stream` → **404**.
  - `POST /demo/evolution/build/:id/cancel` → **404**.

## HITL — validate the living demo

The dev server should be running on **http://localhost:3030**. If it is not:

```bash
bun run dev
```

**1. The second entrance is gone.**

1. Open http://localhost:3030 and click any capability in the left toolbar — say
   **Contacts**.
2. Look at the content area. You should see the records surface and *nothing
   else*: no "Evolve this capability" heading, no "Describe a change" field, no
   "Show me the guided repair" checkbox.
3. Reload the page directly at http://localhost:3030/capability/contacts. Same
   result — the form is gone on the full page load too, not just the HTMX swap.

**2. The prompt bar still evolves it, in place.**

4. With Contacts still open, type into the **prompt bar** at the bottom:

   `add a due date and make it stand out in the list`

5. Press **Make it**.

**What confirms the work:**

- The foreground story is the one you already know: a product-voice line while it
  thinks, then the capability's View swaps in place carrying the new field. No
  page navigation, no second form anywhere.
- Your existing contacts are all still there, with the new column empty.
- In the developer panel: the **Evolution candidate** block fills with the
  candidate spec, its change facts, the work plan (which units are regenerated vs
  byte-copied), and the Gate verdict — exactly as it did through the old control.
- The **Lifecycle & committed versions** block ends at
  `lifecycle_status=success`, `outcome=activated`, and the capability's version
  has gone up by one.

**3. The retired routes really are gone.**

6. In a terminal:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3030/demo/evolution/contacts
   ```

   Expect `404`. The route no longer exists; nothing answers it in any
   environment.

**4. The guided repair moved, it did not disappear.**

7. The checkbox is gone, and the bounded-repair story now lives in a
   deterministic battery instead of a click:

   ```bash
   bun test src/pipeline/evolution/evolution-frozen-repair.test.ts
   ```

   It should pass, proving the frozen failing case, the attributed Handler, the
   bounded provider repair, the same-case pass, and the final activation.
