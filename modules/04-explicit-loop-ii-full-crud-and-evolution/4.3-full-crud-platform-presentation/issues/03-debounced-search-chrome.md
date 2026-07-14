# Debounced platform search chrome

Status: ready-for-agent

## Epic

Module 4 — Explicit Loop II: Full CRUD & Evolution · Epic 4.3 — Full CRUD
platform presentation
(PLAN decisions 19 and 20 (query boundary):
`modules/04-explicit-loop-ii-full-crud-and-evolution/PLAN.md`; ADR-0005)

## What to build

Platform-owned search chrome above every capability View's collection;
matching/ranking stays generated (the reference capability's hand-written
`search` for now).

- A debounced search field calls committed `GET /capability/:id/search?q=...`,
  replaces the records region, and renders results through the one item
  renderer.
- Platform chrome owns the loading, clear, and no-matches states. Clear
  restores read by calling `read` directly; a missing, empty, or
  whitespace-only `q` is the canonical-read boundary (decision 20).
- Search is local and ephemeral: no resolver call, registry row, version,
  cache, or build. Reads/search never touch the mutation coordinator.

## Acceptance criteria

- [ ] Every capability View shows the search field above the collection;
      typing debounces and replaces the records region with `search?q` results
      rendered through the shared item renderer
- [ ] Loading, no-matches, and clear states are platform-rendered; Clear (and
      whitespace-only input) restores the exact `read` collection
- [ ] No resolver/build/registry write happens on any search interaction
      (pinned by test or instrumentation assertion)
- [ ] Results open the same detail modal as read results
- [ ] `bun test`, `bun run typecheck`, `bun run lint` clean
- [ ] **Human sign-off**: search interaction validated on the running app
      against the reference capability (scalar and `string[]` matches)

## Living demo

Type into the search field on the reference capability's View: results narrow
live across scalar and list text fields, no-matches shows its state, and Clear
restores the full collection.

## Blocked by

- modules/04-explicit-loop-ii-full-crud-and-evolution/4.2-mutation-coordinator-split-tools-and-routing-actions/issues/06-read-dependencies-rehydration-and-search-normalization.md
