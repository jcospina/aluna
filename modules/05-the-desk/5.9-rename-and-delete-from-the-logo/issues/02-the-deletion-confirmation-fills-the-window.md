# Delete's confirmation fills the window in product voice, and commit puts the window away

Status: ready-for-agent

Type: HITL — this is the destructive path and the confirmation copy is authored
product voice. Implementation is fully specified and agent-ready; a human reads
the words and exercises the path before sign-off.

## Epic

Module 5 — The Desk · Epic 5.9 — Rename and delete from the logo
(PLAN decision 20; ADR-0006: `modules/05-the-desk/PLAN.md`)

## What to build

The confirmation fills the window as everything else does, in authored product
voice, and **the path stays zero-AI**.

**ADR-0006's deletion contract is unchanged underneath** — advisory preflight,
lease-held reverse-dependency revalidation, the drain, the tombstone. Only its
content-area sentences become window sentences.

- **On commit the tile vanishes.** If the deleted capability was the one open
  before confirmation (or the desk was bare), the window puts itself away. If a
  different capability was open, its current canonical collection is restored;
  deletion must not close an unrelated capability. There is no terminal state for
  the deleted capability.
- **Backing out with "Keep it" restores through 5.8/02's data-free restoration
  path** — the displaced capability's current canonical collection or the bare
  desk, not a captured record payload or half-typed draft, and not a second
  restoration mechanism.
- A deletion blocked past the drain deadline reports **in the window** rather than
  failing invisibly, which is what 5.8/01 raised the deadline to make rare and
  what 5.8/02 gave a surface.

Every sentence on this path is authored. No model writes any of it.

The confirmation may take the window only after a desk-action preflight proves no
build or evolution is currently using that live content region. If one is, the
Delete request is refused on the prompt bar under 5.8/03's desk-furniture rule and
the run stays mounted; the confirmation must not become a second way to cancel a
run. Once admitted, deletion joins the coordinator in ordinary FIFO order and the
existing lease-held revalidation remains authoritative.

## Already standing after 5.6/01

The window puts itself away when a deletion leaves it holding nothing. That is not a
deletion rule but the window's own invariant — a window that holds nothing does not
exist — and it arrived with the window because the CSS that used to hide the shell's
empty content area went with that content area. It fires for every deletion whose
restoration is neutral: committed, already gone, refused, failed before commit, and
**Keep it** with nothing behind it. What this issue still owes is the confirmation's
*shape* in the window and what the window says while it happens.

## Acceptance criteria

- [ ] Choosing Delete fills the window with the confirmation, in authored product
      voice, with no model involved anywhere on the path
- [ ] Window takeover focuses the confirmation heading; the surface is an
      ordinary in-window section with no dialog role, inertness or focus trap
- [ ] Delete cannot replace a running build/evolution surface; that preflight
      refusal speaks on the prompt bar and leaves the run untouched
- [ ] The advisory preflight, lease-held reverse-dependency revalidation, drain
      and tombstone are unchanged; only their prose moved
- [ ] A refusal on reverse dependencies renders in the window and names what
      depends on the capability
- [ ] "Keep it" restores through the canonical capability-or-desk contract,
      without capturing a record payload, search term or draft
- [ ] Commit removes the tile; it puts the window away only when the deleted
      capability was previously open or the desk was bare, and otherwise restores
      the unrelated capability that the confirmation displaced
- [ ] A deletion blocked past the drain deadline reports in the window
- [ ] The drain case consumes 5.8/01's `deletion_drain_timeout` outcome and does
      not reuse a generic pre-commit sentence
- [ ] Every pre-commit refusal, timeout or failure reopens the read gate, holds
      the authored message until dismissal, and then takes the same restoration
      path; no success-like terminal is left in the window
- [ ] Keep it, dismissal and commit each restore focus to the next meaningful
      surviving control rather than the deleted or displaced menu item
- [ ] **Sign-off gate:** the human has read every sentence on the path and
      exercised the confirm, the back-out and the blocked case
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a logo's menu and choose Delete. The confirmation fills the window. Press
"Keep it" and confirm the window gives back what it displaced. Open the menu again
and confirm: the window puts itself away and the tile vanishes from the desk.
Then keep capability A open while deleting capability B from its logo and confirm
A returns after B's tile vanishes. Finally try to delete a capability something
else depends on and read the refusal in the window.

## Blocked by

- modules/05-the-desk/5.9-rename-and-delete-from-the-logo/issues/01-a-context-menu-on-the-logo-carrying-rename.md
