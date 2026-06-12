# Capability-scoped data tool

Status: ready-for-agent

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

- [ ] A tool constructed for capability A cannot read or write capability B's
      table; no API shape accepts a table/capability name after construction
- [ ] `insert` rides the read-write connection; `select` rides the read-only one
- [ ] Round-trip: insert then select returns the row with the platform trio
      populated and `extra` defaulted
- [ ] The same round-trip passes against an in-memory scratch database (the
      practice-toolbox property)
- [ ] Required-field violations surface as clear errors, not silent drops

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/01-deterministic-spec-to-ddl-mapper.md
