# The content region releases everything it started, on replace and on remove

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.3 — Content-region lifecycle and loud swap targets
(PLAN decision 13: `modules/05-the-desk/PLAN.md`)

## What to build

Cleanup belongs to the content region, not to the window. Whatever the content
started — in-flight fetches, search controllers, server read tokens — is released
when that content is **replaced or removed**. One rule covers both putting a
window away and swapping views inside it, where a window-scoped hook would leak
on every swap.

Today nothing is released at all. A fetch resolves against a detached node, and
the server-side read token stays held until the handler timeout — which is a live
defect on the shipped shell, not only a hazard for the window that has not been
built yet.

- A content region acquires a release scope. Anything the region starts registers
  with that scope: fetches and their abort signals, search controllers,
  observers, timers.
- Replacing the region's content runs the scope. Removing the region runs the
  scope. There is no third path.
- Aborting an in-flight request is what releases the server read token, so the
  client-side release and the server-side release are the same act rather than
  two mechanisms that have to agree.
- The invariant Module 4 documented stands untouched: never await a queued
  acquisition inside a read-token scope.

This lands **before** the window ships, because once the window exists, putting it
away becomes the only path by which a region disappears — which makes this the
single place that has to get it right. Wiring it to the shell's current content
area first proves the rule against a surface that already exists.

## Acceptance criteria

- [ ] Replacing a region's content releases every fetch, search controller and
      read token that content acquired
- [ ] Removing a region releases the same set
- [ ] The release covers a list → record → back swap, where the region's content
      is replaced twice without the region itself going away
- [ ] An aborted request releases its server read token promptly rather than at
      the handler timeout
- [ ] No fetch resolves against a detached node
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Start a search or a slow read on a capability, then navigate away before it
settles. A developer preview shows the region's live scope emptying and the
server's tracked reader count returning to zero immediately rather than after the
handler timeout.

## Blocked by

- modules/05-the-desk/5.2-drawn-line-and-border-ban/issues/02-drawn-records-seeded-from-the-record-id-and-the-border-ban.md
