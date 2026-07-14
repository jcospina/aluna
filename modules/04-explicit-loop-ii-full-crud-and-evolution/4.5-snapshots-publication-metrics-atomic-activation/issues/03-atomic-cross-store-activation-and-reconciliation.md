# Atomic cross-store activation and boot/pre-build reconciliation

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.5 — Incarnated
snapshots, publication, metrics, and atomic activation
(PLAN decision 27: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006)

## What to build

Cross-store activation ordered around one exact point of no return.

- Order: publish the complete final directory first, then — in **one SQLite
  transaction** — apply the additive migration, compare-and-swap the registry
  spec/version/pointer on expected incarnation/version, and finalize the
  metrics row `success/activated`. That commit makes the capability live and
  committed history authoritative; a stale CAS writer fails.
- A database failure before the commit leaves a never-activated complete
  candidate, never a live partial snapshot. A presenter, client, or transport
  failure after it cannot roll back the pointer, relabel the build as failed,
  or restore the prior version; the registry is the recovery authority.
- For an active incarnation at version N, verified `v1..vN` are committed
  immutable history (each `spec.json` authoritative) even though only vN is
  live. Only staging or `v>N` candidates (or directories with no
  active/tombstoned incarnation) may be reconciled, and only after positive
  proof they never activated. Missing/corrupt `v1..vN` is historical
  corruption and fails closed. Historical dependency pairs validate shape and
  digest, not current liveness. Retry may reuse `vN+1` only after its
  never-activated occupant is removed.
- Boot and pre-build reconciliation implement exactly those rules.

## Acceptance criteria

- [ ] Fault injection at every seam (plan acceptance): failure before the
      transaction leaves prior version live and candidate reconcilable;
      failure inside rolls back all three effects together; failure after
      commit leaves the new pointer + `success/activated` authoritative
- [ ] CAS: a stale writer (wrong expected incarnation/version) fails without
      touching the pointer
- [ ] Reconciliation removes only proven never-activated staging/`v>N`;
      committed `v1..vN` retained; missing/corrupt history fails closed with a
      clear error
- [ ] Retry after a failed build reuses `vN+1` only after its occupant is
      removed; no overwrite path exists
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not directly user-visible beyond builds continuing to work; the dev preview
lists committed versions per capability, and the issue notes record a
fault-injection run showing v1 surviving a failed v2 attempt.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/02-durable-generation-metrics-lifecycle.md
