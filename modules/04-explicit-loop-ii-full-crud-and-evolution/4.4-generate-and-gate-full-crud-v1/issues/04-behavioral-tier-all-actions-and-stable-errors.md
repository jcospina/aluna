# Behavioral tier over all five Actions and the stable error contract

Status: ready-for-agent

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

- [ ] Tier-on: generated tests exist for all five Actions and assert the
      required-field cases for create and update over exactly the active
      required fields
- [ ] `record_not_found` is exercised for update and delete
- [ ] Malformed Action ownership in `behavioral_errors` (missing, duplicate,
      unknown Action) is rejected at candidate validation, never repaired into
      a passing build
- [ ] Tests assert markers/codes/Actions/fields, never product wording
- [ ] Tier remains independent: smoke and structural rungs run with the tier
      off; the tier flag is respected end-to-end
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Build a capability with the tier on and show the behavioral rung's per-Action
results in the existing Gate dev preview; a required-field violation through
the homepage form shows the same stable error semantics the tests froze.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.4-generate-and-gate-full-crud-v1/issues/01-generate-five-handlers-and-item-renderer.md
