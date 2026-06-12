# Commit swap — content area + toolbar out-of-band

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.6 — Shell render
+ commit swap (`docs/modules.md` §2.6, ARCH §6.1, §6.2 step 5, PLAN flow step 7:
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The commit moment as the user sees it: the build finishes, and in **one** SSE
response the content area becomes the new capability and the capability toolbar
gains its entry — no reload, no second round-trip.

- **The swap.** On commit, the job's stream delivers the finished view into the
  content area and the new toolbar entry out-of-band (`hx-swap-oob`), then
  `done` closes the stream. Uses the event vocabulary finalized in the epic's
  spike issue.
- **What lands in the content area** is the capability's cached, data-free
  `list` view (ADR-0004) — its dynamic region immediately loads live records
  through the capability's `read` action.
- **Sidebar state.** The new entry appears in the sidebar; when it is the
  user's first capability, the shell's `hasCapabilities` presentation state
  flips and the sidebar appears.
- **Define the toolbar-entry fragment once.** The entry markup this issue
  introduces is the canonical one — load-time rehydration (epic 2.1) reuses it,
  so the out-of-band path and the on-load path can never drift apart. Document
  the fragment's home for that reuse.

## Acceptance criteria

- [ ] On commit, one SSE-driven response swaps the content area and updates the
      sidebar out-of-band; no reload, no extra round-trip
- [ ] The new entry appears in the sidebar; `hasCapabilities` flips when it was
      the first capability
- [ ] The swapped-in view is the cached data-free `list` view, and its dynamic
      region loads live data through the `read` action
- [ ] The toolbar-entry fragment is defined once and documented for reuse by
      load-time rehydration
- [ ] The M2 demo runs through the commit moment: prompt → narration → the
      Notes entry appears → the list + add-note form show → adding a note
      persists and renders

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.5-capability-builder-and-build-queue/issues/07-commit-and-rollback.md
- modules/02-explicit-loop-i-build-your-first-capability/2.6-shell-render-and-commit-swap/issues/02-prompt-bar-wiring-and-busy-state.md
