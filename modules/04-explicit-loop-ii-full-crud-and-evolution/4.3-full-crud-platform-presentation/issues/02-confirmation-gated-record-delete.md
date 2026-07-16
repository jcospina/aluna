# Confirmation-gated record delete in read detail

Status: done

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

- [x] Delete affordance exists only in read-detail; edit mode and the
      collection have none
- [x] First activation shows inline Confirm/Cancel in the same action area;
      Cancel restores it; only Confirm calls `delete`
- [x] After Confirm the modal closes and the deleted record is gone from the
      re-rendered records region
- [x] Not-found delete shows a warm failure and changes nothing
- [x] Focused tests cover the confirm state machine; `bun test`,
      `bun run typecheck`, `bun run lint` clean
- [x] **Human sign-off**: the delete flow on the reference capability is
      validated on the running app (module-acceptance step 4)

## Living demo

Delete a reference-capability record through inline confirmation on the
homepage and watch it leave the collection.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/05-record-targeted-merge-update-and-delete.md

## Implementation notes

- A delegated responsive UX research pass recommended treating Close separately
  from record actions: the header now contains only the title and isolated 44px
  Close icon, while a docked read footer places visible **Delete** at the leading
  edge and visible **Edit** at the trailing edge. This supersedes 4.3/01's interim
  pencil beside the title and keeps long titles, mobile targets, and destructive
  intent legible.
- Delete's first activation is a local, tested modal-state transition and cannot
  submit. It replaces the read footer with the warning, focus-first **Cancel**,
  and one danger-filled **Delete record** submit bound to the exact rendered
  record target. Cancel restores the read footer and focus to Delete.
- The confirmation stays inside the one shared modal. Close, Escape, and backdrop
  dismissal reset its local state; during the final request those dismissal paths
  and duplicate submission are temporarily locked so a late response cannot
  close or refresh a newly opened record.
- Confirmed success reruns the current nonblank committed search or canonical
  `read`, replaces the whole records region, closes the modal, and focuses the
  next surviving record, then the previous record, or New when empty. The refresh
  seam checks HTTP and network failure explicitly and falls
  back to a canonical reload instead of leaving stale collection content or a
  permanently busy modal.
- Missing targets retarget warm `record_not_found` copy into the confirmation's
  live error region, keep the modal open, and restore every control. The global
  HTMX error policy now admits this structured 404 swap without misclassifying
  the mutation as successful.
- Below 480px/high zoom, the warning owns a row and Cancel/Delete record stack at
  full width. Desktop keeps the same labels and information architecture in one
  compact row; the collection and edit mode contain no Delete affordance.

## Verification

- `bun test` — 497 passing, 0 failing, 2 snapshots
- `bun run typecheck`
- `bun run lint` — 183 files checked, no fixes
- `git diff --check`
- Focused modal-state/refresh/presentation/router/app/demo run — 59 passing,
  0 failing
- In-app browser on the existing `http://localhost:3030` server at 1280×720 and
  390×844: confirmed isolated Close, labelled docked actions, 44px targets, title
  focus on open, no horizontal overflow, focus-first Cancel, Cancel→Delete focus
  restoration, confirmation reset after Close, Edit's separate prefilled mode,
  full-width mobile confirmation stacking, committed-read removal, modal close,
  and next-survivor focus.
- Live stale-record exercise: deleted `delete-target` through the same real route
  after opening its modal, then confirmed from the stale surface. The HTTP 404
  kept confirmation open, announced **I couldn’t find that entry anymore. It may
  already be gone.**, cleared busy state, and re-enabled Delete record.

## HITL test instructions

1. Reuse the app server on port 3030 (or run `bun run dev` if it is not already
   running), then run `bun run demo:five-action-reference`.
2. Open `http://localhost:3030`, choose **Journal entry**, and activate **Ready to
   remove — CAFÉ ÅNGSTRÖM**. Confirm focus starts on the title, Close is isolated
   at the top-right, and labelled **Delete**/**Edit** actions are docked below the
   read fields. The collection and Edit mode must not show another Delete action.
3. Choose **Delete**. Confirm no record leaves the collection yet; the same action
   area now shows the warning, focused **Cancel**, and red **Delete record**.
   Choose Cancel and confirm the ordinary read actions return with focus on Delete.
4. Choose Delete again, then **Delete record** once. Confirm **I’m deleting…** appears,
   the modal closes, the target disappears after committed read, and focus moves
   to a surviving record.
5. Run the installer again, switch browser responsive tools below 480px, and
   repeat through the first Delete activation. Confirm the modal has no horizontal
   overflow, Close remains a 44px target, labels remain visible, and Cancel/Delete
   record stack full width below the warning.
6. Confirm both desktop and mobile interactions remain correct.

Human sign-off was accepted with the Epic 4.3 issue-level completion statement on
2026-07-16; the instructions remain as the repeatable regression recipe.
