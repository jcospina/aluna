# Capability-scoped data tool

Status: done

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.2 — Constrained
data tool + additive DDL (`docs/modules.md` §2.2, ARCH §3, §7 "Writes", ADR-0004
"injected toolbox", PLAN decision 2:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The constrained data tool a generated handler receives — the write half of
"mutation constrained, reads free" (ARCH §3), scoped **by construction, not
convention** (ADR-0004).

- **Scoped at construction.** A tool instance is built *for one capability*; its
  `insert` and `select` physically cannot address another capability's table.
  No method on the call surface accepts a table or capability name — a Notes
  handler must be unable to write to Recipes even when the generated code is
  wrong (ADR-0004 "safety under model confusion").
- **The constrained split.** `insert` goes through the read-write connection
  (the platform's only write path); `select` goes through the read-only
  connection. Canonical state only ever moves through this tool — incidental
  I/O inside a handler stays the handler's business (ARCH §7).
- **Values.** Spec fields plus the `extra` JSON escape hatch; the platform trio
  (`id`, `created_at`) is populated by the platform, not by callers.
- **The practice toolbox.** The tool must be constructible against an arbitrary
  database pair, so the gate can hand a handler the *same* tool pointed at the
  scratch database — the handler can't tell the difference (ADR-0004 decision 3).

## Acceptance criteria

- [x] A tool constructed for capability A cannot read or write capability B's
      table; no API shape accepts a table/capability name after construction
- [x] `insert` rides the read-write connection; `select` rides the read-only one
- [x] Round-trip: insert then select returns the row with the platform trio
      populated and `extra` defaulted
- [x] The same round-trip passes against an in-memory scratch database (the
      practice-toolbox property)
- [x] Required-field violations surface as clear errors, not silent drops

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/01-deterministic-spec-to-ddl-mapper.md

## Comments

**2026-06-12 — implemented.** The capability-scoped data tool lives in
[`src/capability-data/tool.ts`](../../../../src/capability-data/tool.ts), exported
through [`src/capability-data/index.ts`](../../../../src/capability-data/index.ts).

- `createCapabilityDataTool(spec, databases)` validates the capability spec,
  derives the `cap_<id>` table through the deterministic DDL path, then closes
  over that table name. The public surface is only `insert(values)` and
  `select()`: no table name, capability name, or raw SQL entry point exists on
  the injected handler tool.
- `insert` uses only the injected read-write connection. It accepts spec fields
  plus optional `extra`, generates `id` in platform code, lets SQLite populate
  `created_at` and default `extra`, and returns normalized row values.
- `select` uses only the injected read-only connection and normalizes rows back
  into handler-friendly values (`boolean` fields as booleans, `extra` as a JSON
  object).
- Insert validation fails before SQLite for platform-populated columns,
  unknown fields, missing required fields, bad field types, and non-JSON
  `extra` values. That keeps handler mistakes loud and local, which is the
  long-term contract ADR-0004 needs for generated code and scratch-gate reuse.
- Tests in
  [`src/capability-data/tool.test.ts`](../../../../src/capability-data/tool.test.ts)
  cover capability isolation, method surface shape, RW/RO split, round-trip
  defaults, explicit `extra`, shared in-memory scratch databases, and clear
  required-field failures.

Verification: `bun test src/capability-data/tool.test.ts` passed; `bun test`
passed (70 tests, 1 snapshot); `bun run typecheck` passed; `bun run lint`
passed.
