# Per-incarnation read gates and atomic token sets

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.9 — Dependency-safe
permanent capability deletion
(PLAN decision 34 (read side):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The read-token layer deletion drains against.

- Every target route and declared cross-capability query (and later M5
  whole-catalog query and M6 file serve — the interface must accommodate them)
  acquires ownership-validated read tokens for the incarnations it can
  observe.
- An operation acquires its **complete** incarnation token set atomically
  against one gate/catalog snapshot; if any member is missing, stale, or
  closing, it receives no tokens and does not begin. The complete set releases
  in `finally`.
- A per-incarnation read gate supports `active → closing`: closing refuses new
  tokens, waits for tracked readers to release by a fixed deadline, and
  signals cancellation. Failure/timeout before the database point of no return
  reopens the gate in `finally`; boot recovery reopens gates left closing by a
  crash.

## Acceptance criteria

- [ ] Plan acceptance: atomic all-or-nothing multi-incarnation token
      acquisition — a set containing one closing incarnation acquires nothing
      and does not begin
- [ ] Plan acceptance: read-gate drain, timeout, and reopen — closing refuses
      new tokens, drains tracked readers by deadline, reopens in `finally` on
      timeout, and boot recovery reopens a crashed closing gate
- [ ] Token release in `finally` on success, failure, and cancellation;
      ownership-validated (a stale token cannot release another's)
- [ ] Reads uninvolved in any closing gate stay concurrent and unaffected
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not directly user-visible on its own; a dev preview shows per-incarnation gate
state (active/closing, tracked reader count) live while browsing capabilities —
the surface 4.9/02–03 will animate.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/06-read-dependencies-rehydration-and-search-normalization.md
