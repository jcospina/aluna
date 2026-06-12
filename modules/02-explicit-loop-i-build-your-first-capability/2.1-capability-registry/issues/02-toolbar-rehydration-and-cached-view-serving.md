# Toolbar rehydration & cached-view serving

Status: ready-for-agent

## Epic

Module 2 — Explicit Loop I: Build Your First Capability · Epic 2.1 — Capability
Registry (`docs/modules.md` §2.1 & §2.6, ARCH §6.1, ADR-0004 "views are
data-free", PLAN 2.1(b):
`modules/02-explicit-loop-i-build-your-first-capability/PLAN.md`)

## What to build

The registry's read-side payoff: Aluna *remembers you*. On shell load, the
capability toolbar rehydrates from the registry, and clicking an entry serves
the capability's cached view — instantly, with no AI involved.

- **Rehydration on load.** The sidebar renders one entry per registry row,
  reusing the canonical toolbar-entry fragment defined by the commit-swap issue
  (so the on-load path and the out-of-band path can never drift). With at least
  one capability, the shell's `hasCapabilities` presentation state flips and
  the sidebar shows; a fresh user keeps the untouched cold-start state.
- **Click serves the cached view as-is.** A toolbar click loads the
  capability's cached, data-free `list` view into the content area straight
  from the version directory the registry points to — no regeneration, no AI
  call (the version-keyed cache is never stale because data never enters it,
  ADR-0004). The view's dynamic region then loads live records through the
  capability's `read` action.

This is the last piece of the module's acceptance demo: refresh the page → the
toolbar rehydrates → the note is still there.

## Acceptance criteria

- [ ] Fresh user (empty registry): sidebar hidden, cold-start state unchanged
- [ ] With registry rows: entries render on load and `hasCapabilities` flips
- [ ] Entry markup is the canonical fragment from the commit-swap issue — one
      definition, two consumers
- [ ] Clicking an entry serves the cached `list` view as-is (no regeneration,
      no AI call) and its dynamic region loads live data via the `read` action
- [ ] The M2 demo's closing beat passes: after a build and a page refresh, the
      toolbar rehydrates and the added note is still there

## Blocked by

- modules/02-explicit-loop-i-build-your-first-capability/2.1-capability-registry/issues/01-registry-store-and-capability-spec-shape.md
- modules/02-explicit-loop-i-build-your-first-capability/2.3-deterministic-router/issues/01-capability-router-and-handwritten-tracer.md
- modules/02-explicit-loop-i-build-your-first-capability/2.6-shell-render-and-commit-swap/issues/03-commit-swap-content-and-toolbar-oob.md
