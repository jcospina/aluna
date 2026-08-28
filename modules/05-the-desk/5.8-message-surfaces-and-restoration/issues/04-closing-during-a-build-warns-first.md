# Leaving a running build or evolution through in-app navigation warns first

Status: done

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

- [x] Putting the window away during a build or an evolution raises a warning
      before anything is torn down
- [x] Logo switching and Back/Forward use the same warning before replacing a live
      run; refocusing its provisional tile does not
- [x] The warning stays inside the mounted run surface; showing it neither swaps
      the content target nor fires its cancellation cleanup
- [x] Backing out leaves the run running and the window open
- [x] Confirming cancels through the existing cancel path — no second teardown
      path exists
- [x] After the one cancel teardown, the captured put-away/logo/history action
      completes without first restoring a transient surface or corrupting history
- [x] Putting the window away with nothing running is still silent and still
      changes nothing in storage
- [x] No draft persistence or dirty-form tracker is introduced; idle DOM-only
      form state follows 5.6/03's explicit ephemeral contract
- [x] Focus enters the warning, Escape backs out, and either outcome restores a
      predictable focus target
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Start a build, then click the clay lamp. Confirm the warning appears; back out and
confirm the narration is still streaming. Click the lamp again, confirm, and watch
the build cancel and the window go away without flashing its displaced content.
Repeat with an evolution, a different capability logo, and browser Back; each
confirmed action should land exactly where it asked. Then put an idle window away
and confirm no warning.

## Blocked by

- modules/05-the-desk/5.8-message-surfaces-and-restoration/issues/03-the-prompt-bar-speaks-and-refusals-render-where-they-arrived.md

## What landed

**The question.** `renderBuildSubscriber` now ships a confirmation with every run,
hidden, inside the run's own surface — it cannot be fetched when it is wanted, because
the swap that delivered it would be the teardown it exists to ask about. The desk only
stops hiding it, and hides the run's own Cancel while it stands.

**The one way a run ends.** `public/leaving-a-run.js` owns `endTheRun` — the run's cancel
route, the region rule, then htmx's own cleanup, in that order — and every way out of a
live run goes through it, `putAway`'s backstop included. Closing the stream *before* the
navigation is what keeps a cancelled run's restoration from being painted into a window
the person has already left. A detach that cannot run stops the whole thing before the
cancel rather than after it, so a run is never ended halfway.

**The three navigations.** The clay lamp, a logo switch and Back/Forward each ask first.
A confirmed switch replays the press the person already made, so a guarded and an
unguarded press are literally the same press. A confirmed traversal is taken by moving
again, not by rendering.

**History.** `public/desk-address.js` was lifted out of `desk-window.js`: the address, the
two verbs, and Back/Forward — which stopped being one line the moment a traversal had to
be *held*. Every entry the desk writes now carries its place in the run of them, so a held
traversal is stepped back off while the question stands and taken again exactly once on a
yes; the stack is neither an entry wider for the asking nor an entry shorter for the
answering. The number is read back from the entry the page loads into, so a reload does
not make the desk mismeasure its own history.

**Presentation.** The confirmation is read over the window's own body — a veil that fills
it from the title bar down, and a drawn panel centred in it. This is a departure from the
issue's "inline row" wording, made at the product owner's direction during the work; see
*Open question* below.

## Findings fixed

Two adversarial reviews ran before the live test; every finding is fixed.

- The counter restarted at zero on reload while neighbouring entries kept their old
  numbers, so a Back could measure as a Forward and step out of the document. It is now
  seeded from the entry the page loads into.
- A bare `steppingBack` flag could stick when the browser declined a `go`, eating the next
  real traversal for the life of the page. It names the entry it is waiting for instead.
- A traversal the desk cannot measure is no longer held: holding it meant rewriting an
  entry the desk does not own, with no way to undo that on a back-out. `HX-Replace-Url` is
  re-stamped so the case cannot arise inside the desk's own entries.
- The question could be raised in the gap between a run's commit and its stream closing,
  where the stylesheet has already taken it out of the page — a lamp that silently did
  nothing. A committed run is now over as far as the question is concerned.
- The shell woke the prompt bar on *every* stream close, so a confirmed leave threw focus
  at the prompt bar over the logo the window had just handed it back to, and wiped
  unsent words. Both close handlers now ask the same question.
- A confirmed switch onto the capability the run displaced left the window titled
  `Evolving…` over a settled collection.
- Confirming navigated even where the run had not actually ended, which could re-ask the
  same question and post another cancel each time.
- Focus was dropped on `<body>` when a run ended underneath a standing question; it now
  lands on whatever has taken the control's place.
- A second navigation while the question stood was dropped in silence; it now returns
  focus to the question.
- Escape answered the leave question *and* a record's delete confirmation behind it.
- The panel's `role="group"` had no accessible name, so the description on it was read by
  nobody.
- `startLeavingGuard` wired a fresh set of listeners on every call.
- `putAway` assembled a second ending out of different pieces; it calls `endRunIn`.
- Dead re-exports, a comment the import sorter had separated from its statement, a
  redundant script tag, and formatter churn in two unrelated files.
- Docs: `CONTEXT.md`'s address entry and voice-copy claim, `docs/architecture.md`'s history
  paragraph, and three comments that named the wrong module.
- Tests: the guard's own wiring (both answers, Escape, and the run ending underneath) had
  no coverage at all; the flagship "swaps nothing" criterion was a defeatable source grep
  and is now a recorded interaction set; the no-draft-persistence criterion had no test.

## Verification

- `bun run test` — 1932 passed, 0 failed
- `bun run typecheck` — clean
- `bun run lint` — clean
- Live on the running desk (`:3030`): all three navigations asked, backed out and
  confirmed; the run kept narrating while the question stood; one cancel posted per
  confirmation; history length unchanged across ask/back-out/confirm with Forward intact;
  the measurement survived a reload mid-history; a committed run was not asked about; no
  console errors.

## Open question

The issue and PLAN decision 17 both say the confirmation is an *inline row* and "not a
modal". What shipped is a veil over the window's body with a centred drawn panel, asked
for directly during the work. It is not a modal in the mechanical sense — nothing is
opened over the desk, nothing outside the window is covered or made inert, focus is not
trapped, and the whole of it is markup the run already carries — but it is the modal
*treatment*, and design D2 says there is no modal and no second surface anywhere in Aluna.
**Either PLAN 17 and D2 need amending to describe what is now true, or the row comes
back.** Nothing else in this issue depends on which way that goes.
