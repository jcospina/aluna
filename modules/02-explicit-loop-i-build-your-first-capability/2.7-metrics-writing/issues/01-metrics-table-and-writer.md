# Generation-metrics table & writer

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.7 — Metrics
writing (`docs/modules.md` §2.7, ARCH §6.3 "Generation Metrics", §9.6, PLAN flow
step 8: `modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The store the PoC exists to fill: one row per generation, recording what the
*system* did to build itself (distinct from the event log, which is M6's record
of what the *user* did). Latency and capability conclusions come from querying
this, not guessing.

- **An additive platform migration** (through the existing migrations runner)
  creating the generation-metrics table, consistent in style with the existing
  platform tables.
- **Columns per the PLAN's step 8**: timing breakdown (spec-gen, code-gen,
  HTML-gen, test-gen, migration, test-run, total wall-clock), per-rung gate
  outcomes, fix-loop attempts, model, token counts, outcome (success / failure —
  including *which rung* failed; failure is data), and intent classification.
  The test-gen/test-run columns are what let M7 quantify the behavioral tier
  against the no-test baseline.
- **A writer module** producing one complete row per generation, callable with
  partial knowledge: a deflection (classification-only generation, PLAN decision
  6) writes intent + model/tokens with no build timings; a failed build writes
  everything up to the failing rung.

## Acceptance criteria

- [ ] Additive migration via the platform runner; second boot is a clean no-op
- [ ] Columns cover every PLAN step-8 field, including test-gen/test-run timings,
      per-rung outcomes, and fix-loop attempts
- [ ] Writer writes one row per generation; deflection rows (intent only, no
      build timings) are supported
- [ ] Failure rows record which rung failed
- [ ] Writes go through the read-write connection; querying (M7's future surface)
      works through the read-only connection

## Blocked by

None - can start immediately
