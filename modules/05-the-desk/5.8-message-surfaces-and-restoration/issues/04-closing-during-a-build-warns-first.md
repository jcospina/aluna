# Leaving a running build or evolution through in-app navigation warns first

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.8 — Message surfaces and restoration
(PLAN decision 17, amending design D3: `modules/05-the-desk/PLAN.md`)

## What to build

Leaving the live run kills it, so every in-app action that would remove that
content proceeds only on confirmation.

- Putting the window away while a build or an evolution is running raises a
  warning first.
- Clicking another capability logo and browser Back/Forward raise the same warning
  before they can replace a running build/evolution surface. Clicking the current
  provisional tile only refocuses the narration and needs no warning. Delete's
  destructive preflight remains the refusal owned by 5.9/02.
- The warning is an inline confirmation row appended to the still-mounted build
  or evolution surface. It does not replace the content region, open a modal or
  trigger that region's cleanup merely by appearing.
- Backing out of the warning leaves the run untouched and still running.
- Confirming **routes through the existing cancel path** rather than a second
  teardown, so there is one way a run ends and one place that has to be correct.
  The cancel path accepts one post-cancel continuation: ordinary Cancel restores
  5.8/02's descriptor; confirmed put-away closes; confirmed logo switch opens its
  target; confirmed history traversal renders its requested canonical address.
  Restoration is not briefly painted before those continuations, and the history
  continuation neither duplicates nor skips an entry.

This is an amendment to D3, not a reversal: close still means *put away* and still
changes nothing in storage. It is simply no longer silent when there is something
running to cancel.

The warning is scoped to a running build/evolution, not a new draft-persistence
system. Search, record subviews and half-typed forms remain the DOM-only state
5.6/03 explicitly makes ephemeral; putting away an idle form discards that draft
without storing or restoring it. This issue adds no dirty-form tracker.

## Acceptance criteria

- [ ] Putting the window away during a build or an evolution raises a warning
      before anything is torn down
- [ ] Logo switching and Back/Forward use the same warning before replacing a live
      run; refocusing its provisional tile does not
- [ ] The warning stays inside the mounted run surface; showing it neither swaps
      the content target nor fires its cancellation cleanup
- [ ] Backing out leaves the run running and the window open
- [ ] Confirming cancels through the existing cancel path — no second teardown
      path exists
- [ ] After the one cancel teardown, the captured put-away/logo/history action
      completes without first restoring a transient surface or corrupting history
- [ ] Putting the window away with nothing running is still silent and still
      changes nothing in storage
- [ ] No draft persistence or dirty-form tracker is introduced; idle DOM-only
      form state follows 5.6/03's explicit ephemeral contract
- [ ] Focus enters the warning, Escape backs out, and either outcome restores a
      predictable focus target
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Start a build, then click the clay lamp. Confirm the warning appears; back out and
confirm the narration is still streaming. Click the lamp again, confirm, and watch
the build cancel and the window go away without flashing its displaced content.
Repeat with an evolution, a different capability logo, and browser Back; each
confirmed action should land exactly where it asked. Then put an idle window away
and confirm no warning.

## Blocked by

- modules/05-the-desk/5.8-message-surfaces-and-restoration/issues/03-the-prompt-bar-speaks-and-refusals-render-where-they-arrived.md
