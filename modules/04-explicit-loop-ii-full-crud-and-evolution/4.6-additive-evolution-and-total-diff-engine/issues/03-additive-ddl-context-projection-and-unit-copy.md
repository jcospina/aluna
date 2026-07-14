# Additive DDL, per-unit context projection, and positively-unaffected copy

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.6 — Additive
evolution and the total Diff Engine
(PLAN decisions 21, 2, 12 (ABI) + matrix columns:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006)

## What to build

Turn unioned change facts into executed work:

- **Additive DDL.** A new active field derives a nullable `ADD COLUMN`;
  hide/reactivate performs no destructive DDL (reactivation reuses the original
  column and stored values); existing field types never change in place.
  Platform form/detail/registry/toolbar work follows each fact's matrix
  column.
- **Context projection.** The same matrix projects each unit's generation
  context, so copied units were never exposed to changed facts they are
  claimed not to depend on. Regenerated units receive their Action-projected
  change context; new Handler/test generation sees only each dependency's
  active projection.
- **Copy.** Positively-unaffected units byte-copy into the staging directory
  without entering model context, carrying their original
  dependency-generation provenance forward; regenerated units get fresh
  provenance. Copied units remain governed by the matrix plus their committed
  compatibility contract.
- Full structural + adversarial CRUD/search smoke runs over the **assembled**
  snapshot (copied + regenerated) regardless of which units regenerated;
  design lint runs whenever `item` regenerates.

## Acceptance criteria

- [ ] New-active-field fact produces exactly a nullable `ADD COLUMN` plus the
      matrix's unit selection (`create`, `update`, `search` for text/list,
      item via separate `item.shows` fact); historical rows read back `null`
- [ ] Hide/reactivate: no destructive DDL; reactivated field restores original
      column values
- [ ] Copied units are byte-identical, never entered model context (pinned by
      provider-call assertion), and carry provenance forward; regenerated
      units refresh provenance
- [ ] Provenance alone changes no equality/Diff/cascade outcome (plan
      acceptance: audit-only)
- [ ] Smoke + design lint run over every assembled snapshot per the rule above
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Through the dev tracer: evolve a live capability with a new field — the demo
shows the added column rendering as the platform empty value on historical
records, with unchanged Handlers visibly copied (work plan in the dev preview).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/02-typed-change-facts-total-matrix-and-canonical-noop.md
