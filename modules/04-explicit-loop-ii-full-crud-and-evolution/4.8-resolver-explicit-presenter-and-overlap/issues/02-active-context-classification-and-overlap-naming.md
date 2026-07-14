# Active-capability context, intent classification, and overlap naming

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.8 — Resolver,
explicit presenter, active context, and overlap
(PLAN decisions 10 and 32:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The resolver understands where the user is standing and what kind of change
they are asking for.

- Prompt submission sends the active capability id; the resolver acts on
  `new_capability | extend_capability | ui_change`. Active capability is
  strong context, explicit wording may override it, and exact identity
  collisions remain deterministic.
- **Scope rules (decision 10).** The prompt accepts capability outcomes, not
  implementation steering: users never choose types, migrations, frameworks,
  generated code, CSS tokens, or repair steps. Existing field types do not
  change in place. `ui_change` is limited to capability labels, field labels,
  detail visibility/order, item direction/dependencies, and `feed | grid`;
  data or behavior changes are `extend_capability`. No preview-adjust-approve
  coding loop.
- **Overlap (decision 32).** Overlap resolves to extension of the same
  collection/lifecycle, or a semantically named separate capability for a
  distinct context or lifecycle — its own table, incarnation, artifacts,
  toolbar entry, and versions. Label/id carry the meaningful distinction
  (**Work contacts** / `work_contacts`), never `contacts_2`; `namespace` is
  metrics-only. Narrow the pre-provider duplicate heuristic so semantic
  overlap sees the full registry.
- `reject` and `data_query` never enter the Builder.

## Acceptance criteria

- [ ] Classification tests over a fixture catalog: extend vs new vs ui_change,
      active-context weighting, explicit-wording override, deterministic exact
      collision
- [ ] A ui_change-scoped request never emits data/behavior facts; a data
      request classifies as extend even when phrased cosmetically
- [ ] Module-acceptance case: “track my work contacts separately” beside
      Contacts creates a meaningfully named separate capability, never
      `contacts_2`
- [ ] The narrowed duplicate heuristic no longer short-circuits semantic
      overlap before the provider sees the full registry
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: run module-acceptance prompts 1 (“add a due date…”)
      and 5 (“track my work contacts separately”) live and confirm
      classification and naming

## Living demo

Both acceptance prompts run on the homepage: one extends the active capability
in place, the other lands a new, well-named toolbar entry beside it.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.8-resolver-explicit-presenter-and-overlap/issues/01-non-mutating-prompt-job-and-resolver-separation.md
