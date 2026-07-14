# Prior-source admissibility for regeneration prompts

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.6 — Additive
evolution and the total Diff Engine
(PLAN decision 21 ¶2: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006)

## What to build

Prior source is optional regeneration context, not an entitlement. Before an
affected Handler or `item.ts` receives its old source in a regeneration
prompt, deterministic admissibility checks must prove that source references
nothing outside the candidate unit's **current** generation contract:

- no inactive or undeclared fields;
- no undeclared dependency data;
- no forbidden platform authority;
- no imports or other context the fresh unit is not allowed to see.

If proof fails, the unit regenerates **without** old source. Positively
unaffected units still copy without entering model context (4.6/03). This rule
prevents stale source from leaking hidden context into generation; it is not a
process sandbox.

## Acceptance criteria

- [ ] Plan acceptance: regenerated prior source is admitted only when it fits
      the candidate unit contract; otherwise generation proceeds without it,
      while copied-unit behavior remains separately proven
- [ ] Test fixtures: old source referencing a now-hidden field, a
      newly-undeclared dependency, and a forbidden platform authority are each
      rejected; clean prior source is admitted verbatim
- [ ] The admissibility decision is recorded per unit (visible in the dev
      preview work plan / metrics stage states)
- [ ] Prompt-content assertion: an inadmissible unit's regeneration prompt
      contains no old source bytes
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The dev tracer's work plan shows, per regenerated unit, whether prior source
was admitted or withheld and why — visible on a hide-then-evolve scenario
against a live capability.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/03-additive-ddl-context-projection-and-unit-copy.md
