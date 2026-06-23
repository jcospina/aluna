# Migration derive & apply in transaction

Status: done

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

- [x] DDL comes from the deterministic mapper only; the stage contains no SQL
      authoring and no AI involvement
- [x] After a successful apply, the capability's table exists with the platform
      trio and the spec's fields
- [x] A failure after apply (simulated gate/commit failure) rolls back and
      leaves the schema with no trace of the build
- [x] Migration duration is captured for metrics
- [x] Tests cover the applied-schema snapshot and the rollback-leaves-no-trace
      property

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/01-deterministic-spec-to-ddl-mapper.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/01-build-job-single-flight-queue-and-busy-refusal.md

## Implementation notes

_2026-06-23 — implemented and verified._

- Added the migration apply stage in
  [`src/builder/migration.ts`](../../../../src/builder/migration.ts), exported
  through [`src/builder/index.ts`](../../../../src/builder/index.ts).
  `applyCapabilityMigration({ database, spec })` delegates DDL derivation and
  application to the deterministic mapper (`applyCapabilityTableDdl`) and returns
  the mapper result, table name, and `durationMs` for the future metrics row.
- Added `withCapabilityMigrationTransaction`, which applies the migration and
  then runs downstream builder work in the same rollback scope. If a later async
  stage throws, the transaction rolls back and the `cap_` table disappears; if
  the continuation completes, the table commits.
- Added the generic async write-transaction helper in
  [`src/db.ts`](../../../../src/db.ts). This is needed because Bun's built-in
  `Database.transaction` helper commits before an awaited continuation settles;
  the builder needs rollback scope to survive later async gate/commit work.
- Added focused tests in
  [`src/builder/migration.test.ts`](../../../../src/builder/migration.test.ts)
  with a snapshot sidecar
  [`src/builder/__snapshots__/migration.test.ts.snap`](../../../../src/builder/__snapshots__/migration.test.ts.snap).
  The tests assert mapper-derived DDL, the applied table's platform trio and
  spec fields, successful commit visibility, duration capture, and the
  rollback-leaves-no-trace property after a simulated gate failure.
- Not wired into `BuildJobQueue` yet. This follows issue 02's boundary: issues
  03-07 add the builder stages, and the later slices assemble them into the real
  prompt pipeline.

### Visual verification path

_2026-06-23 — added after implementation, at the owner's request._

- The home-page prompt-bar demo now runs `spec -> scratch migration` through
  `/demo/spec-build` and streams a `migration-preview` SSE event. The preview
  contains the scratch table name, SQLite `CREATE TABLE` SQL, migration duration,
  and `PRAGMA table_xinfo`-derived columns, so the browser can visually verify
  the DB shape produced by the real mapper/stage.
- The preview intentionally uses a throwaway in-memory SQLite database. It does
  **not** leave a `cap_*` table in `data/omni-crud.db`; the real persistent commit
  remains issue 07, after the full gate and registry row exist.

## Verification

- `bun test --update-snapshots src/builder/migration.test.ts`
- `bun test src/builder/migration.test.ts`
- `bun test`
- `bun run typecheck`
- `bunx biome check src/db.ts src/builder/index.ts src/builder/migration.ts src/builder/migration.test.ts`
- `bun run lint`
- `git diff --check`
- Browser smoke at `http://localhost:3030/`: submitting the prompt streamed
  `spec-preview` and `migration-preview`; the real DB still had no `cap_*` tables
  afterward (`SELECT ... name GLOB 'cap_*'` returned `[]`).
