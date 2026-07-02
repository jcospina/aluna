# Shared read-only detail modal

Status: ready-for-agent

> **HITL — human visual sign-off required.** The modal is visible product
> surface; a human confirms it opens on-brand and read-only on a running preview
> before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.2 — Platform presentation modules
(the thick shell) (`docs/modules.md` §3.2 & §3.3, ARCH §6.1, ADR-0005 §1 & §3,
PLAN decisions 3 & 7: `modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

The shared platform modal every capability uses — open/close/prefill/focus
mechanics — rendering **read-only** detail content in Module 3 (M4 adds the Save
button to the same module). Prefilled from the escaped `data-item` payload so the
full record shows even when the item visually truncates; no read-single route is
added (ADR-0005 §3).

- One shared modal instance, a platform invariant (`modal: true` is never
  model-authored state, ADR-0005 §6): open, close, focus trap + restore, prefill
  from a record payload.
- Read-only detail content rendered via the centralized field renderer (3.2/01).
- Field selection/order defers to `detail.shows` once 3.3/01 lands; until then it
  renders spec order. Click-to-open wiring is 3.3/02.

## Acceptance criteria

- [ ] One shared modal module with open/close/prefill/focus mechanics and correct
      focus trapping/restore
- [ ] Renders read-only detail content from a record payload via the centralized
      field renderer
- [ ] No read-single route added; content comes from the escaped payload
- [ ] Platform tests pin the modal open/close/focus invariants
- [ ] Demo: a dev trigger opens the modal prefilled read-only; human visually
      confirms it is on-brand before done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/01-centralized-field-renderer.md
- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/02-list-scaffolding-container-and-item-wrapper.md
