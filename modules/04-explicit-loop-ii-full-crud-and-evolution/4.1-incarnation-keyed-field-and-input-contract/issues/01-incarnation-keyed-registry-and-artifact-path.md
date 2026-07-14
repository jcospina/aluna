# Incarnation-keyed registry, artifact path, and loader

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.1 — Incarnation-keyed,
evolution-ready field and input contract
(PLAN decision 25: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0006 §incarnation; ADR-0004 artifact contract)

## What to build

Give every capability lifetime a platform-owned **incarnation**. This is the
M3→M4 cutover slice: it begins with `bun run reset` (greenfield — no
preservation of M3 rows or artifacts, per the no-back-compat rule) and moves the
whole artifact/loader path onto the incarnation key in one step.

- A new capability (v1) receives an opaque platform-generated `incarnation_id`
  at creation. The AI never authors it.
- Registry rows carry the incarnation; generation-metrics rows are keyed by
  build id **and** incarnation.
- Artifacts live under `capabilities/<id>/<incarnation_id>/v<n>/`; the
  capability loader and Bun's dynamic-import cache key on that path immediately
  (this is what later makes delete/recreate safe — a recreated capability can
  never load a cached deleted module).
- The prompt-built explicit loop (resolve → build → Gate → commit swap) keeps
  working end-to-end on the new path.

## Acceptance criteria

- [ ] `bun run reset` performed; no M3-shaped registry row or artifact directory
      remains (transitional-epic integrity: incarnation-keyed loading begins in 4.1)
- [ ] A new capability gets an opaque `incarnation_id`; registry row, artifact
      path, and loader all share it
- [ ] Metrics rows are keyed by build id + incarnation
- [ ] Prompt-building a capability on the homepage works end-to-end and its
      artifacts land at `capabilities/<id>/<incarnation_id>/v1/`
- [ ] Focused tests pin the path layout, registry shape, and loader keying
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The homepage explicit loop is the demo: build a capability by prompt and confirm
it renders and its artifacts/registry row live on the incarnation-keyed path.

## Blocked by

None — can start immediately (this is the first M4 issue).
