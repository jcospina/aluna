# The behavioral-tier transition table

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.7 — Evolution Gate
and frozen-intent repair
(PLAN decision 24 (transition table):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0006)

## What to build

Implement decision 24's tier transition table exactly, on the next real spec
version:

| Prior snapshot | Candidate tier | Test-input change | Test artifact/execution |
| --- | --- | --- | --- |
| off | off | any | absent; no generation or execution |
| off | on | any | generate, freeze, and run from current candidate inputs |
| on | on | unchanged, no Handler impact | copy; do not run |
| on | on | unchanged, Handler impacted | copy; run impacted/full fallback |
| on | on | changed | generate, freeze, and run |
| on | off | any | absent; no copy or execution |

- Toggling the global tier alone does not create a version; these rules apply
  on the next spec-changing build after Diff facts exist. A semantic no-op does
  not materialize a tier transition.
- Snapshot contents follow: tier-off snapshots carry no behavioral-test
  artifacts and `absent`/`skipped` metrics; tier-on snapshots carry frozen
  tests. `snapshot.json` verifies completeness; it is not a routing overlay or
  per-unit pointer manifest.

## Acceptance criteria

- [ ] Each of the six table rows is exercised by a test that asserts both the
      snapshot artifact state and the metrics stage states (plan acceptance:
      every behavioral-tier transition)
- [ ] Tier toggle alone: no version, no build, no snapshot; the next real spec
      change applies the transition
- [ ] A semantic no-op with a toggled tier stays a no-op (`success/no_change`,
      no tier materialization)
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Toggle the tier in the dev preview, run a real evolution, and see the
transition row that applied (artifacts present/absent) in the version's
manifest view.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.7-evolution-gate-and-frozen-intent-repair/issues/02-test-copy-run-selection-and-fallback.md
