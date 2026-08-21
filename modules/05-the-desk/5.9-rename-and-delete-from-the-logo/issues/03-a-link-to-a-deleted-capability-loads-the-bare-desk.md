# A link to a deleted capability loads the bare desk with a brief notice

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.9 — Rename and delete from the logo
(PLAN decisions 21, 26: `modules/05-the-desk/PLAN.md`)

## What to build

Opening `/capability/:id` for a capability that no longer exists loads the bare
desk and speaks a brief notice through the prompt bar's existing message region.
That covers the second-tab, bookmark and reload cases **without a window state or
a third notice component** — there is nothing to design inside a window for a
capability that is gone.

The brief interval before the tombstone commits needs nothing new either. Three
things can happen in that window, and all three are already structured refusals:

- an aborted read,
- `409 read_unavailable` on new reads,
- `422` on pending writes.

5.8/03 already says where a structured refusal renders — on the surface it arrived
from — so this issue adds no routing and no new component.

## Acceptance criteria

- [ ] `/capability/:id` for a deleted capability loads the bare desk, speaks the
      brief notice on the prompt bar, and opens no window
- [ ] The notice is authored product voice and does not persist past the next
      action
- [ ] In a second tab, an in-flight read cancelled by deletion releases its region
      scope without inventing a response; the next read or write renders the 409
      or 422 on its existing structured-refusal surface
- [ ] No window state and no notice component is added for this case
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Delete a capability, then open its old address in a second tab and confirm the
bare desk with its notice. Before deleting, open the capability in a second tab,
delete it in the first, and confirm the second tab's in-flight read and next
action are refused on the surface each arrived from.

## Blocked by

- modules/05-the-desk/5.9-rename-and-delete-from-the-logo/issues/02-the-deletion-confirmation-fills-the-window.md
