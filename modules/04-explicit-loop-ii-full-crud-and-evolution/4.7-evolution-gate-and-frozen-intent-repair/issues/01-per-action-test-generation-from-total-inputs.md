# Per-Action behavioral test generation from total inputs

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair
(PLAN decision 23: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006 frozen behavioral intent; ADR-0004 behavioral tier)

## What to build

Behavioral tests generated from total per-Action inputs — **never from Handler
code** — and frozen before any Handler generation or repair.

Each Action's tests are generated independently from: `behavior`, the Action's
`behavioral_errors` plus stable markers, its declared dependency identities,
and this closed schema projection:

| Action | Canonical schema test input |
| --- | --- |
| `create`, `update` | active field name/type/required, excluding labels/order |
| `search` | active `string`/`string[]` field names/types |
| `read`, `delete` | none; canonical-row/delete mechanics stay in always-on smoke |

- Free-text `behavior` is conservatively an input to every Action.
- Current declared active dependency projections are generation context, and
  full physical compatibility schemas are scratch-fixture context; **neither**
  is a versioned equality input.
- A change to a capability's own Action inputs generates those Action tests
  before Handler repair; tests freeze before Handler generation or repair
  begins.

## Acceptance criteria

- [ ] Test generation consumes exactly the closed inputs (pinned by a
      prompt-context test: no Handler source, no labels/order, no inactive
      fields, no full external schemas as equality inputs)
- [ ] A label-only or field-order-only change produces byte-identical test
      inputs (no regeneration); a required/type-relevant change regenerates
      exactly the mapped Actions' tests
- [ ] Generated tests are frozen (content-addressed/digested in the snapshot)
      before any Handler generation or repair starts
- [ ] Tests assert stable markers/codes/Actions/fields, never product wording
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The build story/dev preview shows, per Action, whether tests were generated
(and from which inputs) during a tier-on evolution of a live capability.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/05-remove-tracer-seam-engine-tracer-and-matrix-battery.md
