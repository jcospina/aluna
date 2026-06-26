# Structural & smoke gate rungs on the scratch database

Status: done

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
  cleanup) — the property M4's rebuilds over real data will lean on.
- **Ordering + measurement.** Rungs run in order, fail-closed; per-rung outcomes
  and durations are captured for the metrics row.

## Acceptance criteria

- [x] Rungs run in order; the first failure stops the gate and fails the build
- [x] The signature assertion catches wrong export shapes (named export,
      non-function, non-async)
- [x] Smoke executes the real generated handlers against the scratch database
      through the practice toolbox; the handler code is identical either way
- [x] The real database is untouched by gate execution (asserted, not assumed)
- [x] Per-rung outcome and duration are captured for metrics
- [x] Tests cover passing units, a unit broken at each rung, and the
      scratch-isolation property

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/04-unit-generation-with-bounded-fix-loop.md
- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/01-deterministic-spec-to-ddl-mapper.md
- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/02-capability-scoped-data-tool.md

## Implementation notes

_2026-06-23 — implemented and verified._

- Added the layered gate stage in
  [`src/builder/gate.ts`](../../../../src/builder/gate.ts), exported through
  [`src/builder/index.ts`](../../../../src/builder/index.ts).
  `runCapabilityGate({ spec, ddl, handlers, realDatabase })` runs the always-on
  rungs in order and throws `CapabilityGateError` on the first failure with the
  metrics-ready rung outcomes captured so far.
- The structural rung is a final verdict over the generated handler strings. It
  asserts each M2 handler has exactly one export, and that export is the concrete
  `export default async function` skeleton with one platform-built context
  parameter. It then type-checks both handlers in an isolated TypeScript program
  against the ADR-0004 handler contract.
- The smoke rung applies the migration stage's exact DDL to a shared in-memory
  SQLite scratch database, prepares the already-validated generated `create` and
  `read` handler sources for in-memory execution, injects the practice toolbox
  (`createCapabilityDataTool` pointed at scratch), and runs a synthetic `create`
  -> `read` round-trip. It asserts non-empty fragments and that exactly one typed
  row landed in scratch.
- Real database isolation is asserted when a real database is provided: the gate
  snapshots all `cap_%` tables before and after smoke and fails if any real
  capability data changed. The runtime handler code only receives the scratch
  toolbox during validation. This is the ADR-0004 data-tool isolation guarantee,
  not a process sandbox; ADR-0003 intentionally defers execution sandboxing for
  this single-user local PoC.
- The gate returns per-rung status/duration plus smoke details
  (`tableName`, `rowCount`, fragment lengths, inserted row id, and real-db
  unchanged flag) for the future metrics row.
- Added focused tests in
  [`src/builder/gate.test.ts`](../../../../src/builder/gate.test.ts) covering
  the passing path, named-export/non-function/non-async signature failures,
  structural type-check failure short-circuiting before smoke, smoke failure when
  no row lands, and the scratch-isolation property.
- Wired the homepage builder-stage demo through
  [`/demo/spec-build`](../../../../src/app.ts): after spec, scratch migration,
  and unit generation previews, the demo now runs the gate before the final
  confirmation and streams a developer-only `gate-preview` event. The shell
  displays it in a fourth preview pane
  ([`public/index.html`](../../../../public/index.html),
  [`public/app.js`](../../../../public/app.js)).
- Follow-up from live HITL: `bun --watch` treated dynamically imported temporary
  generated handler files as watched inputs, then restarted the dev server when
  the gate deleted them. That killed the SSE stream after the "checking" narration
  and before `gate-preview`. Smoke execution now transpiles and evaluates the
  already-validated handler source in memory instead of importing temp files.

## Verification

- `bun test src/builder/gate.test.ts`
- `bun test src/app.test.ts`
- `bun run typecheck`
- `bunx biome check src/builder/gate.ts src/builder/gate.test.ts src/builder/index.ts src/app.ts src/app.test.ts public/app.js public/index.html`
- `bun test`
- Browser HITL against `bun --watch` with a fake provider replaying captured
  generated units: fourth gate pane appeared.
- Browser HITL against the real provider after the fix: fourth gate pane appeared
  with `structural:passed` and `smoke:passed`.

## HITL test instructions

1. Run `OMNI_API_KEY=<your key> bun run dev`.
2. Open `http://localhost:3030/` (or the port Bun prints if `PORT` is set).
3. Leave the default prompt or type `I want to keep track of my notes`, then click
   **Make it**.
4. Confirm the page streams product-voice narration, then shows four
   developer-only preview panes: generated spec, scratch migration, generated
   units, and gate.
5. In the gate preview, confirm `rungs` lists `structural` then `smoke`, both
   with `status: "passed"` and `durationMs`, and `smoke` shows `tableName` as
   `"cap_notes"`, `rowCount: 1`, non-zero fragment lengths, and
   `realDatabaseUnchanged: true`.
6. Confirm the final visible message says Aluna has made a place for `Notes`; no
   capability should be committed yet because commit/rollback is the later issue.
