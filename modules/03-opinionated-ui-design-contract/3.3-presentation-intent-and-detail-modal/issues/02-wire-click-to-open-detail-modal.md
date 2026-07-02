# Wire item click-to-open → prefilled read-only detail modal

Status: ready-for-agent

> **HITL — human visual sign-off required.** This is the end-to-end detail
> interaction the user performs; a human clicks an item and confirms the
> prefilled read-only modal on the running app before this issue is done.

## Epic

Module 3 — Opinionated Capability UI · Epic 3.3 — Presentation intent + detail
modal (read-only) (`docs/modules.md` §3.3, ARCH §6.3, ADR-0005 §3 & §6,
PLAN decision 7 & flow step 6:
`modules/03-opinionated-ui-design-contract/PLAN.md`)

## What to build

Wire the accessible item wrapper's click-to-open to the shared modal (3.2/04),
prefilled **read-only** from the escaped `data-item` payload and showing the
fields/order in `detail.shows`. This is the detail interaction the user sees.

- Clicking a rendered item opens the shared modal prefilled from that item's
  escaped payload — no round-trip, no read-single route.
- The modal shows the `detail.shows` fields in order via the centralized field
  renderer (3.2/01).
- Keyboard activation and focus management work through the accessible trigger.

## Acceptance criteria

- [ ] Clicking any rendered item opens the shared modal prefilled from its escaped
      payload
- [ ] The modal shows the `detail.shows` fields in the specified order, read-only
- [ ] Full record content shows even when the item visually truncates; no
      read-single route is used
- [ ] Keyboard activation + focus management work through the accessible trigger
- [ ] Demo: click an item in a built (or hand-written) capability list and the
      read-only modal opens prefilled; human visually confirms before done

## Blocked by

- modules/03-opinionated-ui-design-contract/3.2-platform-presentation-modules/issues/04-shared-read-only-detail-modal.md
- modules/03-opinionated-ui-design-contract/3.3-presentation-intent-and-detail-modal/issues/01-reshape-ui-intent-and-spec-generation.md
