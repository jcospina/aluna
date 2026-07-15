# Atomic mutation coordinator: queue tickets and ownership-checked leases

Status: done

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

- [x] Build busy flags are gone; all build admission flows through the
      coordinator (no direct/demo bypass — pinned by a test)
- [x] Race test: a record create attempted while a build reservation exists is
      refused and cannot join or be rolled back with the build transaction
- [x] Reads/search proceed concurrently during an active build lease
- [x] Queue/lease expiry, cancellation, and abort all release in `finally` and
      are ownership-validated (a stale ticket cannot release another's lease)
- [x] Deletion try-acquire refuses when any owner or queued build exists and is
      never queued
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A dev preview surface shows coordinator state (queued tickets, active lease)
during a deliberately slowed build; attempting a record write from a second tab
during that build shows the warm refusal.

## Blocked by

None — can start immediately (independent of the 4.1 field contract).

## Implementation notes

- Added one process-local mutation coordinator with bounded FIFO build
  reservations, ownership-checked active leases, queued short platform writes,
  non-queued record/deletion try-acquires, expiry/cancellation, observable state,
  and `finally`-safe build/platform helpers.
- Removed the prompt job's check-then-act `activeJob` admission flag. Prompt jobs
  are ephemeral and may classify without mutation ownership; only a resolved
  build reserves the coordinator. An abandoned prompt job owns no ticket or
  lease.
- Routed the production resolved-build path and the legacy `/demo/spec-build`
  path through the same coordinator. Non-build resolver metrics use a
  best-effort short platform lease and never delay the user-visible deflection.
- Wrapped activated terminal presentation in a fixed deadline so a disconnected
  presenter cannot retain the active build lease. Failure, abort, reservation
  cancellation, and normal completion all release through ownership-validated
  `finally` paths.
- Wrapped capability `create` in a short record lease. A queued/active build
  returns a structured warm refusal, keeps the form open, preserves entered
  values, and writes no row. `read` bypasses the coordinator and remains live
  during an active build.
- Added `/demo/mutation-coordinator` with live active-lease/FIFO state and a
  deliberately slowed shared-coordinator build. The page links to the real Field
  lifecycle create surface for the second-tab refusal check.
- Added focused regressions for FIFO ordering, reservation expiry/cancellation,
  stale ownership, deletion non-queuing, platform-write waiting, `finally`
  release, presenter timeout, record-create refusal, concurrent reads, abandoned
  prompt jobs, and direct demo bypass.
- Review hardening made one reservation single-claim, kept the production
  `commit | failure -> done` terminal sequence inside the bounded active lease,
  made provider waits abortable so disconnects roll back and release ownership,
  and expires abandoned pre-stream prompt jobs instead of retaining them forever.
  The race regression now holds a real SQLite build transaction open and rolls it
  back after the refused create; the production resolved-build route is also
  pinned to the injected shared coordinator.

## Verification

- `bun test` — 435 pass, 0 fail
- `bun run typecheck` — clean
- `bun run lint` — 148 files clean
- `git diff --check` — clean
- Live browser on the existing `http://localhost:3030`: active build lease was
  visible alongside a second queued FIFO ticket; a Field lifecycle create in a
  second tab showed the warm refusal, preserved every entered value, and wrote no
  record; reloading the capability still read committed records while the lease
  remained active. Closing both build-preview tabs aborted/released the active
  and queued work, leaving an empty coordinator snapshot. The demo was reinstalled
  afterward to restore its baseline data.

## HITL test instructions

1. Run `bun run demo:field-lifecycle`.
2. If the app is not already running, run `bun run dev` and keep the existing
   `http://localhost:3030` server.
3. Open `http://localhost:3030/demo/mutation-coordinator` and click **Hold build
   lease for 15 seconds**. Confirm the Active lease region shows a `build lease`.
   To exercise FIFO visibility too, open the same preview in another tab and
   click its hold button while the first lease is active; both previews show one
   active lease and a queued build ticket.
4. While a build lease is active, open
   `http://localhost:3030/capability/field_lifecycle_demo` in another tab, expand
   **New Field lifecycle**, fill **What happened?** and **Tags**, then click
   **Add**.
5. Confirm the form stays open, all entered values remain, and the warm message
   says: “I'm still putting something together. Give me a moment, then try that
   again.” Reload the capability while the lease is active and confirm committed
   records still render.
6. After the active/queued build leases release, submit the same form again and
   confirm the new record is added normally.
