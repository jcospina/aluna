# Structural & smoke gate rungs on the scratch database

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 step 4,
§9.5, ADR-0004 decision 3, PLAN decision 3 & flow step 6:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The first two always-on rungs of the layered, fail-closed gate. Nothing goes
live until every active rung passes; any rung failing fails the whole build.

- **Structural rung.** Type-check the generated units as a final assertion
  (distinct from the fix loop's in-flight checks — this is the gate's verdict,
  not a repair step), and assert the export shape: exactly one default-exported
  async function per handler (only a concrete skeleton is cheaply assertable —
  ADR-0004).
- **Smoke rung on the scratch database.** Create a throwaway in-memory SQLite
  database by applying the build's own generated DDL (the mapper's
  arbitrary-connection property), hand each handler the **practice toolbox** —
  the same data tool pointed at the scratch database, indistinguishable from
  the real one — and run a synthetic `create` → `read` round-trip. Assert the
  fragment comes back and the row landed. The user's real data is **physically
  unreachable** during validation (ADR-0004: isolation by construction, not
  cleanup) — the property M3's rebuilds over real data will lean on.
- **Ordering + measurement.** Rungs run in order, fail-closed; per-rung outcomes
  and durations are captured for the metrics row.

## Acceptance criteria

- [ ] Rungs run in order; the first failure stops the gate and fails the build
- [ ] The signature assertion catches wrong export shapes (named export,
      non-function, non-async)
- [ ] Smoke executes the real generated handlers against the scratch database
      through the practice toolbox; the handler code is identical either way
- [ ] The real database is untouched by gate execution (asserted, not assumed)
- [ ] Per-rung outcome and duration are captured for metrics
- [ ] Tests cover passing units, a unit broken at each rung, and the
      scratch-isolation property

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/04-unit-generation-with-bounded-fix-loop.md
- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/01-deterministic-spec-to-ddl-mapper.md
- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/02-capability-scoped-data-tool.md
