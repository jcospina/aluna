# Typed change facts, the total matrix, and the canonical no-op

Status: ready-for-agent

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

- [ ] Table tests cover **every** matrix row's fact→work mapping, including
      the None columns (e.g. capability label selects no units; field-order
      change selects nothing; a list input mode selects platform form/View work
      only; `feed | grid` selects `item` only)
- [ ] Multi-fact union: a reactivation + required change unions effects; no
      fact subtracts another's work
- [ ] An unmapped admitted fact fails closed before publication (plan
      acceptance: unknown-fact failure)
- [ ] Key-reorder / set-reorder candidates compare equal (measured no-op with
      `success/no_change`, stages skipped, `fragment` restore); a real
      `shows`/field-order change diffs
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The dev tracer preview from 4.6/01 now shows the emitted typed facts and their
unioned work plan for a candidate, and a resubmitted identical candidate shows
the measured no-op on the live surface (View restored, no version bump).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.6-additive-evolution-and-total-diff-engine/issues/01-candidate-spec-generation-and-validation.md
