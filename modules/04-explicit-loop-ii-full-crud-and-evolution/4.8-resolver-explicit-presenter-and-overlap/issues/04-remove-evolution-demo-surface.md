# Remove the evolution demo surface and its hand-supplied intent seam

Status: ready-for-agent

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

- [ ] No route, template, stylesheet, or composition-root dependency under
      `src/` or `public/` references `/demo/evolution`,
      `capability-evolution`, `force_behavioral_failure`, or
      `hardEvolutionHandlerFixture`
- [ ] A capability surface (HTMX toolbar click and a full-page
      `GET /capability/:id`) renders the collection scaffolding with no
      evolution form, and `POST /demo/evolution/:id` returns 404
- [ ] Evolution through the prompt bar is unchanged end to end: candidate,
      Diff facts, work plan, Gate, publication, activation, and one View
      `commit`, with the same durable lifecycle row
- [ ] Presenter, cancellation, streaming, and complete-View-restoration
      coverage previously driven through `/demo/evolution/*` runs against
      `/prompt` with no loss of assertions
- [ ] `handSuppliedEvolutionIntent` is gone and an unresolved evolution intent
      is unrepresentable at the type level
- [ ] 4.7/04's bounded repair still has its deterministic battery through the
      retained `firstPassHandlerFixture` test seam
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

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
