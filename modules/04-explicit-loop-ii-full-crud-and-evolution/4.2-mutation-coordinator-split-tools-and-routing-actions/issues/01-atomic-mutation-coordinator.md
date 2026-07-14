# Atomic mutation coordinator: queue tickets and ownership-checked leases

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.2 — Mutation
coordinator, split tools, and complete routing Actions
(PLAN decision 30: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

One mutation coordinator that owns atomic admission for every shared-connection
write, replacing the existing check-then-act build busy flags.

- A resolved build intent gets a FIFO reservation; only the head owns the
  active build lease through success, failure, abort, and presenter teardown.
- Once **any** build reservation exists, short record `create` (and, once they
  exist, `update | delete`) cannot pass it and are refused warm.
- Short platform writes (non-build resolver metrics, Event Log ingestion) wait
  behind it on the same coordinator.
- Reads and search never acquire it and stay concurrent.
- Capability deletion atomically try-acquires only when there is no active
  owner or queued build, and is never queued (the seam 4.9 consumes).
- Direct/demo build paths must use the same coordinator or be removed.
- Reservation expiry/cancellation and active release are distinct operations,
  both ownership-validated and executed in `finally`; presenter teardown is
  bounded; an abandoned prompt job that never becomes a build owns no mutation
  state. Prompt classification stays outside the coordinator.

## Acceptance criteria

- [ ] Build busy flags are gone; all build admission flows through the
      coordinator (no direct/demo bypass — pinned by a test)
- [ ] Race test: a record create attempted while a build reservation exists is
      refused and cannot join or be rolled back with the build transaction
- [ ] Reads/search proceed concurrently during an active build lease
- [ ] Queue/lease expiry, cancellation, and abort all release in `finally` and
      are ownership-validated (a stale ticket cannot release another's lease)
- [ ] Deletion try-acquire refuses when any owner or queued build exists and is
      never queued
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A dev preview surface shows coordinator state (queued tickets, active lease)
during a deliberately slowed build; attempting a record write from a second tab
during that build shows the warm refusal.

## Blocked by

None — can start immediately (independent of the 4.1 field contract).
