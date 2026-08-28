# Fail, stale and no-op end the narration in the window, hold it, then give back what the build displaced

Status: done

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

- [x] A failed build, a stale refusal and a measured no-op each end the narration
      with a distinct final line in product voice, and none of them commits
- [x] Each of the three holds the window until the user dismisses it
- [x] Dismissing restores the displaced capability's current canonical collection
      or the bare desk, resolved against the then-current registry; search,
      record, edit and delete-confirm state are cleared
- [x] Cancel restores immediately with no dismissal step
- [x] The restoration descriptor's shape is unchanged; its modal-closing half is
      gone
- [x] Every non-activating terminal removes its provisional build tile, while
      activation replaces it exactly once
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Force a failure, a stale refusal and a no-op in turn. Each ends the narration with
its own final line and holds the window until dismissed, then gives back the
capability that was in the window. Cancel a build and confirm it restores
immediately with nothing to dismiss.

## Blocked by

- modules/05-the-desk/5.8-message-surfaces-and-restoration/issues/01-the-drain-deadline-rises-above-the-handler-timeout.md

## What landed

**The three endings say their piece where the person is already looking.** A build
that fails, is refused as stale, or comes back a measured no-op now ends its
narration with `renderBuildEnding` (`src/web/fragments.ts`) — the authored line as
a `<p data-build-ending>` into the log's own `aria-live` region, and, riding with
it out of band, the run's control changed from **Cancel** to **Continue**. The
four authored sentences (failure, stale, measured no-op, and the candidate that
could not be shaped) are unchanged and are pinned as four different sentences. The
`#prompt-notice` copy those terminals used to leave behind is gone: the log is
already the live region, so the desk gains no notice surface of its own (decision
23). `#prompt-notice` keeps every other caller — the blank prompt, the warm
deflections, and each of capability deletion's four outcomes.

**The window holds, and the shell is what holds it.** The presenter cannot wait —
it runs under the build lease — so it streams the same three events in the same
order it always did, and the *shell* parks the restoration instead of placing it.
`holdRestoration` (`public/app.js`) intercepts the `fragment` message for a run
that already carries an ending and puts the HTML in a `<template>`, which is
unreachable from `querySelector`; without that, the restored collection's own
`hx-trigger="load"` would fetch records into a subscriber nobody can see and fetch
them again on the way out. `htmx:sseClose` then promotes nothing, and
`giveBackTheWindow` is what the press runs. Cancel never reaches any of it — it
has no ending, because the person who pressed it already knows why the run
stopped.

**The control is keyed by the build id.** The shell admits one subscriber, but it
can only refuse one that has already landed — two submissions inside one round
trip are exactly the queued-submit window that guard exists for. With a fixed id,
one run's ending would out-of-band its way onto the *other* run's Cancel and offer
to dismiss a build that was still going.

**Both button faces moved to `.btn--outline`.** `design/design-system.md` says
outright that `ghost` is not a name in this system and neither is `neutral`;
`.btn--outline` is the named slot for the action you take when you are not taking
the action. The Cancel this issue rewrote came along with it.

**The queue's last-resort failure is an ending too.** A pipeline that threw
*without* having presented its own terminal used to promote its apology into the
window — which deleted the capability the person had open and left a sentence
standing where it had been. It now ends the narration like every other failure and
the window holds; dismissing it drops the story and uncovers what the run had only
ever covered.

**The next prompt is a way of saying you have read it.** A held run would
otherwise block every later submission silently, because the one-subscriber guard
cannot tell a run that is working from one that is waiting. It can now: a run in
flight is still refused, and a run holding an ending is dropped out of the way.
Dropped, not restored — what it displaced was never taken away, only covered, and
the arriving build re-resolves its own restoration at its own terminal, so placing
the parked collection here would buy a records read for a surface the next
subscriber covers in the same frame.

**Restoration, unchanged in shape.** `RestorationDescriptor` is byte-identical:
capability id + incarnation, or the bare desk, resolved against the then-current
registry, carrying no search term, record subview, delete-confirm state or draft.
Its modal-closing half has nothing left to close since 5.7/01, which is now said
in `docs/adr/0002` (a dated `## Update`), `docs/adr/0006` (a dated `**Amended**`
block, with the superseded decision text restored rather than rewritten in place),
`docs/architecture.md` and `CONTEXT.md`.

