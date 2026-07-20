# Final greenfield reset: remove the two-Action allowance and the reference fixture

Status: done

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

- [x] Plan acceptance (transitional integrity): after the reset, neither the
      two-Action allowance nor the hand-written reference fixture remains
      admissible **or present** — a two-Action spec is rejected, the fixture
      files/installer are gone
- [x] Only the exact five-Action shape/inventory validates; an arbitrary
      subset or superset is rejected
- [x] `bun run reset` + prompt-build produces a fully usable five-Action v1;
      all 4.3 chrome works against it
- [x] No dead transitional code paths remain (grep-level check recorded in the
      issue)
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Verification record

Grep-level dead-transitional-code check (all in `src/`/`scripts/`, non-test):

- `TRANSITIONAL_CAPABILITY_TOOLS | transitionalReadDependencies |
  TransitionalHandlerUnitName | TRANSITIONAL_ARTIFACT_INVENTORY` → none
- `field_lifecycle | five-action-reference | installFieldLifecycle |
  journal_links_demo` → none (`src/demo/` and
  `scripts/install-field-lifecycle-demo.ts` deleted)
- `isFullCrudSpec` and the two-Action behavioral/smoke branches → none; all
  gate rungs drive the mandatory five-Action inventory
- `five-action-fixture.test-support` → none; gate tests assemble generated
  Handler units from the same generated-unit contract used by the Builder

Validator now admits only the exact ordered five-Action `tools` and the
complete five-key `read_dependencies`; a two-Action spec, and any
subset/superset/misordering, is rejected (`registry/spec.behavior.test.ts`).
`bun run reset` runs clean; the post-reset homepage is cold-start (empty
toolbar, no reference capability), the registry contains zero capabilities,
and `capabilities/` contains only its README. The app build test drives a newly
generated five-Action capability end-to-end through view chrome (create form,
search chrome, records region), create, read, search (hit + miss), update
(persisted), and delete (gone). The removed reference installer has a regression
test proving `POST /demo/five-action-reference/install` returns 404.

Final integrity verification on Bun 1.3.12:

- `bun test` → 577 pass, 0 fail across 56 files, 2 snapshots
- `bun run typecheck` → clean
- `bun run lint` → 201 files checked, no findings
- `bun run build` → clean
- `git diff --check` → clean
- Gate review additionally proves final repaired renderer bytes re-enter smoke,
  every declared item field affects perceivable output, create/update return
  presentation-adapter bytes, update covers each active field independently,
  and authored search ordering receives non-vacuous behavioral proof.

## Living demo

After reset, the homepage holds only generated five-Action capabilities; the
reference capability is gone from the toolbar, and a freshly built capability
does everything it did.

## HITL test instructions

1. Keep the existing app on port 3030 running; if needed, run `bun run dev`.
   Do not reset: the current **Reading log** is the prompt-built post-reset
   acceptance capability.
2. Open `http://localhost:3030/capability/reading_log` and confirm the toolbar
   exposes Search and **New Reading log** with no reference capability present.
3. Create a book, search for it, open and update it, then delete it. Confirm the
   records region refreshes after each mutation, the search hit/miss states are
   visible, and the deleted record stays gone.
4. Refresh the page and confirm the generated capability remains usable and no
   reference-fixture installer or reference capability appears.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/01-generate-five-handlers-and-item-renderer.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/02-structural-unit-checks-per-action.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/03-always-on-smoke-crud-and-adversarial-search.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/04-behavioral-tier-all-actions-and-stable-errors.md
