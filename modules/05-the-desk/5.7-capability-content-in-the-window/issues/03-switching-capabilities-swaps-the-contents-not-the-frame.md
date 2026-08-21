# Opening another capability swaps the contents without the frame moving, and cross-capability staleness gets no machinery

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.7 — Everything a capability shows lands in the window
(PLAN decision 15; design D2: `modules/05-the-desk/PLAN.md`)

## What to build

Opening a second capability replaces what is inside the window. The frame does
not move and does not redraw.

**Cross-capability staleness gets no machinery.** Verified against the registry's
spec module: read dependencies are strictly reads, self-dependency is rejected,
and no write-dependency concept exists anywhere. With one window only one
capability is visible, every open is a fresh read, and builds and deletions both
take the window. The sole remaining path to stale data is a second browser tab,
which is an **accepted known edge** rather than a hole to build machinery for.

- No invalidation bus.
- No version stamp.
- No refresh lamp — the window has no refresh verb by design.

The toolbar-era rehydration code goes with it: the hand-off of the records region
from the swap layer and the hand-rebuilt restore path are deleted, because they
existed to keep a toolbar's worth of parallel state alive and there is no toolbar.

## Acceptance criteria

- [ ] Opening a second capability replaces the window's contents; the frame keeps
      its position, its size and its drawn hand
- [ ] The outgoing capability's fetches, search controller and read tokens are
      released on the swap
- [ ] Every open is a fresh read; no cached collection is shown
- [ ] No invalidation bus, version stamp or refresh control exists anywhere
- [ ] The records-region hand-off and the hand-rebuilt restore path are deleted
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open one capability, move and resize its window, then click a second capability's
logo. The contents change and the frame stays exactly where it was, with the same
drawn hand. Add a record in one capability, switch away and back, and confirm the
fresh read shows it without any refresh control being involved.

## Blocked by

- modules/05-the-desk/5.7-capability-content-in-the-window/issues/02-record-deletion-keeps-its-shape-in-the-forms-action-row.md