**The provisional tile is unchanged and now pinned against the hold.** Removal
still rides `htmx:sseClose`, which fires for a held run exactly as before — the
server closes the stream after `done` whether or not the window is waiting. A run
that has ended has no in-flight story for a tile to be the way back to.

**`public/list-field.js`.** The repeated-value rows left `public/app.js` as a
module of their own. Not cosmetic: `biome`'s `noExcessiveLinesPerFile` fails
`public/app.js` at 509 counted lines against a maximum of 500, and CLAUDE.md
forbids buying the difference with a rule exception. The rows were the one
self-contained subject in there — reached only through events, needed by no code
path before Alpine starts — and they now have behavioural tests they never had.

## Findings from adversarial review, all fixed

Two reviewers, one on the client/transport mechanism and one on spec conformance.

1. *Closing the window destroyed the message with no trace.* The sentence used to
   ride `#prompt-notice`, which lives in the prompt bar and survives the window;
   now it lives only inside the window. Clay lamp, another capability's logo, or
   Back and the desk looked exactly as it had before the prompt was typed.
   `rescueHeldEnding` hangs on htmx's own `htmx:beforeCleanupElement` — the one
   thing every disappearance goes through — and carries the line to the prompt
   bar on the way out. A dismissal never reaches it, because the ending is retired
   before anything is released.
2. *A fixed control id could hijack a live run's Cancel.* Keyed by build id now,
   and pinned by a test that two runs cannot address each other's control.
3. *The next-prompt path fired a records read for a surface it immediately
   covered* — the exact cost the `<template>` park exists to avoid. Split into
   `giveBackTheWindow` (the press) and `dropHeldRun` (the next prompt); the second
   places nothing.
4. *The test for "the next prompt dismisses a held run" asserted none of it* — its
   double's `closest()` returned null, so the dismissal bailed at its first guard
   and the test counted a lookup. Rebuilt on the same harness that runs the rest of
   the glue, asserting the run is gone, the displaced surface is standing, no read
   was started, and the window was not put away.
5. *Nothing announced that the window was waiting on a press*, and stream close
   moved focus into the prompt field and wiped it — beside a line that says "mind
   trying again?". A run that ends held now keeps the person's words and hands the
   keyboard to the control, which is also the only way an assistive technology is
   told the control exists.
6. *The clay lamp posted a cancel for a finished run.* `buildJobIdIn` means "a run
   still in flight" again; `buildRunIn` is the new question for "is the window
   held", which is what a logo press has to ask. Without the split, pressing the
   open capability's own logo while an ending stood would have been declined as
   "already showing". This also disarms a trap for 5.8/04, whose warning would
   otherwise have asked about losing a build that finished minutes ago.
7. *"Got it" is Aluna's word.* It opens every build and CONTEXT.md's voice table
   uses it as the exemplar of Aluna speaking, so the button put both parties'
   words in one voice inside a single scroll. **Continue** — every other control
   in the product names the act from the person's side.
8. *`btn--neutral` is a name the design system explicitly refuses.* Both faces are
   `.btn--outline`.
9. *ADR-0006 was amended by rewriting its Decision in place.* Reverted and appended
   as a dated `**Amended**` block, the convention 0001/0004/0005/0007 use.
10. *The ADR-0002 amendment misstated what it corrected three times* — "two halves"
    of a three-item sentence, an incomplete list of `#prompt-notice`'s remaining
    callers, and "streams exactly what it streamed before" two sentences before
    saying two payloads changed shape. Rewritten.
11. *`docs/architecture.md` still said restoration happened "before sending
    `done`"* for all four terminals, contradicting the paragraph beneath it. Both
    the prose and the loop diagram now separate streaming from placement.
12. *CONTEXT.md's **Build presenter** was stale*, and `dismiss` sat on **Put
    away**'s `_Avoid_` list while this issue makes it load-bearing. **Ending** is a
    glossary entry now, and **Put away** says what the two words each mean.
