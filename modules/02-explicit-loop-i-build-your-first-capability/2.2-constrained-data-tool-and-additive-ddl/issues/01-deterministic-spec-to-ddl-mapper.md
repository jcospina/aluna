# Deterministic spec→DDL mapper

Status: done

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

- [x] Deterministic: the same spec always produces the same DDL (snapshot-tested)
- [x] Every generated table carries the `cap_` prefix and the platform trio
- [x] All four enum types map correctly; `required` maps to NOT NULL handling
- [x] Output contains only additive statements
- [x] Applying the same DDL to a file-backed connection and an in-memory scratch
      connection produces identical schemas
- [x] Tests cover the mapping table, determinism, and the arbitrary-connection
      property

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.1-capability-registry/issues/01-registry-store-and-capability-spec-shape.md

## Comments

**2026-06-12 — implemented.** The deterministic mapper lives in
[`src/capability-data/ddl.ts`](../../../../src/capability-data/ddl.ts), exported
through [`src/capability-data/index.ts`](../../../../src/capability-data/index.ts).

- `deriveCapabilityTableDdl` validates the incoming capability spec with the
  registry schema, derives the `cap_<id>` table name, emits the platform trio
  first (`id`, `created_at`, `extra`), then maps M2 fields deterministically:
  `string -> TEXT`, `number -> REAL`, `boolean -> INTEGER`, `datetime -> TEXT`.
  Required fields become `NOT NULL`; boolean fields carry a 0/1 check; `extra`
  is JSON-checked text with a `{}` default.
- `applyCapabilityTableDdl` accepts any `bun:sqlite` `Database`, so the same DDL
  path works for the real database and the gate's scratch in-memory database.
  Output is a single additive `CREATE TABLE IF NOT EXISTS ... STRICT` statement;
  no destructive statement path exists in the mapper.
- Tests in
  [`src/capability-data/ddl.test.ts`](../../../../src/capability-data/ddl.test.ts)
  cover the snapshot-pinned DDL, platform trio, type/nullability mapping,
  additive-only output, and identical schema application on file-backed and
  in-memory SQLite connections.

Verification: `bun test` passed (61 tests, 1 snapshot); `bun run typecheck`
passed; touched files passed `bunx biome check`. Full `bun run lint` is blocked
by the unrelated untracked `.codex/hooks/hooks.config.json` formatting issue.
