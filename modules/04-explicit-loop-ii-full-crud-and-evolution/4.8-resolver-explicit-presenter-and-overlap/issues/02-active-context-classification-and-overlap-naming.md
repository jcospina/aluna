# Active-capability context, intent classification, and overlap naming

Status: done

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
  detail visibility/order, item direction/dependencies, `feed | grid`, and
  active `string[]` list input modes; data or behavior changes are
  `extend_capability`. The model chooses comma-separated input only for fields
  whose element semantics are comma-free. No preview-adjust-approve coding loop.
- **Overlap (decision 32).** Overlap resolves to extension of the same
  collection/lifecycle, or a semantically named separate capability for a
  distinct context or lifecycle — its own table, incarnation, artifacts,
  toolbar entry, and versions. Label/id carry the meaningful distinction
  (**Work contacts** / `work_contacts`), never `contacts_2`; `namespace` is
  metrics-only. Narrow the pre-provider duplicate heuristic so semantic
  overlap sees the full registry.
- `reject` and `data_query` never enter the Builder.

## Acceptance criteria

- [x] Classification tests over a fixture catalog: extend vs new vs ui_change,
      active-context weighting, explicit-wording override, deterministic exact
      collision
- [x] A ui_change-scoped request never emits data/behavior facts; a data
      request classifies as extend even when phrased cosmetically
- [x] A request to make a comma-free tags/genres field more compact may classify
      as a list-input ui_change; a quotes/addresses field is never switched to
      comma-separated input merely for compactness
- [x] Module-acceptance case: “track my work contacts separately” beside
      Contacts creates a meaningfully named separate capability, never
      `contacts_2`
- [x] The narrowed duplicate heuristic no longer short-circuits semantic
      overlap before the provider sees the full registry
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean
- [x] **Human sign-off**: run module-acceptance prompts 1 (“add a due date…”)
      and 5 (“track my work contacts separately”) live and confirm
      classification and naming

## Living demo

Both acceptance prompts run on the homepage: one extends the active capability
in place, the other lands a new, well-named toolbar entry beside it.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.8-resolver-explicit-presenter-and-overlap/issues/01-non-mutating-prompt-job-and-resolver-separation.md

## Implementation notes

- The validated active capability now reaches the resolver with content-free
  field type, lifecycle, and list-input-mode context. The homepage acts on
  `extend_capability` and `ui_change` through the existing evolution engine.
- Exact duplicate deflection now requires one unique canonical id/label
  equality. Qualified and ambiguous overlap always reaches the provider with
  the complete registry.
- A separate overlap carries a typed resolver-owned `{ id, label }` proposal
  plus its existing source target. The source is validated before Builder
  admission, the proposal is checked against the catalog, and the Builder must
  return that exact semantic identity before migration or unit work begins.
  The `namespace` term remains confined to resolver/metrics state.
- UI-only evolution fails closed before assembly when its candidate contains
  data or behavior facts. Rejections are durably classified as candidate/spec
  validation, including completed provider usage and drained preview streams.
- Prompt evolution and the existing Evolve control share one explicit terminal
  presenter; `reject` and `data_query` remain non-Builder outcomes.

## Verification record

- `bun test` — 1022 pass, 0 fail across 105 files; 2 snapshots and 4637
  expectations.
- `bun run lint` — 290 files checked, no fixes.
- `bun run typecheck` — server and browser TypeScript builds clean.
- `bun run build` — 337 modules bundled successfully.
- `git diff --check` — clean.
- Independent spec and adversarial reviews reported no remaining blockers after
  missing-target, ambiguous-identity, synonym, preview-order, and durable-cost
  adversaries were repaired.
- Live on the existing `localhost:3030` server, without reset:
  - “add a due date and make it stand out in the list” classified as
    `extend_capability` targeting Contacts, activated Contacts v2 in place, and
    visibly added the Due date input.
  - “track my work contacts separately” classified as a separate overlap
    sourced from Contacts, activated `work_contacts` v1, and added the distinct
    **Work contacts** toolbar entry. Metrics recorded overlap resolution
    `namespace`; no `contacts_2` identity was created.

## HITL test

1. If the user-owned server is not already running, run `bun run dev`.
2. Open `http://localhost:3030/`.
3. Click **Contacts**, then **New Contacts**. Confirm the form includes
   **Due date** and the developer panel lists Contacts live version 2.
4. Click **Work contacts**. Confirm it opens its own empty surface beside
   Contacts and the active capability id/version are `work_contacts` / 1.
5. In the developer panel, confirm the latest Work contacts lifecycle is
   `success` / `activated`, targets `contacts`, records overlap resolution
   `namespace`, and all Gate rungs passed.