13. *A held restoration is resolved at stream time and placed at dismissal time.*
    Kept — re-resolving needs a round trip the closed stream cannot make — and now
    stated plainly in ADR-0002 with why it is safe: records are re-read when the
    collection reaches the window, and every way the registry moves under a held
    run first takes the run's window with it.
14. *`list-field.test.ts` proved the file existed, not that it worked* — invert the
    add/remove dispatcher and every assertion still passed. It runs the module now.
15. *Assertion asymmetry*: three suites compared narration against the raw
    constant while their siblings compared against the rendered ending. They passed
    only because that one line happens to contain no escapable character. All go
    through `renderBuildEnding` now.
16. *`public/app.js`'s header no longer described its largest responsibility*, and a
    reworded docstring in `terminal-presentation.ts` had collided into saying the
    shell holds no desk sidecar. Both rewritten. A 101-column comment in
    `field-renderer.test.ts` shortened.
17. *One reviewer reported three failures under load* (`app.artifact-reconciliation`,
    `migrations`) on a run that executed 1503 of 1830 tests. Not reproducible: four
    full runs here were green end to end, and the files pass alone. Recorded rather
    than fixed — it is the load-sensitivity already known on this suite, and it is
    not in the code this issue touched.
18. *The extraction's justification was challenged* on the grounds that lint was
    clean. It is clean *because* of the extraction: `bun run lint` on the
    pre-extraction tree failed with `noExcessiveLinesPerFile` — "This file has too
    many lines (509). Maximum allowed is 500" — on `public/app.js`. The rule counts
    code lines, not the file's 944.
19. *Loosening the one-subscriber guard was flagged as scope creep.* Kept, and it
    is finding 3's other half: without it a held ending silently swallows every
    later submission, and the prompt bar has no voice to explain itself until
    5.8/03. Both halves of the guard are now under test.

## What live testing turned up, and what it changed

Four findings from the first real run, all addressed.

**1. A rejected API key hung the window for ever — and it was never this issue's code.**
`streamObject` reports a *transport* fault (a rejected key, a rate limit, a dropped
connection) to `onError` and nowhere else: probed against a live 401, its
`partialObjectStream` ended cleanly at 915ms and `object`/`usage` were **still pending at
45s**. The resolver awaits `object`, so it never returned, the pipeline never reached its
failure presenter, and the window narrated work that had stopped. Only model
non-conformance rejects `object`, which is why every provider fault behaved this way and
none had ever surfaced. `providerFault()` (`src/provider/spine.ts`) takes `onError` and
settles the handles the SDK leaves open, raced rather than replaced so it can never
override something the SDK settled itself. Verified end to end against the same rejected
key: **an infinite hang became a closed stream in 701ms carrying the failure ending.**
Pre-existing and out of this issue's scope; fixed here because it is what made the ending
unobservable.

**2. The run's control now stands where every other action does.** `.build-stream` was a
plain block, so Cancel sat directly under however much story there happened to be. It is
laid out like the collection and the record form now — a column that fills the window,
the story scrolling, the control on the window's own bottom edge — and the control moved
to the end of the subscriber so it is last in source order too.

**3. A declined prompt and a failed build stay different, deliberately.** A nonsense
prompt speaks on the prompt bar and gives the window straight back; a failed build holds
it behind **Continue**. The line is whether Aluna ever started building: a refusal at the
door took nothing away, so there is nothing to give back, while a build took the window,
worked, and came back empty-handed. This is what PLAN decisions 23/24/25 already draw, and
it was confirmed rather than changed.

**4. The window title is information now.** It used to keep the name of whatever
capability happened to be open, which is actively wrong while a build is making something
else — and `Making it` was wrong once the run stopped. Three hands write it: the desk says
`Thinking…` at submit (its own word, before there is anything else to say), the server
names the run the moment resolution settles what it is —
`renderBuildWindowTitle`, riding `fragment` with no event name added, `Building…` for a
new capability and the capability's own label for an evolution — and an activation renames
the window after the capability that took it, read off the ground so the title bar and the
logo cannot disagree. A run that ends without activating hands back the name it took over;
`BUILD_WINDOW_TITLE` is the one remaining fallback, now the noun `Aluna` rather than a
gerund, for a window a run opened and then failed in.

