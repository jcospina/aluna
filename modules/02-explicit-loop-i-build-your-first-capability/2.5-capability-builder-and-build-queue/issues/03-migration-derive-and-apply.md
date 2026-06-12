# Migration derive & apply in transaction

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 step 2,
§9.3, PLAN flow steps 4 & failure path:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The pipeline stage that gives the new capability its data table: derive the DDL
**deterministically** from the generated spec via the spec→DDL mapper (epic 2.2)
and apply it additively inside a transaction the build can still roll back. The
platform owns schema; no AI-generated SQL exists anywhere on this path.

- **Derive** through the mapper only — the stage adds no SQL of its own.
- **Apply additively** within the build's transaction scope, so that any later
  failure (a gate rung, a generation error, a crash) rolls the migration back
  and leaves the database exactly as it was: no `cap_` table, no trace (PLAN:
  "on any failure: roll back the migration transaction"). The exact transaction
  mechanics are implementation detail — what is fixed is the observable
  contract: *a failed build leaves no schema behind; only a committed build
  does*.
- **Measure**: migration duration is captured for the build's metrics row.

## Acceptance criteria

- [ ] DDL comes from the deterministic mapper only; the stage contains no SQL
      authoring and no AI involvement
- [ ] After a successful apply, the capability's table exists with the platform
      trio and the spec's fields
- [ ] A failure after apply (simulated gate/commit failure) rolls back and
      leaves the schema with no trace of the build
- [ ] Migration duration is captured for metrics
- [ ] Tests cover the applied-schema snapshot and the rollback-leaves-no-trace
      property

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/01-deterministic-spec-to-ddl-mapper.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/01-build-job-single-flight-queue-and-busy-refusal.md
