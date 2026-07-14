# Candidate-spec generation and validation with the lifecycle and dependency catalogs

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.6 — Additive
evolution and the total Diff Engine
(PLAN decisions 1, 2, 4, 22 (validation):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006
candidate-spec ownership)

## What to build

The AI authors one complete candidate spec; the platform owns lifecycle
metadata and computes every consequence. Until 4.8, the resolved intent is
hand-supplied through a dev tracer seam.

- **Inputs.** Evolution receives the current committed spec (including every
  inactive field), the resolved intent, a full field-lifecycle catalog, and an
  immutable active dependency-generation catalog frozen under the lease:
  every other capability's
  `{ capability_id, incarnation_id, label, prompt_context, active_schema }`.
  Inactive external fields are not generation context; declared dependencies
  must come from that catalog.
- **Output.** One complete candidate in the canonical authored shape:
  immutable capability `id`, label, every active and inactive field,
  `ui_intent`, `behavior`, `behavioral_errors`, the fixed five-Action `tools`
  set, `read_dependencies`, `prompt_context`. Never lifecycle metadata
  (incarnation, version, build id, snapshot, `artifacts_path`); never a patch,
  migration, or regeneration list.
- **Validation, before any DDL or unit generation.** The candidate must return
  each committed field exactly once — omission, replacement under a new name,
  duplication, or a change to an existing field's name or type is rejected.
  `inactive → inactive` must be identical; `active → inactive` may change only
  lifecycle; reactivation may combine `inactive → active` with mutable
  label/required changes. A newly introduced field must start `active`.
  Five-Action set changes are invalid. Missing, duplicate, unknown, or
  otherwise malformed Action ownership in errors/dependencies is rejected —
  never converted into an all-Handler fallback. Required-field error cases for
  create and update must be present/correct. Reserved names rejected.

## Acceptance criteria

- [ ] The generation prompt receives exactly the inputs above (pinned by a
      context test: inactive externals absent, own inactive fields present)
- [ ] Every rejection row from the matrix's invalid-candidate line is covered
      by a test: field omission, rename-as-replacement, duplication, type
      change, `inactive→inactive` drift, `active→inactive` plus another
      change, new-field-born-inactive, tools-set change, malformed Action
      ownership, undeclared dependency pair
- [ ] Reactivation combining lifecycle + label/required changes validates
- [ ] A valid candidate round-trips to the Diff stage; lifecycle metadata in a
      candidate is rejected
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A dev tracer affordance targets a live capability with a hand-typed intent and
shows the accepted candidate (or warm rejection) in a dev preview — the first
visible half of evolution.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/05-hand-authored-v2-tracer-and-fault-battery.md