**Two more modules left `public/app.js`.** Adding the naming pushed it past biome's
500-line ceiling again, and then pushed `desk-window.js` past it too. Recovering a severed
capability deletion became `public/capability-deletion.js` and the window's record became
`public/desk-window-store.js` — both reached only through events or as pure functions, and
neither needed by anything before Alpine starts. `desk-window.js` re-exports the record's
API so no caller had to learn it moved.

## The regression this shipped with, and what now catches it

**The desk was dead on arrival and every check said it was fine.**
`public/desk-window-store.js` was lifted out of `desk-window.js` carrying the
`#design/desk-geometry.js` specifier its test neighbours use. Everything under
`public/` is served to a browser verbatim — no bundler, no import map — so the
browser could not resolve it, the module never loaded, `desk-window.js` died with
it, and the desk lost every logo press and the whole address. No capability
opened; no URL worked.

Nothing in the repo could see it. `tsconfig` maps `#design/*` and `#shell/*`, and
every test imports through Bun, which honours `package.json` `imports` — so
`typecheck`, `lint` and 1843 tests were green over a desk that could not start.
The gap was the verification method, not the toolchain: `curl` was used to check
that files were *served*, and a served file that a browser cannot resolve is
exactly what `curl` cannot tell you.

`src/presentation/shipped-modules.test.ts` closes it. Every specifier in every
shipped module must be a relative URL ending in `.js`, every module the shell
mounts must exist, and every module a shipped module reaches for must exist. It
was checked against the bug: reintroduce the `#design/…` specifier and two of its
three tests fail, naming the file and the specifier.

## The boundary drawn in the wrong corner

The held ending shipped with its control's drawn line painted at the **top-left of the
window** while the control stood at the bottom-right. Reproduced in a browser against a
throwaway server with a deliberately rejected key — which is how a failing build is had
for free — and read off the live DOM: the button was `position: static` with no inline
style, and its two layers were at `(-2, 44)` while the button was at `(390, 617)`.

The layers are absolutely positioned, so the drawn element has to be their containing
block, and `mountInk` is what makes it one — but only where it finds the element
`static`:

```js
if (getComputedStyle(el).position === "static") el.style.position = "relative";
```

**A detached element answers `""`.** Verified in the browser: `getComputedStyle` on a node
that is not in the document returns an empty declaration, `position` included. So the
guard silently declines, never asks again, and the layers belong to the nearest containing
block above — here `.desk-window__region`, which `container-type: inline-size` makes one.
Right size, right shape, nowhere near the thing they are the boundary of.

An out-of-band swap is exactly how an element gets mounted before it is in the document,
which is why **Continue** hit this and the Cancel it replaces never did. The fix is in the
ink system rather than in this epic's CSS, because nothing about it is specific to this
control: `ensurePositioned` treats an unanswerable ask as static, and is asked a second
time on the first draw — by which point the element is always in the document, because
nothing off-document can be measured.

The fake DOM had to be made honest first. It answered `getComputedStyle` for detached
elements the way it was convenient to rather than the way a browser does, so no test
could have expressed this. It now returns empty strings for a node that is not connected,
and `ink-system.test.ts` mounts a control off-document, attaches it, draws it, and asserts
it ends up positioned — checked both ways: the test fails with the fix removed.

## The line shaved by the surface it stood on

The held ending's control read as a bevelled, inset button rather than a drawn one —
reported from a real failing build and reproduced in a browser against the dev server.

The line itself was correct. Magnified eight times the control is a proper drawn box:
the two passes, the mitred corners, the fine hand's deviation, all as
`design/controls.html` renders the same `.btn--outline`. What was wrong was where the
control stood. `margin-left: auto` and `margin-top: auto` put it flush into the
**bottom-right corner of `.desk-window__region`**, and that region is the window's
scroller — `overflow-x: hidden`, `overflow-y: auto`.

