# Structural unit checks per Action over the whole snapshot

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.4 — Generate and
Gate full-CRUD v1 capabilities
(PLAN decisions 11 (checks) and 12, epic text:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0004)

## What to build

Extend the Gate's structural/static rung so no generated Handler can bypass
the split toolbox, across the complete five-unit snapshot.

- No Handler can emit raw mutation SQL: canonical writes only through the
  supplied mutation adapters; a mutation attempt through the query port is
  already physically impossible, and the static check rejects the known
  textual/structural bypasses (direct imports, connection access, dynamic
  import) before execution.
- Every Action may use the read-only query interface only over its **declared**
  read-dependency catalog; undeclared table access in generated SQL is
  rejected at the Gate against the same scratch catalog the live adapter
  enforces.
- Structural validation covers the whole snapshot: all five Handlers,
  `item.ts`, and the spec inventory — not just the units that happened to be
  exercised by smoke.
- Generated execution remains in-process; this is accidental-output
  protection, not hostile-code containment (decision 11).

## Acceptance criteria

- [ ] A fixture Handler with raw `INSERT`/`UPDATE`/`DELETE`/DDL fails the
      structural rung with a per-unit, actionable failure
- [ ] A fixture Handler importing anything, touching the connection, or
      querying an undeclared table fails; the same SQL over a declared
      dependency passes
- [ ] The rung runs over every unit of every candidate snapshot regardless of
      which units were regenerated
- [ ] Gate failures repair per-unit within ADR-0003's bounded repair loop
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Not directly user-visible; the dev Gate preview (existing `/demo` Gate surface)
shows the structural rung's pass/fail per unit for the latest build. Note the
rung output there when closing.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/01-generate-five-handlers-and-item-renderer.md
