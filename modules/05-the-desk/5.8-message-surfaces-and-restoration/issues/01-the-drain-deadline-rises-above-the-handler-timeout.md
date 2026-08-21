# The drain deadline rises above the longest a single handler may run

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.8 — Message surfaces and restoration
(PLAN decision 14; ADR-0006: `modules/05-the-desk/PLAN.md`)

## What to build

The read-drain deadline is 5,000ms while a capability handler may run for
10,000ms, so **a well-behaved reader can currently cause a deletion to fail for
reasons the user cannot see.** One window holds several concurrent read tokens
whenever a canonical read, a debounced search and a post-mutation refresh
overlap, which makes the overlap ordinary rather than exotic.

- The drain deadline is raised above the maximum a single handler may run, and
  the relationship is asserted rather than left to two constants that happen to
  be ordered correctly today.
- **Reads are not capped downward to close the gap.** Reads are what the user is
  doing, deletions are rare and deliberate, and killing a slow read to speed up a
  rare operation is the wrong trade.
- A deletion that still times out returns the distinct typed outcome
  `deletion_drain_timeout` for one authored product-voice refusal in the
  confirmation flow. It is not collapsed into the generic pre-commit failure, so
  the user can be told that active work did not finish in time. The window wiring lands with the deletion
  confirmation in 5.9/02; this issue owns the timeout contract, not a premature
  second deletion surface.
- **The documented invariant stands untouched:** never await a queued acquisition
  inside a read-token scope.

## Acceptance criteria

- [ ] The drain deadline exceeds the capability handler timeout, with a test
      asserting the ordering rather than the two literals
- [ ] The handler timeout is unchanged — no read is capped downward
- [ ] A deletion blocked by a slow but well-behaved reader completes once that
      reader finishes, rather than failing spuriously
- [ ] A deletion blocked past the deadline returns the typed refusal consumed by
      5.9/02 as `deletion_drain_timeout`, rather than throwing or collapsing into
      an unstructured/generic failure
- [ ] The never-await-a-queued-acquisition invariant is unchanged and still
      pinned by its test
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Hold a slow read on a capability and delete it. The deletion waits for the reader
rather than refusing, and completes when the read finishes. A developer preview
shows the drain waiting past the old five-second mark.

## Blocked by

- modules/05-the-desk/5.7-capability-content-in-the-window/issues/03-switching-capabilities-swaps-the-contents-not-the-frame.md