**A drawn line paints outside the box it draws.** The SVG is exactly the element's box
and the ink escapes it (`overflow: visible`, `drawn-line.js`): a 2px stroke centred on
a deviating path, inked twice with the second pass down-right of the first. Measured on
the live control, it painted **1.03px past the region's right edge and 0.6px past its
bottom** — and a scroller clips what leaves it. The top and left strokes kept their full
weight, the right and bottom ones were shaved to about half. That asymmetry is what
reads as an inset shadow. Pressing would have pushed it 2px further in, and the
focus ring 1.5px further still.

The fix is the room `.capability-surface` already takes for the same reason, stated in
`public/css/demo.css` and now said out loud there: `margin-right` and `margin-bottom` of
`var(--space-2)`, so the drawn line, the press travel and the focus ring all land inside
the scroller. Neither axis gained overflow.

**And the control's own box was deformed.** The step between the story and the control
was bought with `padding-top: var(--space-2)` *on the button*, against its `4px`
bottom — room inside the drawn line rather than above it, which sat the label 2px below
centre. The step moved to `margin-bottom` on `.build-stream__narration`, where the
control's `margin-top: auto` cannot swallow it, and the button's padding is symmetric
again.

Both faces are covered, because the rule names both: **Cancel** stood in the same corner
throughout every run and was shaved the same way.


## Verification

- `bun run test` green — **1848 passed, 0 failed**, 2 shards, ~84s. `bun run
  typecheck` and `bun run lint` clean.
- **In a real browser**, against the dev server on :3030 — the check that was
  missing the first time. The desk loads with no console errors; a logo press
  opens its capability with records loaded and pushes `/capability/:id`; direct
  navigation to a `/capability/:id` URL opens it. A nonsense prompt puts the
  window away and speaks on the prompt bar. A real build ran end to end and the
  title went **`Thinking…` → `Building…` → `Houseplants`**, with Cancel standing on
  the window's own bottom edge throughout, the provisional tile replaced exactly
  once (four logos, zero provisional), and the prompt bar cleared and refocused.
- **The held ending, clicked through in a browser** against a throwaway server holding a
  rejected key: the narration ends with the failure line under the title of the capability
  the run displaced, **Continue** stands drawn on the window's bottom edge, and pressing it
  brings that capability's collection back with its records — with the typed prompt still
  in the bar, which is what the line invites. No console errors on any of it.
- The wire, unit level: `terminal-presentation.test.ts` drives all four held
  terminals and asserts each ends the narration with its own rendered ending,
  streams the restoration with no `prompt-notice`, never sends `commit`, and puts
  `narration` before `fragment` — plus that cancel emits `fragment` + `done` and
  nothing to dismiss.
- The shell, run rather than grepped: `app.build-ending.test.ts` evaluates
  `public/app.js` against a DOM double and drives the real sequence — the ending
  arrives, the restoration is parked in a `<template>` and never processed, the
  close promotes nothing, and the press gives back the displaced capability wired
  up exactly once. Also covered: a run whose restoration never arrived, cancel's
  immediate restore, the teardown rescue, the guard's two halves, and the prompt
  bar's two behaviours at close.
- The provider fix, against a live rejected key: all three handles settle at 837ms
  where none of them ever settled before, and the full run closes in 701ms with the
  failure ending. `providerFault` itself is pinned network-free in `spine.test.ts`.
- Live, against the dev server on :3030: `POST /prompt` returns a subscriber whose
  control is `id="build-stream-control-build-8a138235-…"` with
  `class="btn btn--outline build-stream__cancel"`, standing **last** in the section,
  and `POST /build/…/cancel` answers 202. The job was cancelled without its stream
  ever being opened, so no provider call was made. `/`, `/static/app.js`,
  `/static/list-field.js`, `/static/capability-deletion.js` and `/static/css/demo.css`
  all serve the new code.
- The vendored htmx was read directly to settle the two load-bearing assumptions:
  `swap` runs `findAndSwapOobElements` on the parsed payload *before* the
  `beforeend` insert, so the out-of-band control swap works through `sse-swap` and
  only the `<p>` is appended; and the SSE extension swaps synchronously inside the
  message dispatch, so the ending is in the DOM before the `fragment` message
  arrives.
