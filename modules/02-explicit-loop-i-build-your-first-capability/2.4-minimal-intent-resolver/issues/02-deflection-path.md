# Deflection path

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.4 — Minimal
intent resolver (`docs/modules.md` §2.4, PLAN decision 6 & flow step 2:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`, CONTEXT.md
"Product voice")

## What to build

Wire the resolver in front of the builder, inside the build job, and handle
everything M2 doesn't act on with warmth instead of failure.

- **Classification runs inside the job** (ADR-0002 update): `POST /prompt`
  returns instantly; the resolver call happens on the job's clock and its
  outcome is narrated over the per-build stream.
- **`new_capability` proceeds** into the build pipeline.
- **Everything else deflects**: a warm, product-voice message streamed over the
  same per-build channel, then `done` — nothing built, nothing migrated,
  nothing registered. The deflection should feel like Aluna gently redirecting,
  not erroring (e.g. an `extend_capability` ask gets a friendly "soon" — exact
  copy is product voice, no internals vocabulary, distinct per intent family
  where natural).
- **Duplicates fall out free** (PLAN decision 6): "track my notes" when Notes
  exists classifies as `extend_capability` → deflected. No collision logic, no
  auto-suffixed ids.
- **Every classification is logged to metrics** — acted on or deflected — so
  intent-distribution data accrues from day one and M3/M4 inherit a contract
  that never changes shape, only which intents proceed.

## Acceptance criteria

- [ ] Non-`new_capability` intents stream a warm deflection and close with
      `done`; no registry row, no migration, no artifacts
- [ ] Deflection copy is product voice — no internals vocabulary anywhere
- [ ] Every classification writes a metrics row including the intent type
      (deflections included)
- [ ] The duplicate ask ("track my notes" while Notes exists) deflects via
      `extend_capability` classification
- [ ] The POST never blocks on the AI call — classification is observable only
      through the job's stream
- [ ] Tests with a fake provider cover proceed and deflect paths; no test calls
      a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.4-minimal-intent-resolver/issues/01-full-enum-intent-classification.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/01-build-job-single-flight-queue-and-busy-refusal.md
- modules/02-explicit-loop-i-build-your-first-capability/2.7-metrics-writing/issues/01-metrics-table-and-writer.md
