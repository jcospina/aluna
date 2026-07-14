# Non-mutating prompt job and resolver separation from mutation ownership

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decisions 28 (admission) and 30 (classification outside):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0002)

## What to build

Resolution admitted before mutation, never owning it.

- `POST /prompt` creates a non-mutating stream/job ticket and immediately
  returns the subscriber fragment. It owns no mutation lease and may resolve
  to `reject` or (M5) `data_query`; those finish without mutation admission
  and never enter the Builder.
- The resolver reads **one versioned active registry catalog**; the resolved
  build request binds that catalog's revision or canonical fingerprint in
  addition to the target expectation, and carries resolver timing/outcome in
  job memory. Only a resolved build intent enters the mutation queue.
- On lease grant, the coordinator embeds the carried resolver measurement into
  the durable `running` generation row (the 4.5/02 field goes live).
- `reject`/`data_query`, plus cancellation or expiry before an active build
  lease, may write content-free classification/timing/outcome to a separate
  `intent_resolution_metrics` row keyed by prompt job, through a later short
  coordinator platform-write lease. These non-admitted measurements are
  explicitly best-effort: the read/query path and user-visible completion
  never wait, and a crash may lose an unwritten row. No durable-generation
  guarantee is claimed before the active lease.

## Acceptance criteria

- [ ] Plan acceptance: resolver-job vs mutation-ticket separation — a prompt
      job holds no coordinator state until its resolved build intent is
      enqueued; an abandoned prompt job owns no mutation state
- [ ] `reject` resolutions complete their stream warm with zero mutation
      admission and (best-effort) an `intent_resolution_metrics` row
- [ ] The resolved build request carries catalog revision/fingerprint + target
      expectation; the `running` row embeds the resolver measurement
- [ ] Best-effort semantics pinned: completion does not wait on the metrics
      write; a simulated crash loses only the non-admitted row
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Type a nonsense/rejected prompt on the homepage: the stream narrates and ends
warm with no build, no queue entry, and a resolution-metrics row in the dev
preview. A real prompt shows resolver timing attached to its build row.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/05-remove-tracer-seam-engine-tracer-and-matrix-battery.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/02-durable-generation-metrics-lifecycle.md
