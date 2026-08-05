# Deletion lease, reverse-dependency refusal, and confirmation chrome

Status: done

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

- [x] The toolbar action performs zero provider/resolver calls (pinned by
      test)
- [x] Module-acceptance case: with a persistent read dependency declared on
      the target, Confirm refuses and names the dependent capabilities;
      removing the dependency lets deletion proceed
- [x] Race case: dependencies added between preflight and Confirm are caught
      by lease-held revalidation
- [x] Try-acquire refuses while a build owns or queues the coordinator and is
      never queued
- [x] Confirmation copy names the capability and the permanent-loss scope
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: refusal wording and permanent-delete confirmation
      validated on the running app (module-acceptance step 6, first half)

## Living demo

Try to delete a capability another capability reads from: warm refusal naming
the dependent. Remove the dependency and the confirmation shows the permanent
wording (actual destruction lands in 4.9/03).

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.9-dependency-safe-permanent-deletion/issues/01-per-incarnation-read-gates-and-tokens.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/01-atomic-mutation-coordinator.md

## Implementation notes

- Added one platform-owned permanent-delete control to every canonical capability
  toolbar entry. It opens an inline, accessible confirmation in the content area;
  no capability Handler, prompt job, resolver, or provider participates.
- Confirmation names the capability and plainly explains that its records, past
  setups, saved files and other owned resources, and activity history will be
  lost. It also makes clear that Aluna retains a few measurements about creating
  or changing it, never the person’s content.
- Confirm atomically uses the shared non-queued deletion try-acquire, then
  revalidates the exact target incarnation and recomputes all live reverse
  dependencies through the read-write registry connection while ownership is
  held. Deterministic refusal copy names dependents in canonical registry order.
- Added the lease-held continuation seam that 4.9/03 will extend into read-gate
  drain and durable destruction. For this front-half issue, a clear target shows
  an explicit ready-but-not-deleted state; no toolbar entry, View, record, table,
  artifact, or metric is removed.
- Hardened the browser interaction: a closed toolbar is inert, mobile actions
  dismiss the drawer, the swapped confirmation receives focus, the destructive
  target is 44×44px, expected stale/missing races render visibly, and all labels
  and dependent names are escaped.

## Verification

- `bun run test --shards=2` — 1,088 passed, 0 failed across 115 files.
- Focused deletion, app-route, toolbar, router, registry, and coordinator pass —
  70 passed, 0 failed.
- `bun run typecheck` — clean for server and browser TypeScript projects.
- `bun run lint` — clean across 301 files.
- `git diff --check` — clean.
- Independent adversarial, test-quality, and UI/accessibility re-reviews —
  blocker-free after async lease-lifetime, lease-held read observability,
  zero-AI admission, stale-swap, inert drawer, focus, mobile, and touch-target
  findings were repaired and regression-tested.
- Live browser verification on the existing `http://localhost:3030` confirmed the
  real toolbar action, focused confirmation, simplified permanent-loss wording,
  secondary retained-measurement disclosure, an outlined **Keep it** action,
  danger color reserved for **Delete permanently**, and safe restoration. Actual
  destruction remains intentionally deferred to 4.9/03.

## HITL test instructions

1. Reuse the running development server, or run `bun run dev` if port 3030 is
   not already listening. Open `http://localhost:3030`.
2. Prepare one persistent dependency through the normal prompt flow. For the
   current demo, type: **“Build a reading highlights capability that reads my
   Reading list and shows the books I finished most recently.”** Wait for it to
   activate, then confirm its developer preview declares the exact Reading list
   dependency.
3. In the capability toolbar, activate **Permanently delete Reading list**.
   Confirm the inline checkpoint says **Delete Reading list permanently?**, plainly
   names records, past setups, saved files and other owned resources, and activity
   history as lost, and says Aluna keeps only a few measurements about creating
   or changing it, never your content. Confirm
   **Keep it** is outlined and the only red control is **Delete permanently**.
4. Select **Delete permanently** in that checkpoint. Confirm the
   warm refusal names **Reading highlights**, keeps Reading list present, and
   offers **Check again**. This is the authoritative Confirm-time refusal, not
   the advisory preflight.
5. In the prompt bar, type: **“Change Reading highlights so it no longer reads
   from Reading list.”** Wait for activation, reopen Reading list’s permanent
   confirmation, and confirm no dependency warning remains.
6. Select **Delete permanently** once more. For this issue, confirm the result
   says **Ready to delete** and explicitly says this step has not removed anything
   yet. Full destruction, toolbar removal, and recreation land in
   4.9/03.
