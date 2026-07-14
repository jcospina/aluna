# Post-mutation records-region refresh

Status: ready-for-agent

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

- [ ] Create, update (modal Save), and delete (inline Confirm) all trigger the
      same region refresh: nonblank active query reruns the search, otherwise
      `read` reruns
- [ ] Module-acceptance case: update a record under an active query so it stops
      matching — it disappears from results; delete under an active query —
      membership and ranking stay correct
- [ ] The whole records region is replaced through the shared renderer (no
      per-row patching)
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: full CRUD-under-search interaction validated on the
      running app — this closes the 4.3 tracer

## Living demo

With a search active on the reference capability, edit a matching record so it
no longer matches and watch it leave the list; delete another and watch the
results rerun correctly.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.3-full-crud-platform-presentation/issues/01-modal-edit-mode-and-save.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.3-full-crud-platform-presentation/issues/02-confirmation-gated-record-delete.md
- modules/04-explicit-loop-ii-full-crud-and-evolution/4.3-full-crud-platform-presentation/issues/03-debounced-search-chrome.md
