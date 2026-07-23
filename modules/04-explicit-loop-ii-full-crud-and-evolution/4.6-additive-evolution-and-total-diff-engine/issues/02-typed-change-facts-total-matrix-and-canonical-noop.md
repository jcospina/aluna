# Typed change facts, the total matrix, and the canonical no-op

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.6 — Additive
evolution and the total Diff Engine
(PLAN decisions 21 (matrix), 22, 37 + the normative change-fact matrix:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006 total
unit diffs)

## What to build

The Diff Engine's one total, monotone change-fact contract, implementing the
plan's normative matrix (the table in PLAN.md is authoritative; extending the
set of admitted facts requires extending and testing the table).

- Every admitted committed→candidate difference becomes a typed fact mapped to
  schema work, platform View work, generated-unit selection, and Gate work.
  Multi-fact effects union; one fact can never subtract work required by
  another. A unit may copy only when the matrix positively proves it
  unaffected. A new admitted fact without a matrix row fails closed before
  publication.
- Free-text `behavior` changes conservatively select all five Handlers;
  `behavioral_errors` and `read_dependencies` select their named Actions
  (ownership already validated in 4.6/01).
- **Canonical no-op (decision 37).** “Canonical” is the validated semantic
  value, not raw JSON: object-key order ignored; fixed Actions, dependency
  arrays, error cases, and error-field sets in defined canonical order;
  ordered product facts (`schema.fields`, item/detail `shows`) preserve order
  and therefore diff; text uses the validator's normalized stored value. A
  zero-fact candidate performs no DDL, unit copy/generation, snapshot
  publication, version bump, registry update, or `commit`; metrics finalize
  `success/no_change` with every stage skipped; the presenter restores the
  committed View via `fragment` before its warm `done=ok`. A tier toggle alone
  remains versionless. Expected-version mismatches never reach this comparison
  (they are 4.8's stale path).

## Acceptance criteria

- [x] Table tests cover **every** matrix row's fact→work mapping, including
      the None columns (e.g. capability label selects no units; field-order
      change selects nothing; a list input mode selects platform form/View work
      only; `feed | grid` selects `item` only)
- [x] Multi-fact union: a reactivation + required change unions effects; no
      fact subtracts another's work
- [x] An unmapped admitted fact fails closed before publication (plan
      acceptance: unknown-fact failure)
- [x] Key-reorder / set-reorder candidates compare equal (measured no-op with
      `success/no_change`, stages skipped, `fragment` restore); a real
      `shows`/field-order change diffs
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The dev tracer preview from 4.6/01 now shows the emitted typed facts and their
unioned work plan for a candidate, and a resubmitted identical candidate shows
the measured no-op on the live surface (View restored, no version bump).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/01-candidate-spec-generation-and-validation.md

## Implementation notes

- **One pure module owns the contract.** `src/builder/diff-engine.ts` exposes
  `diffCapabilitySpec(committed, candidate) → { facts, workPlan, isNoop }`. Both
  inputs are the validated canonical `CapabilitySpec` (the committed row's
  label-tolerant `committedSpecView`, and the 4.6/01-validated candidate), so the
  engine never re-checks the invalid-candidate row — it only classifies admitted
  differences. It is deterministic and dependency-free (registry types only), so
  the whole matrix is table-testable with no db or provider.
- **The facts are the matrix.** A typed `ChangeFact` union — one variant per
  matrix row that produces a fact — is detected by region: `capability_label`
  (canonical label), `prompt_context`, `field_order` (order of the fields present
  in both, so a new field inserted mid-list is not a reorder), `new_active_field`,
  `required_change`, `field_label`, `field_lifecycle` (hide/reactivate),
  `list_input_mode` (only for a field active `string[]` in *both* specs),
  `detail_shows`, `item_presentation` (item direction or `item.shows`),
  `collection_layout`, `read_dependencies.<action>`, `behavior`, and
  `behavioral_errors` (the union of Actions owning each added/removed canonical
  case). Facts sort into a fixed canonical order.
- **Canonical comparison (decision 37).** Object-key order is ignored and set-like
  facts use a defined canonical order (dependency arrays, error cases, and each
  case's `fields` set are sorted before comparison); ordered product facts —
  `schema.fields`, item/detail `shows`, item `direction` — preserve order and
  therefore diff. Free-text `behavior`/`prompt_context` compare on the validator's
  stored value; the label compares through `canonicalCapabilityLabel`.
- **Monotone unioned work plan.** `projectWorkPlan` folds each fact into a sink of
  `platformWork` (a closed `PLATFORM_WORK_KINDS` vocabulary), `regeneratedUnits`
  (over the six units), a behavioral test plan (`actions` + `fullSuite`), and a
  gate plan (structural + smoke on any real build, design-lint iff `item`
  regenerates, behavioral per the test plan). Contributions are additions only, so
  no fact can subtract work another requires; a unit is copied only when *no* fact
  selects it. `behavior` selects all five Handlers + the full suite (decision 22);
  a schema write selects `create`/`update` and adds `search` only for text/list-text.
- **Fails closed on the unknown (decision 21).** `assertTotalCoverage` canonicalizes
  both specs, blanks every fact-covered region, and requires the residuals — id,
  `tools`, and each committed field's name/type, plus any future admitted key that
  isn't yet neutralized — to be identical. Any leftover difference throws
  `UnmappedChangeFactError` (carrying both residuals for the dev preview) before
  publication: the guard for an admitted fact without a matrix row, and defense in
  depth against an immutable difference validation should have caught.
- **The measured no-op is a real terminal (decision 37).** Zero facts ⇒ `isNoop`.
  `finalizeMeasuredNoChange` (`src/pipeline/metrics-recorder.ts`) is the first
  producer of the already-schema-legal `success/no_change` lifecycle outcome: it
  opens a running row and immediately resolves it success/`no_change` with spec-gen
  `generated` and every downstream stage `skipped`, under the held build lease so
  the record survives a dropped client. `deliverCandidateNoChangePresentation`
  (`src/pipeline/terminal-presentation.ts`) restores the committed View through
  `fragment`, keeps a warm product-voice notice, and closes `done=ok` — no DDL,
  unit copy/gen, publication, or version bump.
- **Scope boundary.** A *real* change stops after the Diff, showing the facts +
  work plan; 4.6/03 consumes that work plan to perform the additive DDL, context
  projection, and unit copy. This issue owns only the facts, the total matrix, and
  the no-op terminal. The `handSuppliedEvolutionIntent` + `/demo/evolution-candidate`
  seams remain temporary (removed 4.6/05; real resolver in 4.8).

## Living demo — as delivered

The 4.6/01 **Evolution candidate** developer-panel block now shows the Diff
result. On an accepted candidate the `#spec-candidate-preview` payload
(`buildEvolutionCandidateAcceptedPreview`) carries `diff.facts` and
`diff.workPlan` alongside the validated candidate, pretty-printed by the existing
client preview renderer. A resubmitted **semantically identical** candidate takes
the measured-no-op path: a `success/no_change` row streams into the panel's
`#spec-metrics-preview` (Lifecycle) block, the candidate preview reports
`status: "no_change"` with an empty fact set, the committed View is restored via
`fragment`, and the capability stays at its current version. No new client or
route surface was needed — the enriched JSON payloads render through the wiring
`renderBuildSubscriber`/`app.js` already provide.

## Verification record

Verified 2026-07-23 (America/Bogota):

- `bun run typecheck` and `bun run lint`: clean.
- New/updated suites pass: `src/builder/diff-engine.test.ts` (31 — every matrix
  row incl. the None columns, multi-fact union, key/set-reorder no-op vs.
  ordered-product diffs, and the fail-closed unknown-difference path) and
  `src/app.evolution-candidate.test.ts` (10 — now incl. the accepted preview's
  facts + work plan and the measured-no-op route test). 41 pass together.
- Full suite in the `oven/bun:1.3.12` Linux container (local `bun test` segfaults
  on the pre-existing SQLite-FFI Bun bug): **the new code adds zero failures.**
  Confirmed by re-running the identical command on a clean `HEAD` (this change
  stashed), which fails the *same* deterministic set. The failures are the
  documented pre-existing/environmental ones (same as 4.6/01's record): the
  `scripts/biome-hooks` tests fail only because the container command omits
  `python3` (the `.codex` hook scripts require it — adding `python3` to the
  `apt-get` list makes all 8 pass), a couple of heavy pipeline tests time out under
  one-process CPU starvation (pass with `--timeout 30000`), and the 1 known
  `app.spec-build-failures` missing-key isolation defect remains. With `python3`
  added and `--timeout 30000`, the full container run is **760 pass / 1 fail**,
  the single failure being that pre-existing spec-build defect. User confirmed the
  suite is fully green in their own terminal.

## HITL test instructions

1. Start the app with `bun run dev` (or reuse the server on port 3030), then open
   `http://localhost:3030/`.
2. Click a capability in the left toolbar, then open the developer panel with the
   `</>` icon.
3. In the **Evolution candidate** block, type a real change — e.g.
   `Add an optional rating field` — and select **Trace candidate**. Confirm the
   **Evolution candidate** panel shows `diff.facts` (e.g. a `new_active_field`
   fact) and `diff.workPlan` (e.g. `regeneratedUnits: ["create","update","search"]`),
   with the View restored and the version unchanged.
4. Submit a change that is already satisfied (a no-op) — e.g. ask for a field the
   capability already has, or re-state its current behavior. Confirm the narration
   *"That's already exactly how this works — nothing to change,"* the **Lifecycle**
   panel showing `success` / `no_change`, the committed View restored unchanged,
   and **no version bump**.
5. Deterministic proof of every matrix row, the reorder no-op, and the fail-closed
   guard: `bun test src/builder/diff-engine.test.ts` in your terminal.
