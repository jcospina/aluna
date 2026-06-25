# Generation-metrics table & writer

Status: done

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

- [x] Additive migration via the platform runner; second boot is a clean no-op
- [x] Columns cover every PLAN step-8 field, including test-gen/test-run timings,
      per-rung outcomes, and fix-loop attempts
- [x] Writer writes one row per generation; deflection rows (intent only, no
      build timings) are supported
- [x] Failure rows record which rung failed
- [x] Writes go through the read-write connection; querying (M7's future surface)
      works through the read-only connection

## Blocked by

None - can start immediately

## Implementation notes

- **Migration** `0004_generation_metrics` appended to the ordered list in
  [src/migrations.ts](../../../../src/migrations.ts), additive and `STRICT`, in
  the same style as the registry migration. Creates `generation_metrics` with 23
  columns: identity (`id` PK, `created_at` defaulted via `datetime('now')`),
  `outcome`, `capability_id`, the intent classification (`intent_type`,
  `intent_confidence`, `intent_target_capability`), `model`, the three token
  counts, the seven PLAN step-8 timing columns (`spec_gen_ms`, `migration_ms`,
  `code_gen_ms`, `html_gen_ms`, `test_gen_ms`, `test_run_ms`, `total_ms`),
  `gate_rungs` + `unit_attempts` (JSON), and the failure trio (`failed_stage`,
  `failed_rung`, `failed_message`). Every build column past identity/intent/model
  is nullable so partial-knowledge writes store absence as NULL, never a zero.
- **Writer/reader** in [src/metrics/store.ts](../../../../src/metrics/store.ts)
  (barrel [src/metrics/index.ts](../../../../src/metrics/index.ts)):
  `writeGenerationMetrics` validates the row with Zod and inserts through `db`
  (read-write); `getGenerationMetrics` / `listGenerationMetrics` read through
  `dbReadonly` and re-validate on the way out (the registry's in-and-out
  discipline). Optional `timings` / `gateRungs` / `unitAttempts` / `failure`
  groups make the writer callable with partial knowledge (deflection = intent +
  tokens only; failed build = everything up to the failing rung). `sumTokenUsage`
  aggregates per-stage usage into the row's single total, keeping a figure
  `undefined` (→ NULL) unless a call reported it.
- **Living demo**: the homepage prompt bar's `/demo/spec-build` stream
  ([src/app.ts](../../../../src/app.ts)) now writes one metrics row per run
  through an injected `recordMetrics` dep (default = real writer on `db`):
  `success` after the gate passes (before `done`), or `failure` with the failing
  stage/rung on a thrown build error. Tests inject a capturing recorder so the
  wiring is asserted without touching the real data file.

## Verification

- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun test` — 138 pass / 0 fail (new: `src/metrics/store.test.ts`, plus
  demo metrics assertions in `src/app.test.ts` and the platform-table-set update
  in `src/migrations.test.ts`)
- Boot twice in a temp dir: first boot logs `applied 4 migration(s): … ,
  0004_generation_metrics`; second boot logs no `applied` line (clean no-op); a
  read-only connection lists all 23 `generation_metrics` columns and `SELECT
  count(*)` succeeds.

## HITL test instructions

1. Start the app: `bun run dev`
2. Open `http://localhost:3030/`
3. In the prompt bar, type e.g. `I want to keep track of my notes` and click
   **Make it** (drives `GET /demo/spec-build`). Watch it narrate, preview the
   spec/migration/units/gate, and confirm with the warm "All set — I've made a
   place for your …" line.
4. Confirm the metrics row was written (read-only query):
   `bun -e 'import {Database} from "bun:sqlite"; const d=new Database("data/omni-crud.db",{readonly:true}); console.log(d.query("SELECT id, outcome, capability_id, intent_type, total_ms, test_gen_ms, test_run_ms FROM generation_metrics ORDER BY created_at DESC LIMIT 1").get());'`
   — expect one row with `outcome: "success"`, the built `capability_id`,
   `intent_type: "new_capability"`, and non-null timing fields.
5. Developer-only: the server console logs `Aluna spec-build demo: generated
   "<id>" in <ms>ms` with the usage/spec/units/gate breakdown that feeds the row.
   A failing build (or missing `OMNI_API_KEY`) streams the warm apology and, when
   a build actually started, writes a `failure` row naming the rung instead.
