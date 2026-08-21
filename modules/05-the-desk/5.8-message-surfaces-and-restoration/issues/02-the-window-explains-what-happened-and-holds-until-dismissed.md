# Fail, stale and no-op end the narration in the window, hold it, then give back what the build displaced

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.8 — Message surfaces and restoration
(PLAN decisions 23, 25: `modules/05-the-desk/PLAN.md`)

## What to build

The window explains what happened in the window, and then waits.

**The message.** A build that fails, is refused as stale, or comes back a measured
no-op adds a **final line to the build narration in the same product voice** and
stops instead of committing. The build log is already an `aria-live` region and is
already where the user is looking, so the desk needs no notice component of its
own. Three outcomes, three authored lines — not one generic failure sentence.

**The wait.** Fail, stale and no-op **hold the window until dismissed**, then give
back what the build displaced. Cancel restores immediately, because the user
already has the information — they supplied it.

**The restoration.** The existing descriptor remains data-free: exact open
capability id + incarnation, or the bare desk. It resolves against the
then-current registry and restores that capability's canonical collection, not
the search term, record subview, delete-confirm state, or half-typed draft that
the build displaced. Those DOM-only states are deliberately cleared. Its
modal-closing half has nothing left to close, since the modal was deleted in
5.7/01.

Every non-activating terminal also removes a provisional build tile created by
5.4/02. Activation replaces that job-owned tile with the registry-backed tile;
terminal presentation may never leave both or neither by accident.

## Acceptance criteria

- [ ] A failed build, a stale refusal and a measured no-op each end the narration
      with a distinct final line in product voice, and none of them commits
- [ ] Each of the three holds the window until the user dismisses it
- [ ] Dismissing restores the displaced capability's current canonical collection
      or the bare desk, resolved against the then-current registry; search,
      record, edit and delete-confirm state are cleared
- [ ] Cancel restores immediately with no dismissal step
- [ ] The restoration descriptor's shape is unchanged; its modal-closing half is
      gone
- [ ] Every non-activating terminal removes its provisional build tile, while
      activation replaces it exactly once
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Force a failure, a stale refusal and a no-op in turn. Each ends the narration with
its own final line and holds the window until dismissed, then gives back the
capability that was in the window. Cancel a build and confirm it restores
immediately with nothing to dismiss.

## Blocked by

- modules/05-the-desk/5.8-message-surfaces-and-restoration/issues/01-the-drain-deadline-rises-above-the-handler-timeout.md
