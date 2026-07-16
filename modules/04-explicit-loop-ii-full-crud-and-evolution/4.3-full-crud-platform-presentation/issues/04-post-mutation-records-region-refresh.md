# Post-mutation records-region refresh

Status: done

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.3 — Full CRUD
platform presentation
(PLAN decision 17 (refresh) + module acceptance step 3:
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`)

## What to build

The one refresh rule that keeps membership and ranking honest after any
mutation, closing epic 4.3's tracer (the complete CRUD interaction visible on
the hand-written reference capability before generation).

- After every `create`, `update`, or `delete`, platform chrome reruns the
  current nonblank `search?q` — or, when no query is active, `read` — and
  replaces the **whole records region** through the shared renderer, so a
  record that no longer matches leaves the result set and ranking cannot go
  stale.
- This unifies the interim reloads from 4.3/01–02 under one platform-owned
  path.

## Acceptance criteria

- [x] Create, update (modal Save), and delete (inline Confirm) all trigger the
      same region refresh: nonblank active query reruns the search, otherwise
      `read` reruns
- [x] Module-acceptance case: update a record under an active query so it stops
      matching — it disappears from results; delete under an active query —
      membership and ranking stay correct
- [x] The whole records region is replaced through the shared renderer (no
      per-row patching)
- [x] `bun test`, `bun run typecheck`, `bun run lint` clean
- [x] **Human sign-off**: full CRUD-under-search interaction validated on the
      running app — this closes the 4.3 tracer

## Living demo

With a search active on the reference capability, edit a matching record so it
no longer matches and watch it leave the list; delete another and watch the
results rerun correctly.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.3-full-crud-platform-presentation/issues/01-modal-edit-mode-and-save.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.3-full-crud-platform-presentation/issues/02-confirmation-gated-record-delete.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.3-full-crud-platform-presentation/issues/03-debounced-search-chrome.md

## Implementation notes

- Create, update, and delete forms now opt out of per-row HTMX success swaps and
  carry the platform refresh metadata (`data-records-target-id`, committed
  `read` URL, and optional committed `search` URL). Successful mutations all call
  the same browser refresh helper.
- The shared refresh helper reads the active search field at mutation completion:
  a nonblank query reruns `GET /capability/:id/search?q=...`; blank or whitespace
  reruns committed `read`. It replaces the whole records region, reprocesses the
  returned fragment through HTMX, and preserves the existing search/no-match
  presentation state.
- Initial HTMX read, search, and post-mutation refresh now claim one shared
  per-records-region request owner. A new claim aborts the prior request when
  possible and, independently, prevents every stale response from rendering.
  This keeps one active writer even when search begins after mutation refresh or
  two mutation reconciliations overlap.
- The committed Action inventory is part of the presentation interface, so the
  approved two-Action transition renders read detail without dead Edit/Delete/Search
  affordances.
- Each admitted record write wraps the full generated Handler and presentation
  completion in one coordinator-owned SQLite transaction. Server-side failure
  rolls back; a transport-ambiguous outcome reconciles current search/read before
  inviting a retry.
- Update/delete modal success keeps its existing close/focus behavior, but focus
  now falls back to the first surviving result when an updated record no longer
  appears under the active query.

## Verification

- `bun test` — 521 passing, 0 failing, 2 snapshots
- `bun run typecheck`
- `bun run lint` — 189 files checked, no fixes
- `git diff --check`
- Final focused presentation/demo/router run — 72 passing, 0 failing. This
  includes transaction rollback, literal metacharacter search in both installed
  five-Action capabilities, lossless exact-datetime editing, and mutation outcome
  classification.
- Browser automation on the existing `http://localhost:3030` server, using the
  five-Action reference fixture:
  - search **quiet**, edit **A quiet beginning** to **A changed beginning**, and
    confirm the result leaves the list. Network trace showed `POST update`
    followed by `GET /capability/field_lifecycle_demo/search?q=quiet`.
  - search **cafe**, delete **Ready to remove — CAFÉ ÅNGSTRÖM**, and confirm the
    result leaves the list. Network trace showed `POST delete` followed by
    `GET /capability/field_lifecycle_demo/search?q=cafe`.
  - search **brandnew**, create **brandnew search creation**, and confirm the new
    result appears under the active query. Network trace showed `POST create`
    followed by `GET /capability/field_lifecycle_demo/search?q=brandnew`.
  - the 2026-07-16 quality pass additionally searched literal **%** and confirmed
    the correct no-match state, then edited and deleted the accented **cafe**
    result under the active query. The modal closed, focus/results reconciled,
    and the active search stayed intact after each committed mutation.
- Re-ran `bun run demo:five-action-reference` after browser verification to
  restore the reference fixture to its canonical seed state.

## HITL test instructions

1. Ensure the app server is running on port 3030 (`bun run dev` if needed), then
   run `bun run demo:five-action-reference`.
2. Open `http://localhost:3030`, choose **Journal entry**, and search **quiet**.
   Open **A quiet beginning**, choose **Edit**, change **What happened?** to
   **A changed beginning**, and choose **Save**. The modal should close and the
   active search results should rerun to the no-match state.
3. Run `bun run demo:five-action-reference` again. Search **cafe**, open
   **Ready to remove — CAFÉ ÅNGSTRÖM**, choose **Delete**, then **Delete record**.
   The modal should close and the active search results should rerun to the
   no-match state.
4. Run `bun run demo:five-action-reference` again. Search **brandnew**, open
   **New Journal entry**, enter **brandnew search creation** for **What happened?**
   and **brandnew** for **Tags**, then choose **Add**. The same active search
   should rerun and show the newly created record.
