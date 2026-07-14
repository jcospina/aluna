# Deletion lease, reverse-dependency refusal, and confirmation chrome

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.9 — Dependency-safe
permanent capability deletion
(PLAN decisions 33 and 12 (deletion refusal):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The zero-AI front half of deletion.

- A platform-owned toolbar action with authored product voice — no resolver or
  provider call, ever. Delete is never archive, hide, deactivate, restore, or
  AI-authored SQL.
- An advisory preflight may show live reverse dependencies, but it is only
  advisory: **Confirm** atomically try-acquires the deletion lease through the
  mutation coordinator (only when there is no active owner or queued build;
  never queued) and revalidates target incarnation + reverse dependencies
  while ownership is held.
- If any live capability declares a dependency on the target incarnation,
  deletion is blocked with deterministic copy naming the dependents; Aluna
  never leaves a committed Handler pointing at a dropped table.
- The confirmation names the capability and states that its records,
  version/spec history, and capability-owned resources/event payloads are
  permanently lost. Generation metrics remain (content-free experiment data
  keyed by incarnation).

## Acceptance criteria

- [ ] The toolbar action performs zero provider/resolver calls (pinned by
      test)
- [ ] Module-acceptance case: with a persistent read dependency declared on
      the target, Confirm refuses and names the dependent capabilities;
      removing the dependency lets deletion proceed
- [ ] Race case: dependencies added between preflight and Confirm are caught
      by lease-held revalidation
- [ ] Try-acquire refuses while a build owns or queues the coordinator and is
      never queued
- [ ] Confirmation copy names the capability and the permanent-loss scope
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: refusal wording and permanent-delete confirmation
      validated on the running app (module-acceptance step 6, first half)

## Living demo

Try to delete a capability another capability reads from: warm refusal naming
the dependent. Remove the dependency and the confirmation shows the permanent
wording (actual destruction lands in 4.9/03).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.9-dependency-safe-permanent-deletion/issues/01-per-incarnation-read-gates-and-tokens.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/01-atomic-mutation-coordinator.md
