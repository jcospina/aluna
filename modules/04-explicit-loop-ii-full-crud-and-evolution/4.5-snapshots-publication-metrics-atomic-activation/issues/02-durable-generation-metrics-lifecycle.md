# Durable generation-metrics lifecycle

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.5 — Incarnated
snapshots, publication, metrics, and atomic activation
(PLAN decision 28 (core lifecycle):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The durable generation-metrics row lifecycle around every admitted build.
(Resolution-side admission and the stale-refusal wiring arrive in 4.8; this
issue builds the row lifecycle they finalize into.)

- When a build reservation reaches the head and the coordinator grants the
  active lease, it assigns or confirms the incarnation and creates a durable
  `running` generation row **before the first Builder provider call**. If that
  write fails, Builder work does not start.
- The row is keyed by build id and incarnation, embeds the carried resolver
  measurement (field exists now; populated for real in 4.8), and records
  generated/copied/executed/skipped/absent stage states. It does not duplicate
  a resolution row.
- `lifecycle_status` is the transport/recovery state
  (`running | success | failed | interrupted`); `outcome` is the typed
  terminal reason (`activated`, `no_change`, `stale`, or a typed failure).
- `success/activated` finalizes in the same transaction as pointer activation
  (built in 4.5/03). `success/no_change` finalizes durably under the active
  lease before `done=ok` (the comparison that produces it arrives in 4.6).
  Failure rolls back product changes, then finalizes the row as failed in a
  short independent transaction.
- Startup reconciliation marks stale `running` rows `interrupted`. No metrics
  write occurs after a success commit that could strand a live version without
  its measurement.

## Acceptance criteria

- [x] Ordering pinned by test: no provider call before the durable `running`
      row exists; a failed row write aborts the build before provider work
- [x] Failure path: product changes roll back, row finalizes
      `failed` + typed outcome in its own short transaction
- [x] Kill the process mid-build; boot reconciliation marks the row
      `interrupted` (plan acceptance: recovery of interrupted `running`
      metrics)
- [x] Row keyed by build id + incarnation with stage states
      generated/copied/executed/skipped/absent
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The existing metrics dev preview shows the row moving `running` →
`success`/`failed` across a live homepage build, including an interrupted row
after a forced restart.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/01-staging-manifest-and-atomic-publication.md

## Implementation notes

- Added the compound `(build_id, incarnation_id)` lifecycle store with content-free
  resolver measurements, typed transport/outcome states, semantic per-stage states,
  loud writes, and an additive platform migration.
- Both the queued prompt pipeline and the direct spec-build demo durably admit the
  row before Builder provider construction/calls. Activation and `success/activated`
  share the capability transaction; failures finalize only after rollback in an
  independent short transaction.
- Cancellation, stream disconnect, Gate failure, publication attempt, and activation
  attempt paths retain truthful terminal and stage evidence. Startup migration
  reconciliation changes abandoned `running` rows to `interrupted` idempotently.
- The homepage developer panel now streams the lifecycle row and preloads recent
  rows after boot, so interrupted and terminal evidence survives the connection and
  process that produced it.
- Follow-up quality repair removed the improper file-length suppression: historical
  metrics, lifecycle persistence, and shared schemas now have separate modules, all
  below 500 physical lines. Codex post-edit hooks now resolve and check every file in
  direct and nested multi-file `apply_patch` payloads, backed by a hook regression suite.

## Verification record

- `bun test`: 614 pass, 0 fail, 2 snapshots, 2827 expectations across 60 files.
- `bun run typecheck`: clean.
- `bun run lint`: clean across 213 files.
- `bun run build`: successful production bundle.
- `git diff --check`: clean.
- Existing user-owned `localhost:3030` returned HTTP 200, rendered the Metrics
  lifecycle developer preview, and the live database reported the required compound
  primary key plus durable typed failure rows.

## HITL test

1. Run `bun run dev` if the existing user-owned server is not already running.
2. Open `http://localhost:3030`, expand the developer panel, and submit a unique
   build prompt such as `I want to keep track of garden harvests`.
3. Confirm Metrics lifecycle first shows `lifecycleStatus: running`, then either
   `success` + `activated` or `failed` + a typed outcome, with the reached stages
   marked generated/executed and unreached stages skipped/absent.
4. To exercise recovery, start another unique build, wait until the panel shows
   `running`, stop that server with Ctrl-C, restart `bun run dev`, and reload `/`.
   Confirm the preloaded row now shows `interrupted` + `interrupted`; no capability
   from that interrupted build should be live.
