# Reduce Motion quiets travel, not life

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.11 — Contrast, motion and focus
(PLAN decision 44: `modules/05-the-desk/PLAN.md`)

## What to build

**Motion is on by default for everyone and is part of the product's personality.**
When the OS setting is on, Aluna stops **positional travel** — windows flying
open, content sliding, press-jumps — because that is what triggers nausea, while
**in-place character continues**: the companion will keep breathing, blinking and
reacting once it lands, and nothing else in place is flattened either.

Mechanically this is neither of the two things the codebase currently has:

- **not** the built blanket reset, which kills everything including in-place life,
- **not** the design's per-component opt-in, which leaves press transforms jumping
  because only transition declarations sit inside the no-preference branch.

**It is one authored axis.** The token layer exposes a central travel scale used
by positional translate/distance and its duration; Reduce Motion sets that scale
to zero. In-place animation uses a separate duration/transform path and is
untouched. A stylesheet check rejects positional travel that bypasses the shared
axis, which is what makes the promise enforceable without a hand-maintained
component selector list. A new component inherits the behavior by using the
ordinary motion primitives, and a raw bypass fails loudly.

## Acceptance criteria

- [ ] With Reduce Motion on, no element travels: windows do not fly open, content
      does not slide, presses do not jump
- [ ] With Reduce Motion on, in-place animation continues — nothing in place is
      flattened
- [ ] With Reduce Motion off, motion is unchanged and on by default
- [ ] The behaviour comes from one central axis, with **no per-component selector
      list**; a newly added component inherits it without being enumerated
- [ ] A style check rejects raw positional travel that bypasses the shared axis,
      while allowing independently named in-place animation
- [ ] The blanket reset is deleted and the per-component opt-in is not
      reintroduced
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Turn on the OS Reduce Motion setting and open a capability: the window appears
without flying, content swaps without sliding, and pressing a button does not
jump. Anything animating in place keeps animating. Turn the setting off and
confirm the full motion returns. Add a throwaway component with a travel
transition and confirm it is quieted without being listed anywhere.

## Blocked by

- modules/05-the-desk/5.11-contrast-motion-and-focus/issues/01-the-contrast-audit-and-the-focus-ring-split.md
