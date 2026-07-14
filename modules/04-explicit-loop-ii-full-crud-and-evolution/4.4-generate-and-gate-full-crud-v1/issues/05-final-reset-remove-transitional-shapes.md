# Final greenfield reset: remove the two-Action allowance and the reference fixture

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.4 — Generate and
Gate full-CRUD v1 capabilities
(Approved epic boundaries (4.4 cutover) + decision 16:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The 4.4 steady-state cutover. Run the final greenfield `bun run reset`, then:

- Delete the transitional two-Action allowance everywhere: validators, the
  prompt Builder, routing admission. The prompt Builder/registry admit **only**
  the exact five-Action shape/inventory, with generated (not fixture)
  Handlers.
- Delete the hand-written five-Action reference fixture and any code that
  installed it.
- From this cutover, all five Actions are mandatory and cannot be removed by
  evolution (decision 16); fresh M4 v1 capabilities are fully usable before
  evolution exists.

This is bounded implementation sequencing, not a preservation migration: reset
removes every transitional row/artifact.

## Acceptance criteria

- [ ] Plan acceptance (transitional integrity): after the reset, neither the
      two-Action allowance nor the hand-written reference fixture remains
      admissible **or present** — a two-Action spec is rejected, the fixture
      files/installer are gone
- [ ] Only the exact five-Action shape/inventory validates; an arbitrary
      subset or superset is rejected
- [ ] `bun run reset` + prompt-build produces a fully usable five-Action v1;
      all 4.3 chrome works against it
- [ ] No dead transitional code paths remain (grep-level check recorded in the
      issue)
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

After reset, the homepage holds only generated five-Action capabilities; the
reference capability is gone from the toolbar, and a freshly built capability
does everything it did.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/01-generate-five-handlers-and-item-renderer.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/02-structural-unit-checks-per-action.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/03-always-on-smoke-crud-and-adversarial-search.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/04-behavioral-tier-all-actions-and-stable-errors.md
