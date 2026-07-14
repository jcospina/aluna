# Confirmation-gated record delete in read detail

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.3 — Full CRUD
platform presentation
(PLAN decision 18: `modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`;
ADR-0005)

## What to build

Record deletion as confirmation-gated platform chrome:

- Delete appears **only** in the read-detail modal (never in edit mode, never
  in the collection).
- First activation replaces the modal's action area with Confirm/Cancel — this
  is local platform presentation state, not another modal and not generated
  logic. Only Confirm invokes the generated `delete` Handler with the bound
  record target.
- Cancel restores the normal read-detail action area.
- After a confirmed delete the modal closes and the records region reloads via
  committed `read` (generalized to the search-aware whole-region refresh in
  4.3/04).
- A `record_not_found` failure surfaces as warm product voice.

## Acceptance criteria

- [ ] Delete affordance exists only in read-detail; edit mode and the
      collection have none
- [ ] First activation shows inline Confirm/Cancel in the same action area;
      Cancel restores it; only Confirm calls `delete`
- [ ] After Confirm the modal closes and the deleted record is gone from the
      re-rendered records region
- [ ] Not-found delete shows a warm failure and changes nothing
- [ ] Focused tests cover the confirm state machine; `bun test`,
      `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: the delete flow on the reference capability is
      validated on the running app (module-acceptance step 4)

## Living demo

Delete a reference-capability record through inline confirmation on the
homepage and watch it leave the collection.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/05-record-targeted-merge-update-and-delete.md
