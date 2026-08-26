# `/capability/:id` names the capability and nothing else

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.6 — The window, and the developer panel's second one
(PLAN decision 6; design D14: `modules/05-the-desk/PLAN.md`)

## What to build

The address says which capability is in the window, and that is the whole scheme.

- `/capability/:id` opens the desk with that capability in the window. Putting the
  window away returns to `/`.
- **Everything below capability identity lives only in the current DOM and dies
  with the tab** — the search term, which record is open, a half-typed edit. None
  of it enters the address, `localStorage`, or the Builder's restoration
  descriptor. A reload returns to the capability's canonical collection and
  loses the search, record subview and draft; that is the accepted cost of a
  scheme with nothing to keep in sync.
- **During a build the address keeps naming whatever the build displaced**, so
  restoration never has to touch it and a reload lands the user back where they
  were. A v1 activation then pushes the newly activated capability address when
  its canonical collection takes the window; evolution leaves the already-targeted
  address alone, and every non-activating terminal leaves the displaced address
  untouched.
- Direct navigation to `/capability/:id` renders the whole desk around that
  window, not a bare fragment.
- Logo opens/switches and putting away push their canonical addresses into browser
  history. `popstate` renders the addressed capability or bare desk without
  pushing again; Back/Forward therefore replay window identity instead of looping
  or desynchronizing it. Pressing the already-open logo only focuses the existing
  window and creates no duplicate history entry.

A link to a capability that no longer exists is 5.9/03's concern.

## Already standing after 5.6/01

Two of the criteria below are met before this issue starts, and not by accident:
deleting the content-target anchor left page assembly with no hole to compose a
capability into, so `/capability/:id` had to start rendering the whole desk and the
client had to start opening the window over the logo the address names.
`capabilityIdFromAddress` and the load-time opener in `public/desk-window.js` are
that work. What remains here is the whole of the *history* contract — pushing on
open, switch and put-away, `popstate` replaying without pushing again, the build
keeping the displaced address, and activation pushing exactly once — plus the rule
that nothing below capability identity ever enters the address.

## Acceptance criteria

- [ ] `/capability/:id` opens the desk with that capability in the window;
      putting the window away returns to `/`
- [ ] No search term, open record or draft edit appears in the address
- [ ] A build does not change the address; it keeps naming what the build
      displaced
- [ ] Successful v1 activation pushes the new capability address exactly when its
      canonical collection takes over; evolution/non-activation add no route entry
- [ ] Reloading during a build lands on the displaced capability's canonical
      collection (or the bare desk), never a stale record subview or draft
- [ ] Direct navigation renders the full desk, not a fragment
- [ ] Back/Forward replay `/` and capability-window identity without adding
      entries; refocusing the already-open capability does not duplicate history
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open a capability, copy the address, reload — the same capability is in the
window. Put the window away and confirm the address returns to `/`. Start a build
from a capability's window, confirm the address still names that capability, and
reload mid-build to land back where you were. Use Back and Forward across two logo
opens and a put-away and confirm the window follows the address exactly once.

## Blocked by

- modules/05-the-desk/5.6-window-and-developer-panel/issues/02-geometry-persistence-and-the-phone-form.md
