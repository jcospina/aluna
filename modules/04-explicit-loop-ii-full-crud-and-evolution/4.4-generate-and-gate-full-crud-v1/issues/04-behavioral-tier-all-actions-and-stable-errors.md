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

The blocker implementation is landed and green; its separate human-sign-off
status remains tracked in issue 4.4/01.

## Verification

- `bun test` — 551 passed, 0 failed across 57 files.
- `bun run typecheck` — passed for server and browser projects.
- `bun run lint` — 198 files checked, no findings.
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

## HITL test instructions

1. Run `bun run dev` if the existing development server is not already running.
2. Open `http://localhost:3030/` and select **Equipment safety checks**.
3. Open the developer panel and inspect **Gate**. Confirm the behavioral rung
   is `passed` and its 9 cases name create, read, update, delete, search, both
   required-field failures, and both missing-record failures.
4. Select **New Equipment safety checks** and leave **Title** empty. The browser
   keeps focus on the required field. To inspect the Handler-level stable
   contract directly, run:

   `curl -sS -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode '__aluna_present=title' --data-urlencode 'title=' http://localhost:3030/capability/equipment_safety_checks/create`

   Confirm the returned element has `data-role="error"`,
   `data-error-code="missing_required_fields"`, and
   `data-error-fields="title"`, with no new safety-check row created.
