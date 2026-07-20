# Behavioral tier over all five Actions and the stable error contract

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.4 — Generate and
Gate full-CRUD v1 capabilities
(PLAN decision 4 (final) + epic text:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0004
behavioral tier)

## What to build

Extend the optional independent behavioral tier to cover all five Actions and
the finalized stable error contract for v1 generation. (The full
test-input/copy/tier-transition machinery is epic 4.7; this issue makes the
existing tier five-Action-complete for fresh builds. Tests remain ON by
default per the project's verification philosophy.)

- Behavioral tests cover every Action's `behavior` and its Action-owned
  `behavioral_errors`.
- Stable error contract, final shape: candidate validation requires
  `missing_required_fields` cases for both `create` and `update` whenever
  active required fields exist, covering exactly those fields; inactive and
  optional fields cannot appear; every error case references only active
  fields and one Action present in the admitted shape; additional
  behavior-specific cases may target any present Action.
- The platform-stable `record_not_found` failure for update/delete is asserted
  from the platform side, not duplicated in the authored spec.
- Spec-owned semantic markers, error code, Action, and affected fields are
  consumed independently by Handlers and tests; product wording stays
  generated and variable.

## Acceptance criteria

- [x] Tier-on: generated tests exist for all five Actions and assert the
      required-field cases for create and update over exactly the active
      required fields
- [x] `record_not_found` is exercised for update and delete
- [x] Malformed Action ownership in `behavioral_errors` (missing, duplicate,
      unknown Action) is rejected at candidate validation, never repaired into
      a passing build
- [x] Tests assert markers/codes/Actions/fields, never product wording
- [x] Tier remains independent: smoke and structural rungs run with the tier
      off; the tier flag is respected end-to-end
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability with the tier on and show the behavioral rung's per-Action
results in the existing Gate dev preview; a required-field violation through
the homepage form shows the same stable error semantics the tests froze.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/01-generate-five-handlers-and-item-renderer.md

## Implementation notes

- Added the five-Action behavioral suite contract and runner while preserving
  the transitional two-Action path until 4.4/05 removes it.
- Full suites require normal create/read/update/delete/search coverage, every
  authored Action-owned error exactly once, and platform-owned
  `record_not_found` cases for update and delete exactly once.
- Behavioral input now mirrors runtime Action ownership: create receives all
  active presence markers, update only submitted fields, read/delete none, and
  search only `q`. Test assertions are limited to Action-relevant synthetic
  values so generated product copy remains variable.
- Candidate validation rejects absent/unknown/duplicate Action ownership,
  inactive or optional error fields, and authored attempts to claim the
  platform-owned `record_not_found` contract.
- The Gate preview retains the Action for every behavioral result, including
  stable error cases, so all nine cases are inspectable independently.
- Every normal search case now carries non-vacuous ordering evidence: exactly
  one nonblank `q`, at least two matching setup rows, and distinct per-row
  fragment markers asserted in authored order. Deterministic scratch ids ensure
  an id-only Handler cannot pass newest-first semantics by UUID luck. The model
  interprets existing free-text `behavior`; no new spec field or behavior parser
  was added.
- Behavioral generation no longer invents a mandatory seeded non-match. Smoke
  owns filtering and match-set evidence; behavioral owns authored ordering.
  Generated ordered rows are admitted only when they mechanically match every
  query term under the platform normalizer, while any optional excluded row must
  mechanically not match. This prevents a self-contradictory marker such as
  `Search Nonmatch Marker` from falsely blaming a correct Handler for matching
  `q=search`.
- Schemas with no active `string`/`string[]` fields remain valid: their normal
  search case submits a nonblank query but makes no impossible matching-row or
  ordering assertion. Smoke proves the empty match set, and behavioral reports
  ordering as honestly inapplicable instead of rejecting an architectural shape.

The blocker implementation is landed and green; its separate human-sign-off
status remains tracked in issue 4.4/01.

## Verification

- `bun test` — 577 passed, 0 failed across 56 files, with 2 snapshots and 2,678
  expectations.
- `bun run typecheck` — passed for server and browser projects.
- `bun run lint` — 201 files checked, no findings.
- `bun run build` — clean.
- `git diff --check` — clean.
- Independent standards and adversarial audits found no remaining
  issue-scoped blockers. Counterexamples for all-row search, false required
  triggers, malformed Action input, and product-copy assertions are pinned by
  regression tests.
- Live build on `http://localhost:3030/`: `equipment_safety_checks` committed as
  incarnation `4334eff3-8fb5-4128-9a21-97f6e7070619`. Its Gate preview passed
  all four rungs and 9 behavioral cases over all five Actions. Posting the
  homepage form's empty `title` with its `__aluna_present=title` marker returned
  `data-role="error"`, `data-error-code="missing_required_fields"`, and
  `data-error-fields="title"` without creating a row.
- Post-fix real-provider builds `conference_speakers` and `recipes` both passed
  the behavioral search case and all other Gate rungs before commit. The first
  used six first-pass units; the second successfully consumed bounded repairs
  for create and update, then committed normally.

## HITL test instructions

1. Run `bun test src/builder/gate.behavioral.test.ts` and confirm all five-Action,
   stable-error, and multi-row search-order cases pass.
2. Keep the existing app on port 3030 running; if needed, run `bun run dev`.
3. Open `http://localhost:3030/capability/reading_log`, search **Juramentada**,
   and confirm the generated search returns the matching record. Search
   **coffee** and confirm the no-match state, then choose **Clear**.
4. Open **Juramentada**, choose **Edit**, and confirm every field is rehydrated.
   Choose **Cancel** so the acceptance record remains unchanged.
