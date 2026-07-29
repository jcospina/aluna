# Non-mutating prompt job and resolver separation from mutation ownership

Status: done

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

- [x] Plan acceptance: resolver-job vs mutation-ticket separation — a prompt
      job holds no coordinator state until its resolved build intent is
      enqueued; an abandoned prompt job owns no mutation state
- [x] `reject` resolutions complete their stream warm with zero mutation
      admission and (best-effort) an `intent_resolution_metrics` row
- [x] The resolved build request carries catalog revision/fingerprint + target
      expectation; the `running` row embeds the resolver measurement
- [x] Best-effort semantics pinned: completion does not wait on the metrics
      write; a simulated crash loses only the non-admitted row
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Type a nonsense/rejected prompt on the homepage: the stream narrates and ends
warm with no build, no queue entry, and a resolution-metrics row in the dev
preview. A real prompt shows resolver timing attached to its build row.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/05-remove-tracer-seam-engine-tracer-and-matrix-battery.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/02-durable-generation-metrics-lifecycle.md

## Implementation notes

- `POST /prompt` remains synchronous job creation only. The prompt job now retains
  its content-free resolver outcome/measurement, but it does not create a
  coordinator reservation. The build reservation is still created only after a
  `new_capability` resolution.
- Resolver classification and the deterministic duplicate guard now consume the
  same immutable active-registry catalog. Its recursively canonicalized SHA-256
  fingerprint is carried in the resolved build request beside the current
  expected-absent target expectation, and the request crosses the existing
  activation CAS boundary.
- The admitted `running` lifecycle row stores that exact resolver measurement:
  classification, model, duration, token usage, and catalog fingerprint. It does
  not create a second resolver-only row.
- Added additive migration `0009_intent_resolution_metrics` and a strict,
  content-free store keyed by prompt job. Non-build resolution writes use a short
  coordinator platform-write lease, but the stream never awaits it. Contention
  coverage proves `done` arrives while the write is still queued; a deliberately
  lost write affects only this optional row.
- The existing `metrics-preview` SSE surface now shows resolver-only rows for
  rejected/query/deflected prompt jobs. Cancellation outcome is captured once so
  persistence, preview, and terminal `done` cannot disagree across an in-flight
  cancel.
- Exact lease-head target/catalog stale revalidation and direct `failed/stale`
  admission rows remain the owning follow-up issue
  `03-core-builder-presenter-split-and-stale-revalidation.md`; this issue supplies
  its bound request primitive without taking that scope.

## Verification record

- `bun run test --shards=1` — 993 passed, 0 failed across 99 files after
  adversarial repairs.
- `bun run typecheck` — clean.
- `bun run lint` — clean across 278 files.
- `bun run build` — successful production bundle.
- `git diff --check` — clean.
- Focused prompt admission coverage proves abandoned jobs, lost best-effort
  writes, job-memory carry, early and in-flight cancellation consistency, and
  completion before a contended metrics lease.
- Adversarial review found and closed the cancellation-outcome race, then requested
  the contended-write regression; no runtime blockers remain.
- Reused the user-owned `http://localhost:3030/`:
  - `purple semaphore under moonlight` resolved `reject`, ended warm, showed its
    prompt-job resolution row in the developer preview, and persisted only
    `intent_resolution_metrics` (zero lifecycle and legacy generation rows).
  - `I want to keep track of board game sessions` showed a durable `running` row
    with resolver duration/fingerprint, then activated **Board game sessions**;
    its lifecycle row retained that measurement and no resolver-only duplicate.

## HITL test instructions

1. Run `bun run dev` if the user-owned server is not already listening, then open
   `http://localhost:3030/` and open the developer panel with the `</>` button.
2. Enter `purple semaphore under moonlight` in the prompt bar and choose **Make
   it**.
3. Confirm the stream ends with the warm “not quite sure” guidance, no toolbar
   entry or build appears, and **Lifecycle & committed versions** shows an object
   keyed by `promptJobId` whose resolver intent is `reject`, with `durationMs` and
   a `sha256:` catalog fingerprint.
4. Optional deterministic proof with no provider spend:
   `bun test src/app/app.prompt-admission.test.ts
   src/metrics/intent-resolution-store.test.ts
   src/intent-resolver/resolver-catalog.test.ts`.
5. For the admitted companion (real provider calls), enter a fresh capability
   outcome such as `I want to keep track of telescope observations`. Confirm the
   preview first shows `lifecycleStatus: running` with the resolver measurement,
   then `success/activated`; the new capability appears once in the toolbar and no
   separate resolver-only preview replaces its lifecycle row.
