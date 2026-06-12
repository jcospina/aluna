# Behavioral tier (default ON)

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 step 4 +
"why the behavioral rung is a tier", §9.5, PLAN decision 5:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The third gate rung — the one that lifts "validated" from *compiles and runs* to
*behaves as specified* (SelfEvolve's TDD checkpoint, adapted to the CRUD domain).

- **Independence is the point.** Behavioral tests are generated from the spec's
  `behavior` field — from the stated intent, **never** from the handler code. A
  passing test is evidence the logic does what was asked, not merely that it
  agrees with itself (ARCH §2). Handler code must not appear anywhere in the
  test-generation input.
- **Execution** runs the generated tests against the capability on the scratch
  database through the practice toolbox — same isolation as the smoke rung;
  user data physically unreachable.
- **Failure fails the build** in M2: friendly product-voice message, nothing
  committed. The retry-the-affected-unit loop is deliberately M3 (epic 3.5) —
  do not build it here.
- **The tier is a global toggle, default ON** (PLAN decision 5). OFF exists
  *only* to measure the no-test baseline — "how much worse it got" — never as a
  working mode. When OFF, generation and execution are skipped and the metrics
  row records the tier as off, so M7 can compare the two runs.
- **Measure**: test-gen and test-run durations, tokens, and outcomes captured
  for the metrics row — these columns are the entire point of the tier being a
  toggle (ARCH §6.2).

## Acceptance criteria

- [ ] Test generation consumes the spec's `behavior` + schema only; handler code
      never enters the test-gen input
- [ ] Tests execute on the scratch database; a behavioral failure fails the
      build with nothing committed and no retry loop
- [ ] Global toggle defaults ON; OFF skips generation + execution and records
      the tier as off in metrics
- [ ] test-gen and test-run durations and outcomes are captured for metrics
- [ ] Tests with a fake provider: a behavior-violating handler fails the rung, a
      conforming one passes, toggle-off skips cleanly; no test calls a real
      provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/05-structural-and-smoke-gate-on-scratch-db.md
