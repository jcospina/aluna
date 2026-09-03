# The query worker opens its own read-only connection, and a write through it still fails

Status: ready-for-agent

## Epic

Module 6 — Reads Set Free · Epic 6.2 — The ephemeral whole-catalog read
(PLAN decisions 6, 7; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A Worker that holds its own `SQLITE_OPEN_READONLY` connection to the one
documented database file (`DB_PATH`, `data/omni-crud.db`) and executes one
parameterized read at a time on behalf of the main thread. Nothing calls it from
a prompt yet; this issue is the seam and the proof that the seam survived the
move.

**Why it moves off the main thread at all.** `bun:sqlite` is synchronous and
`src/platform/persistence/db.ts` opens on the main thread, so a clumsy join
across three capabilities would block the event loop for its whole duration —
no request served, no stream advancing, the desk frozen — while returning a
single row that no result-size bound could ever catch. Decision 7 admits the
worker; this issue is what makes the admission true in the repo rather than in a
measurement.

**The move is admissible only because the safety seam survives it**, so the two
facts decision 7 measured on Bun 1.3.12 become tests here, not prose:

- a write attempted through the worker's connection fails at the SQLite seam with
  *attempt to write a readonly database* — decision 6's blast radius is zero by
  construction, and it is still zero one thread away;
- the main thread stays live while the worker runs a pathological query. Decision
  7's measurement was 39 ticks against an expected 40 during two seconds of a
  runaway recursive query; the test asserts liveness, not that exact number.

**The worker is whole-catalog, and that is a different shape from a generated
Handler's read.** `query.records` in `src/runtime/data/access/query-runtime.ts`
requires a target capability scope and produces records to present. A question
crosses capabilities and returns aggregates, so this tool returns rows, not
record handles, and does not borrow the per-capability scoped record path.

**The worker holds no ownership.** It never receives a read token, never learns
which incarnations it is reading, and never decides whether a read is allowed —
that all stays on the main thread and lands in 6.2/02 (decision 11). The worker
is only where SQL executes.

## Acceptance criteria

- [ ] A Worker opens a read-only connection against the one documented database
      file and returns rows for a parameterized statement issued from the main
      thread
- [ ] A write attempted through that connection fails at the SQLite seam, proved
      by test rather than asserted in a comment
- [ ] The main thread remains responsive while the worker runs a pathological
      query, proved by a test that fails if the query runs in-process
- [ ] The worker receives no read token and no incarnation identity
- [ ] Nothing the worker does creates registry, version, artifact, cache or
      `read_dependencies` state
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. Nothing on the desk changes and nothing new is reachable from a prompt:
the module becomes visible in 6.5, which is stated up front in the plan's epic
order rather than discovered late. Exercise it with a focused run of this issue's
tests, and read the liveness assertion — it is the one that would have caught a
frozen desk.

Epic 6.1 is independent of this branch and does not gate it; a collection count
and a query worker share nothing.
