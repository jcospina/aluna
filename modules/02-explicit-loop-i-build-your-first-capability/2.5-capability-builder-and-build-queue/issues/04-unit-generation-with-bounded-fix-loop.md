# Unit generation with the bounded fix loop

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.5 — Capability
builder + global serial build queue (`docs/modules.md` §2.5, ARCH §6.2 step 3,
ADR-0003 "bounded tool-loop", ADR-0004 (handler contract, data-free views), PLAN
decision 5 & flow step 5:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The stage that generates the capability's four units from the spec, each through
a bounded type-check fix loop — agentic *within* a unit, deterministic *across*
units (ADR-0003; never a roaming agent).

- **Two handlers** — `create` and `read` — to the ADR-0004 skeleton: one
  default-exported async function receiving the platform-built context (parsed
  input + the capability-scoped data tool) and returning an HTML fragment.
  Generated code contains **no imports, no raw HTTP, no table names** — the
  contract is deliberately nearly unflubbable.
- **Two views** — `list` and `create` — data-free scaffolding per ADR-0004:
  chrome, forms, and HTMX hooks only. The list view's dynamic region loads
  through the capability's `read` action; the create form submits through the
  fixed router convention. Zero user data ever enters a view, which is what
  keeps the version-keyed cache honest.
- **The fix loop** (PLAN decision 5): write → type-check → feed the error back
  → fix, per unit, capped by a config knob (default **2 attempts**). Every
  attempt is recorded for the metrics row. A unit that exhausts its cap fails
  the build cleanly — a broken unit never continues downstream.
- **Measure**: code-gen and HTML-gen durations, tokens, and fix-loop attempts
  per unit, all captured for metrics.

## Acceptance criteria

- [ ] Generated handlers conform to the ADR-0004 skeleton (single default-export
      async function, context in, fragment out; no imports/HTTP/table names)
- [ ] Generated views contain zero user data; dynamic regions load via the
      `read` action and forms target the fixed router convention
- [ ] Type-check failures feed back into regeneration, capped by the config knob
      (default 2); attempts and per-unit timings are recorded
- [ ] An exhausted cap fails the build cleanly — never a committed broken unit
- [ ] Tests with a fake provider cover clean generation, fail-once-then-fix, and
      cap exhaustion; no test calls a real provider

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/02-spec-generation.md
- modules/02-explicit-loop-i-build-your-first-capability/2.2-constrained-data-tool-and-additive-ddl/issues/02-capability-scoped-data-tool.md
