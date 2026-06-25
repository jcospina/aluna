# Commit & rollback

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 step 5,
§9.5, PLAN flow steps 7–8 & failure path:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The pipeline's terminal stage — the atomic moment a build becomes real, and the
clean exit when it doesn't.

- **Commit = one pointer flip.** Write the version-1 artifacts (handler files +
  views) to the capability's version directory, insert the registry row pointing
  at it, and flip the pointer as a single atomic step. Then hand the commit
  fragments to the job's stream — the client-side swap (content area + toolbar
  out-of-band) is epic 2.6's issue; this issue produces a committed capability
  and the stream events that announce it, ending with `done`.
- **Commit is unreachable unless the full gate passed.** With the behavioral
  tier ON by default, that means structural, smoke, *and* behavioral rungs —
  fail-closed end to end (owner's decision: commit is blocked behind the
  behavioral tier issue, so no intermediate state ever commits on a partial
  gate).
- **Rollback on any failure**, at any stage: roll back the migration
  transaction, orphan any written files for GC (never half-register them),
  leave **nothing** in the registry, stream a warm product-voice apology, and
  close with `done`. A failed build never creates a capability and never bumps
  a version.
- **Metrics either way.** The build's metrics row is written **before the job
  ends** on both success and failure — failure is data (ARCH §9.6).

## Acceptance criteria

- [x] A successful build leaves artifacts in the version directory, a registry
      row at version 1 with the artifacts pointer, and a capability immediately
      usable through the router
- [x] Commit cannot be reached with any active gate rung unpassed (behavioral
      tier ON by default included)
- [x] Any failure rolls back the migration, orphans files harmlessly, leaves no
      registry row, and streams a warm apology before `done`
- [x] The metrics row is written before the job ends on both outcomes, complete
      per the metrics schema (timings, rungs, attempts, tokens, outcome)
- [x] An end-to-end test with a fake provider goes prompt → committed capability
      → create/read through the router; no test calls a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/03-migration-derive-and-apply.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/05-structural-and-smoke-gate-on-scratch-db.md
- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/06-behavioral-tier.md
- modules/02-explicit-loop-i-build-your-first-capability/2.7-metrics-writing/issues/01-metrics-table-and-writer.md

## Implementation notes

- **Commit stage** — new `src/builder/commit.ts` (`commitCapability`). It writes
  the version-1 artifacts (handler `.ts` + view `.html` files) to
  `capabilities/<id>/v1/`, then inserts the registry row pointing at it
  (`artifacts_path`, version 1) **inside the caller's open transaction**. For a
  brand-new capability the insert *is* the pointer flip: the `cap_<id>` table (made
  by the migration in the same transaction) and the row become real together at
  COMMIT. Files are written before the insert, so a failed insert leaves them
  orphaned, never half-registered. Exported through `src/builder/index.ts`.
- **One transaction, migration → commit** — `src/app.ts` `runSpecBuildStages` now
  runs migration, unit-gen, the fail-closed gate, and commit inside one
  `withCapabilityMigrationTransaction` on the **real** read-write connection
  (db.ts's helper, built for exactly this). Any throw — a failed gate rung, a
  commit collision, a mid-build abort — rolls the whole thing back: no `cap_<id>`
  table, no registry row, files orphaned for GC. Commit is sequenced strictly
  after `runCapabilityGate`, so it is unreachable unless every active rung (incl.
  behavioral, ON by default) passed.
- **Injectable build target** — `AppDeps` gains `buildDatabases` (the rw/ro pair
  the migration/gate/commit ride; defaults to the platform singletons) and
  `artifactsRoot` (defaults to `capabilities/`). Tests inject a scratch db pair +
  temp dir and hand the same pair to the router, so a committed build is routable
  without touching the real data file or the tracked `capabilities/` tree.
- **Stream events** — after the transaction commits, the build streams a
  developer-facing `commit-preview` (committed id, version, pointer, files) then
  the warm product-voice `fragment` confirmation, then `done: ok`. The client-side
  content/toolbar oob swap is deferred to Epic 2.6 as the issue specifies.
- **Metrics both ways** — the metrics row is written before `done` on success
  (outcome `success`, capability id, full timings/rungs/attempts) and on failure
  (`classifyDemoFailure` now distinguishes a `commit`-stage failure from a `gate`
  failure once the gate's rungs are recorded). Aborts write nothing (the
  transaction rolled back, the client is gone).
- **Living demo** — the homepage demo (`/demo/spec-build`) now commits for real;
  `public/index.html` + `public/app.js` gained a `#spec-commit-preview` region
  that shows the commit payload. The migration preview's `kind` changed from
  `scratch-migration-preview` to `migration-preview` (it now reads the real,
  in-transaction table, not a throwaway `:memory:` db).

## Verification

- `bun test` — full suite (143 pass). Focused: `bun test src/builder/commit.test.ts`
  (commit unit: success / rollback-orphans-files / duplicate-id) and
  `bun test src/app.test.ts` (E2E: prompt → committed capability → create/read
  through the router with a fake provider; gate-failure and commit-failure
  rollback; metrics on both outcomes). No test calls a real provider.
- `bun run typecheck` and `bunx biome check src public` are clean.

## HITL test instructions

1. `bun run dev` (set `OMNI_API_KEY` for the configured provider — the build calls
   the real model).
2. Open `http://localhost:3000/` (or the port printed in the log).
3. Type a prompt such as *"I want to keep track of my notes"* and click **Make it**.
4. Confirm: the previews fill in (spec → migration → units → gate → **commit**),
   the `#spec-commit-preview` block shows the committed `capabilityId`, `version: 1`,
   the `artifactsPath`, and the four files, and the output ends with the warm
   "All set — I've made a place for your Notes." confirmation.
5. Confirm the capability is live through the router (the swap UI is Epic 2.6):
   - `curl -s -X POST http://localhost:3000/capability/notes/create -d 'text=Buy milk'`
     → returns an HTML fragment containing "Buy milk".
   - `curl -s http://localhost:3000/capability/notes/read` → fragment listing the note.
   - On disk: `capabilities/notes/v1/` holds `create.ts`, `read.ts`, `list.html`,
     `create.html`.
6. Failure path: a build whose gate fails (or a colliding id) streams "Hmm, that
   didn't work. Mind trying again?" and `done: error`, writes **no** registry row /
   `cap_notes` table / artifacts, and records a failure metrics row (developer-only
   `build-error-preview` carries the diagnostic).
