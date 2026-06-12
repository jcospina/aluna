# Deterministic spec→DDL mapper

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.2 — Constrained
data tool + additive DDL (`docs/modules.md` §2.2, ARCH §3, §6.3 "Data Tables",
§7 "Writes", ADR-0004 consequences, PLAN decision 8:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

Deterministic platform code — no AI anywhere in it — that maps a validated
capability spec's schema to the `CREATE TABLE` DDL for that capability's data
table. The AI authors the spec; **the platform derives the DDL; the AI never
writes SQL** (ARCH §1 schema ownership, PLAN decision 8).

- **Naming.** Capability tables are prefixed (`cap_<id>`) so they can never
  collide with platform tables.
- **The platform trio on every table**: `id` (primary key), `created_at`
  (uniform across all capability tables — pre-pays M4's NL→SQL catalog), and
  `extra` (the JSON escape-hatch column, present from birth). These are
  platform-owned, never spec fields.
- **Field mapping.** The M2 enum (`string | number | boolean | datetime`) maps
  to SQLite column types, with `required` driving nullability. Anything outside
  the enum is unrepresentable here because the spec shape already rejected it.
- **Additive-only.** Mapper output contains only additive statements — no
  `DROP`, no destructive `RENAME`, ever (ARCH §9.3: structurally incapable of
  AI-caused data loss).
- **Arbitrary connection.** The mapper's output applies to *any* SQLite
  connection — the real database and the gate's throwaway in-memory scratch
  database alike (ADR-0004: the build pipeline must be able to apply its
  generated DDL to an arbitrary connection).

## Acceptance criteria

- [ ] Deterministic: the same spec always produces the same DDL (snapshot-tested)
- [ ] Every generated table carries the `cap_` prefix and the platform trio
- [ ] All four enum types map correctly; `required` maps to NOT NULL handling
- [ ] Output contains only additive statements
- [ ] Applying the same DDL to a file-backed connection and an in-memory scratch
      connection produces identical schemas
- [ ] Tests cover the mapping table, determinism, and the arbitrary-connection
      property

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.1-capability-registry/issues/01-registry-store-and-capability-spec-shape.md
