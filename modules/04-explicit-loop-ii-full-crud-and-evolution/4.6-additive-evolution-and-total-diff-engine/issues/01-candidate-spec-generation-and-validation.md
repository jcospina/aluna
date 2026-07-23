# Candidate-spec generation and validation with the lifecycle and dependency catalogs

Status: done

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
  `ui_intent` (including one valid list input mode for every active `string[]`),
  `behavior`, `behavioral_errors`, the fixed five-Action `tools` set,
  `read_dependencies`, `prompt_context`. Never lifecycle metadata
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
  create and update must be present/correct. Form list-input intent must cover
  exactly the active `string[]` fields in schema order with a closed mode;
  scalar/inactive/unknown/missing/duplicate entries are rejected. Reserved names
  rejected.

## Acceptance criteria

- [x] The generation prompt receives exactly the inputs above (pinned by a
      context test: inactive externals absent, own inactive fields present)
- [x] Every rejection row from the matrix's invalid-candidate line is covered
      by a test: field omission, rename-as-replacement, duplication, type
      change, `inactive→inactive` drift, `active→inactive` plus another
      change, new-field-born-inactive, tools-set change, malformed Action
      ownership, undeclared dependency pair
- [x] Reactivation combining lifecycle + label/required changes validates
- [x] New/reactivated/hidden `string[]` fields require/add/remove the exact form
      list-input entry, and a valid mode change round-trips as a presentation fact
- [x] A valid candidate round-trips to the Diff stage; lifecycle metadata in a
      candidate is rejected
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

A dev tracer affordance targets a live capability with a hand-typed intent and
shows the accepted candidate (or warm rejection) in a dev preview — the first
visible half of evolution.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.1-incarnation-keyed-field-and-input-contract/issues/05-model-authored-string-array-input-mode.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.5-snapshots-publication-metrics-atomic-activation/issues/05-hand-authored-v2-tracer-and-fault-battery.md

## Implementation notes

- The AI authors one complete candidate; the platform owns every rule. Three new
  builder modules keep the concern layered: `src/builder/dependency-catalog.ts`
  freezes the immutable active dependency-generation catalog
  (`{ capability_id, incarnation_id, label, prompt_context, active_schema }` per
  other capability, active fields only — inactive externals and the evolving
  capability itself excluded); `src/builder/candidate-spec-gen.ts` assembles the
  four decision-1 inputs into the generation prompt and runs generate→validate as
  the stage's own gate; `src/builder/candidate-validation.ts` is the total
  pre-DDL contract.
- Validation is three layers in order: the registry's own strict spec gate
  (`promptCapabilitySpecSchema` — structural shape, fixed five-Action set, Action
  ownership, list-input coverage, reserved names, active-only presentation
  references, and — via strict objects — rejection of every platform-owned
  lifecycle key and any patch/migration/regeneration shape); the cross-spec
  field-lifecycle contract (each committed field returned once, immutable
  name/type, `inactive→inactive` identical, `active→inactive` lifecycle-only,
  reactivation may add label/required, new fields born active); and
  frozen-catalog dependency resolution. Every violation is reported at once as a
  `CandidateValidationError` whose `issues[]` carry dev-preview paths.
- A valid candidate emerges as the validated canonical `CapabilitySpec` — exactly
  what the Diff Engine (4.6/02) will consume. Nothing here performs DDL, unit
  work, publication, activation, a version bump, or a View swap.
- The committed row is read through the label-tolerant `committedSpecView`, not
  the strict `capabilitySpecFromRow` re-parse. The row was already validated by
  `capabilityRowSchema`; re-parsing through the strict `capabilityNameText` label
  would wrongly make any capability with an older narration-like label impossible
  to evolve (every display path already canonicalizes such labels). The strict
  label gate applies to the candidate the model authors, never to the committed
  input. Found by adversarial review; two regression tests lock it.
- **Temporary seams (removed in 4.6/05, not a second evolution path):** the
  resolved intent is hand-supplied through `handSuppliedEvolutionIntent`
  (`extend_capability` classification stand-in) until the real resolver lands in
  4.8; the developer-panel affordance and its `/demo/evolution-candidate/*`
  routes (`src/evolution-candidate-routes.ts`) run candidate generation +
  validation under the exclusive build lease — which is what makes the catalog
  freeze real — and deliver the accepted candidate or the warm rejection through
  the shared build subscriber, SSE vocabulary, and terminal presenter.

## Living demo — as delivered

Wired into the homepage developer panel: opening any live capability renders a new
**Evolution candidate** block (`src/web/fragments.ts`,
`public/index.html`, `public/css/devbar.css`) with a hand-typed intent field.
Submitting streams the candidate assembling live (`spec-preview`) and delivers the
accepted candidate — or a warm rejection with every contract violation — into the
panel's `#spec-candidate-preview` block, with the displaced View restored and no
version bump. Unlike the one-shot v2 tracer, the affordance targets any live
version.

## Verification record

Verified 2026-07-23 (America/Bogota):

- `bun run typecheck` and `bun run lint`: clean.
- New suites pass: `src/builder/candidate-validation.test.ts` (45, incl. the
  legacy-label regression), `src/builder/candidate-spec-gen.test.ts` (8, incl.
  the pinned context test), `src/app.evolution-candidate.test.ts` (9). The
  touched shell/fragment tests (`src/app.test.ts`, `src/web/fragments.test.ts`)
  stay green.
- Full suite in the `oven/bun:1.3.12` Linux container (local `bun test`
  segfaults on the pre-existing SQLite-FFI Bun bug): **712 pass**. The only
  failures are the documented pre-existing/environmental ones — 7 heavy pipeline
  tests that time out under 70-files-in-one-process CPU starvation (all pass when
  re-run in isolation with `--timeout 30000`), plus the 7 `scripts/biome-hooks`
  container-shell artifacts and the 1 known `app.spec-build-failures` missing-key
  isolation defect. None in the new code.
- Adversarial pass (SOTA model, execution-verified): validation core clean across
  all five attack categories; one Important latent bug found and fixed (the
  committed-label re-parse above); one Minor `__proto__` strict-object note
  verified harmless (Zod rebuilds from schema keys — it never reaches the
  validated candidate and cannot pollute the prototype), left documented rather
  than guarded.
- Live end-to-end on the running `:3030` server: tracing `experiment_journal`
  (v1) with "Add an optional short conclusion note to each experiment" produced a
  valid **accepted** candidate — all eight committed fields preserved exactly, the
  new `conclusion_note` field born `active`, the five-Action set and the `tags`
  comma-separated list-input entry intact, correct `missing_required_fields`
  cases — and left the capability untouched at v1.

## HITL test instructions

1. Start the app with `bun run dev` (or reuse the server on port 3030), then open
   `http://localhost:3030/`.
2. Click a capability in the left toolbar (e.g. **Experiment journal**), then open
   the developer panel with the `</>` icon.
3. In the new **Evolution candidate** block, type a change — e.g.
   `Add an optional short conclusion note to each experiment` — and select
   **Trace candidate**.
4. Confirm the narration stays warm ("Let me think through that change." → "Here's
   how I'd shape that change…"), the **Evolution candidate** preview fills with the
   accepted candidate JSON (every existing field preserved, the new field `active`),
   and the capability list shows no new version.
5. Optional: submit a blank intent (expect a warm "Tell me what you'd like to
   change first.") or a nonsense/destructive intent (expect a coherent candidate
   or the warm "I couldn't quite shape that change safely" — never a cold error,
   never a change to your data).
