# Remove the regenerate-all seam; end-to-end engine tracer and matrix battery

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.6 — Additive
evolution and the total Diff Engine
(Epic 4.6 text + decisions 13, 21, 22, 37:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

Close the engine: one evolution path, proven end-to-end.

- Remove 4.5's hand-authored/regenerate-all tracer seam entirely — it is not a
  second evolution path.
- The engine tracer invokes evolution with a known target and a hand-supplied
  resolved intent (resolver classification stays outside until 4.8): the
  “add a due date to my notes and make it stand out in the list” flow —
  candidate → validation → facts (nullable `due_date`, requiredness, item
  dependency/direction, any behavior/error change) → union → DDL → projected
  regeneration with admissibility-gated prior source → copy → staging →
  publication → atomic activation → one complete View swap; existing records
  readable with `null` shown as the platform empty value.
- The consolidated acceptance battery over the whole engine (plan 4.6 text):
  every matrix row, multi-fact unioning, behavior's all-Handler fallback,
  target-row rehydration under evolution (an old explicit `read` projection
  cannot omit the new column), measured zero-diff no-op, and unmapped-fact
  failure — now end-to-end rather than engine-stage-local.

## Acceptance criteria

- [ ] The regenerate-all seam and its dev affordance are deleted; grep-level
      check recorded; the engine is the only evolution path
- [ ] The due-date tracer passes end-to-end with behavioral tier on and off
- [ ] A behavior-neutral additive change proves copied `read`/`search` stay
      byte-identical yet return complete new-column rows (rehydration)
- [ ] End-to-end battery green: all matrix rows, unions, all-Handler behavior
      fallback, zero-diff no-op, unmapped-fact failure
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: run the due-date evolution live on the homepage —
      one View swap, records intact, due date standing out in the list

## Living demo

The dev tracer becomes the near-final evolution surface: pick a capability,
type the intent, watch validation, facts, work plan, Gate, and the single View
swap happen on the real homepage capability.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/04-prior-source-admissibility.md
