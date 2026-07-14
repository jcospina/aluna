# Split toolbox: scoped mutation adapters and the read-only query port

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.2 — Mutation
coordinator, split tools, and complete routing Actions
(PLAN decision 11: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0004 split injected tools)

## What to build

Split the injected Handler toolbox into constrained mutations and free reads.

- **Mutation authority.** `create` receives mutation authority bound to the
  target capability (update/delete gain record-target binding in 4.2/05).
  These adapters are the only path to canonical writes. Generated Handlers
  choose no table, capability, or record target. Cross-capability rejection
  applies only to mutation.
- **Query port.** Every Action may receive the distinct query interface for
  capability behavior; `read | search` necessarily use it. It accepts arbitrary
  parameterized `SELECT`/joins and is backed exclusively by a **physically
  read-only** SQLite connection. Each call declares a closed ordered result
  descriptor (alias/type); the adapter returns only those aliases, discards
  extra SQL result columns, and fails on missing/duplicate/type-invalid
  declared values — so `SELECT *` can never make a later additive column
  observable to old generated code. A write attempted through the query port
  fails physically.
- Live and scratch adapters satisfy the same interfaces (scratch data arrives
  with the reference capability in 4.2/04).

## Acceptance criteria

- [ ] Cross-capability mutation is unrepresentable through the supplied
      mutation interface (no parameter names another table/capability)
- [ ] A write attempted through the query port fails physically (read-only
      connection), pinned by a test
- [ ] Result descriptors: extra columns discarded; missing, duplicate, or
      type-invalid declared values fail; `SELECT *` returns only declared
      aliases
- [ ] Existing create/read Handlers run through the split adapters; Handlers
      still import nothing (ADR-0004)
- [ ] Gate practice toolbox uses the same split interfaces
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Existing prompt-built capabilities keep working on the homepage through the
split toolbox — same visible behavior, new seams underneath (note this in the
issue when closing; the visible proof is no regression plus the physical
read-only failure in tests).

## Blocked by

None — can start immediately (parallel to 4.1; epic order applies).
