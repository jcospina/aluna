# Test copy/run selection and the full-suite fallback

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair
(PLAN decision 23 (execution): `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006)

## What to build

Separate test **generation** from test **execution**: execution follows
executable impact.

- Only unchanged test inputs copy prior tier-on tests byte-for-byte.
- Copied tests **run** whenever a Handler they cover regenerates. If a valid
  test's Handler coverage or runtime failure attribution cannot be narrowed,
  the full frozen suite runs. Only when no covered Handler changes may copied
  tests skip execution.
- Execution results land in the metrics stage states
  (generated/copied/executed/skipped) and the snapshot's tier metadata.

## Acceptance criteria

- [ ] Unchanged inputs + no covered Handler change → tests copy and skip
      execution (pinned: no test process spawned)
- [ ] Unchanged inputs + a covered Handler regenerates → the copied tests run
      (plan acceptance: rerun of copied tests after Handler impact)
- [ ] Non-narrowable coverage/attribution → the complete frozen suite runs
- [ ] Copied tests are byte-identical to their frozen originals; a mutated
      copy fails snapshot verification
- [ ] Metrics stage states reflect copy/run/skip accurately per Action
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The build story/dev preview for a tier-on evolution shows which Action suites
were copied, which executed, and why (impact vs full-suite fallback) — e.g. a
behavior change visibly runs everything while an item-only change runs none.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.7-evolution-gate-and-frozen-intent-repair/issues/01-per-action-test-generation-from-total-inputs.md
