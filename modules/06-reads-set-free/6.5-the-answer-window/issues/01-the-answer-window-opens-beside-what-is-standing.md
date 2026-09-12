# The answer window opens beside what is already standing

Status: done

Type: HITL — the window's title and its empty/opening state are authored product voice,
and the three-window desk is the first thing the user meets that Module 5 did not
describe. Sign-off is on how it reads and behaves, not on the code.

## Epic

Module 6 — Reads Set Free · Epic 6.5 — The answer window
(PLAN decisions 21, 22, 23, 25; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A third window. It opens for a question, and it displaces nothing.

**It is a new caller of machinery that already exists** (decision 21).
`public/desk-window.js` already exports `openWindow`, `dismissWindow` and `nameWindow`,
and the developer panel is already a second window standing beside the capability
window. This issue adds the third on that precedent — not a new surface
primitive, not a window manager, and not a fourth.

**The capability window and the developer panel stand exactly as they were.** Opening an
answer must not put away, displace, resize, re-title or restore either of them. That is
the entire point: the user asks about the recipes they are looking at, and keeps looking
at them.

**M5's one-window rule is superseded here** (decision 21), and Module 5's files are not
edited to say so. The record of the change is the plan, ADR-0008, `architecture.md` and
`CONTEXT.md`, all of which already carry it.

**One answer window, and a new question replaces its content in place** (decision 25).
The frame is never closed and reopened between questions — no flicker, no re-placement,
no re-entrance. Only what it holds changes, which is the swap the window layer already
performs when a second capability is opened. Because it never closes it stays where the
user left it, so nothing about its position needs storing. Answers must not accumulate
and a second answer window is never created.

**It opens on classification, not on submit** (decision 23). The window appears once the
resolver returns `data_query`. A `reject` opens no window at all and speaks in
`#prompt-notice` exactly as it does today — M5's decision 24 and its notice contract are
left untouched, and this issue must not alter either.

**It has no logo on the desk and is dismissed, not put away** (decision 21). A capability
window can be put away because its logo is the way back, and the developer panel has its
tile; an answer has neither, because closing it destroys the answer and there is nothing
to return to. It uses `dismissWindow`, never `putAway`. The logo layer keeps meaning
exactly one thing — the capabilities the user has.

**Nothing here waits on the pet** (decision 22). No anchor, no placeholder slot, no
reserved space for a future companion.

Where the window sits when it first opens, how it is titled and how it looks are
presentation decisions for the sign-off gate, not specified here — except that it must
obey the same desk constraints every window obeys, including `--prompt-clearance`.

## Acceptance criteria

- [x] A question opens a third window; the capability window and the developer panel are
      untouched in position, size, title and content
- [x] The capability open before the question is still open, still showing the same
      content, after the answer arrives
- [x] A second question replaces the standing window's content in place; the frame is
      not closed, reopened, re-placed or re-animated, and a second window is never created
- [x] A window the user has dragged or resized is exactly where and as they left it after
      the next question answers
- [x] A prompt classified `reject` opens no window and speaks in `#prompt-notice`
- [x] `#prompt-notice` behaviour is byte-for-byte unchanged for every message it carries
      today
- [x] The answer window obeys `--prompt-clearance` and every other desk geometry rule
- [x] No logo, tile or address for the answer window appears anywhere on the desk
- [x] Dismissing it leaves no route back to the answer it held
- [x] Below the 720px breakpoint the window is the screen, as every window is; no
      phone-specific behaviour is added
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Run `bun run reset`, start Aluna on `:3030`, build Notes, and open it. Ask a question:
a second window appears and Notes is still open behind it, unchanged. Drag it somewhere,
then ask another question: the same frame stays exactly where you put it and only its
contents change. Open the developer panel and
confirm three windows coexist. Dismiss the answer and confirm the desk offers no way back
to it. Then type "delete everything" and confirm no window opens and the refusal speaks on
the prompt bar.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/05-when-nothing-can-answer-she-names-the-gap-and-stops.md

## What landed

`public/desk-answer-window.js`, a sibling of `public/desk-dev-panel.js` on the precedent
D13 set: its own `mounted`, its own default box, and the frame, lamps and gestures every
window shares. It keeps no store, no key and no record, and it takes no `onEnd` on its
gesture host, because there is nowhere for a finished drag to be written.

**How it learns a sentence was a question.** `renderAnswerWindowOpening` sends a marker
on `fragment` the way `renderBuildWindowTitle` already does — the attribute is what the
window is called, the text is what Aluna says while she has not looked yet. `app.js`
intercepts it, cancels the swap and tells the desk. No new transport and no new event
type on the stream.

**A question restores nothing, because it displaced nothing.** The first cut sent the
usual restoration in `preserve` mode; tracing the close path showed `shouldPreserveRestoration`
falls back to `replace` whenever the standing view is not the capability's canonical
collection, so a question asked with a record open would have put the collection back over
it. A question now sends no restoration at all: the glue marks the run
`data-preserve-active-view`, and `finishTerminalPresentation` removes only the subscriber,
gives back the borrowed name and puts away a frame the prompt stood up. The region is
untouched whatever it holds.

**Presentation, settled at the gate.** The title is the question, bounded by
`ANSWER_WINDOW_TITLE_LIMIT` so a 4000-character prompt does not become a window's
accessible name and both its lamps'. The opening state is *"Let me look at what you've
saved."* It opens centred and in front. A `data_query` no longer speaks on the prompt bar;
`reject` keeps its line and its flash untouched.

**Three stacking levels instead of two.** Two cannot order three windows without a tie, and
a tie hands paint order to the order the windows were built in. `raise` assigns a level per
window by recency, and `leaveStack` returns to the last window raised rather than the first
one that opened — so dismissing an answer gives back the window the user was in before it.

## Findings fixed

Two adversarial passes ran before the live test. Everything they raised is fixed, the
pre-existing and the informational included.

- A restoration would have replaced an open record on any question — replaced by the
  give-back above.
- `requestAnimationFrame` never fires in a hidden tab, so a question asked and then left
  for another tab left the window blank. Found live; the opening line is written in a
  task now, not a frame.
- The grip stops its own `pointerdown`, so a window resized by its corner was left behind
  the one it was not. `onStart` was missing from all three windows' gesture hosts.
- `leaving-a-run.js` asked "if you leave now, I'll stop making this" about a question,
  which makes nothing. A run that has handed the window back is no longer a run in it.
- A frame the prompt stood up on a bare desk was renamed on its way out; it is left alone
  and goes at close.
- Dismissing while the bar was disabled dropped focus to `<body>`; whichever control can
  take it gets it.
- `renderAnswerWindowOpening` reached through the `server/http` barrel, closing an import
  cycle — it imports the leaf.
- A straight apostrophe where the file's other sentences use a typographic one, and a
  hand-rolled escaper in the test that would have mis-asserted on a second apostrophe.
- `window--answer` was a class no stylesheet read; the answer body's rules are scoped
  under it.
- `watchViewport` dropped the `matchMedia`/`ResizeObserver` guards its siblings keep, and
  registered the question listener after them, so a missing window layer would have
  answered a question with nothing at all. The layer is demanded first.
- Test findings: a masked `leaveStack` assertion, a double that answered every selector,
  a CSS regex that required its rule to be first in its block, `entry.win.destroy()` never
  asserted, and order-dependent start-up tests.

Two notes for whoever picks up 6.5/03. `public/app.js` and `public/desk-window.js` are
both at the linter's 500-line ceiling, so a line added to either has to be bought back.
And the resolver classified *"delete everything"* as an evolution of the capability that
was open rather than as a `reject`, which is worth knowing before that sentence is used as
a refusal fixture on a real desk.

## Records amended

`design/index.html` disagreed with ADR-0008 in three places and the disagreement was the
user's call, not mine. With their sign-off: D7 now names three stacking slots, D13 names
the answer window as the second exemption, and the *"Where a disposable query answer
appears"* open question is closed — it no longer waits on the companion.
`design/design-system.md` and the shell's own prose follow.

## Rejected at the gate, and what changed

**A window that cannot be covered is a bug, not a feature.** The first pass gave the answer
window a slot nothing could paint over, because it has no logo, tile or address and so no way
back once buried. That bought a way back and cost the desk its ordinary behaviour: opening a
capability and watching it land underneath reads as a fault however it was planned. The slot
is gone. Stacking is three named levels assigned by which window the pointer last landed on,
so a press on any window brings it forward and no two are ever left sharing a level — a tie
would hand paint order to the order the windows were built in, which changes the moment one is
put away and opened again.

The dead end that slot was for turns out not to exist. Below the breakpoint the logo layer is
under the window, so the only way to open a capability is to put away what is on top: an
answer goes because the user closed it, never because the desk decided. On a desktop a covered
answer is still on screen and still clickable, and under a maximised window you un-maximise
and it is there.

**Nothing swaps, because no first window appears.** Aluna working out what a sentence is used
to ride `narration`, which lands in the window — so a prompt's own frame was revealed for the
length of one resolver call and then replaced by an answer window standing somewhere else,
which read as a window minimising and changing its contents. That sentence now rides the
prompt bar's own out-of-band slot (`renderResolvingNotice`). Nothing is placed in a window, so
no frame is revealed, and a question opens exactly one window: the answer's. A refusal stops
flashing an empty frame for the same reason. Every path that follows the resolver takes the
sentence down — the answer window opening, a run naming its window, a deflection's own notice,
and the cancelled and failed endings, which pass an empty notice for it.

## Verification

`bun run test` (2964 passed), `bun run typecheck` and `bun run lint` clean.

Live on `:3030` against nine real capabilities, twice — once for the build and once after
the two gate rejections. On the second pass, from a bare desk: the only window that ever
appeared was the answer's, with the desk's own sentence on the prompt bar while it worked and
gone the moment the window opened; opening a capability put it in front and the answer behind;
three windows held three distinct levels and a press on any of them brought it forward; and a
refused sentence opened no window while the bar carried the working sentence and then the
refusal, marked. First pass: a question opened a third window titled
with the sentence while Coffee tasting stood behind it unchanged in title, content and
address; the window was dragged and a second question kept the same DOM node, the same
title element id and the same box while only its title and body changed; three windows
coexisted with the answer at `TOP_Z` and exposed whichever of the other two was raised;
dismissing left no trace of the question anywhere in the document and returned focus to
the prompt field; a refused sentence opened no window and spoke in `#prompt-notice` with
its refusal marker; and below the breakpoint the answer window was the screen at
375×812 with its maximise lamp hidden, no grip, and the clearance strip reserved.
`localStorage` held only the developer panel's record throughout.
