# The prompt bar explains what happened to the prompt, and a structured refusal renders on the surface it arrived from

Status: done

## Epic

Module 5 — The Desk · Epic 5.8 — Message surfaces and restoration
(PLAN decisions 24, 26: `modules/05-the-desk/PLAN.md`)

## What to build

The desk has two places to speak, and each message goes to the one that was
asked.

**The prompt bar explains what happened to the prompt.** Anything rejected
*before* a build starts speaks there: a prompt the resolver refuses, or a build
refused because another one holds the lease. The 400ms refusal flash **stays as
the attention cue and stops being the whole message** — a wordless flash tells the
user something went wrong and nothing about what. The prompt notice that carries
refusals in the shipped shell finds its counterpart on the desk in the prompt bar
itself.

**A structured refusal renders on the surface it arrived from.** The 422 and 409
responses that are retargeted into a per-capability error node today render **in
the window** when the window is what asked, and **on the prompt bar** when the
prompt bar is what asked. A desk-furniture action that is refused before it can
take the window — for example Delete while a build still owns that window — also
speaks on the prompt bar. One ownership rule, no per-error routing table.

Per-field validation errors are a different matter and are settled by 5.10/04 —
those belong in the field, not on either surface.

The prompt-bar message is one replaceable `aria-live` slot, not a stack or a
timer. A refusal preserves the typed prompt and remains readable until the user
edits/retries or another desk message replaces it; editing clears the stale
sentence, an admitted prompt follows the existing clear-on-success lifecycle, and
focus stays in the originating control. Desk-furniture messages use the same slot
and are replaced/cleared by the next relevant desk action.

## Acceptance criteria

- [x] A prompt the resolver refuses speaks on the prompt bar, in words, with the
      flash as the cue rather than the message
- [x] A build refused because another holds the lease speaks on the prompt bar
- [x] A 422 or 409 arising from a window action renders in the window
- [x] A 422 or 409 arising from a prompt-bar action renders on the prompt bar
- [x] A logo/desk-furniture action refused before window takeover renders on the
      prompt bar and leaves the current window content mounted
- [x] No notice component is added to the desk
- [x] Prompt messages replace rather than stack, announce through one live slot,
      preserve refused input/focus, and clear on edit or the next successful/replacing action
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Submit a prompt the resolver refuses and read the reason on the prompt bar rather
than watching a wordless flash. Start a build, then submit a second prompt while
the lease is held, and confirm the refusal speaks on the bar. Trigger a structured
refusal from inside a capability's window and confirm it renders there.

## Blocked by

- modules/05-the-desk/5.8-message-surfaces-and-restoration/issues/02-the-window-explains-what-happened-and-holds-until-dismissed.md

## What landed

**The bar says what happened, and the flash stops being the whole message.** The prompt
bar's one live slot is now a subject of its own — `public/prompt-bar.js`, a module beside
the desk's others. Nothing calls into it: the shell glue and the deletion module both
*say what happened* and let it place the sentence (`aluna:prompt-bar-message`), which is
what keeps one pair of hands on the slot, on the 400ms cue, and on the rule that retires a
sentence about a run that has since ended. `renderPromptNotice` gained a tone
(`src/web/fragments.ts`), so a refusal arrives wearing `data-prompt-refusal` and the bar
flashes for it; an answer does not. Every warm deflection, the blank prompt, and capability
deletion's four outcomes now go through that one renderer rather than four hand-rolled
copies of the same markup.

**Two sentences the desk authors.** A second prompt while a run has the window, and a desk
action that would take the window from one, are both refused in words on the bar with the
run left exactly where it is. One opening sentence, because it is one true thing; the
second half names what the person just did. The one-subscriber guard used to
`preventDefault()` in silence.

**One ownership rule for a structured refusal.** `htmx:beforeSwap` reads the requesting
element off `detail.requestConfig.elt` — htmx fires that event on the *target*, so the
requester has to be taken from the request's own configuration — and a 422/409 renders in
the window when the window asked and on the bar when the desk asked. No per-error table:
the five `data-error-code` values are the pre-existing "is this a structured refusal" gate,
not a placement decision.

**The desk-action rule.** A request from the ground that would take the window is refused
while a run is using it, and clears the bar when it goes ahead. Where it would land is
htmx's own resolved answer (`detail.target`), borrowed rather than re-derived from
`hx-target` — the rule `public/swap-target.js` already states. A press on a capability's
logo is exempt from the refusal only, and by `matches` rather than `closest`, so a control
*hung on* a logo (5.9's menu and rename editor) is desk furniture like any other.

**A window is only opened for something to show.** Two things followed from putting the
sentence on the bar, both found by using the desk rather than by reading it.

A build has to take the window at submit — the story of a build needs somewhere to be told
and htmx resolves where a response lands before it sends the request — so a prompt that
turns out *not* to be a build was standing an empty frame up and taking it down again. The
frame is now stood up unrevealed (`is-pending`, `visibility: hidden` so it is still
measured and drawn at its real size) and shown by the run's first `narration` or `commit`
message. A build reveals it the moment its story starts; a deflection never does. And a
run that keeps the view it would have replaced now gives the window back the name it took,
instead of leaving a standing collection captioned `Thinking…`.

A blank prompt never reaches the wire at all. The bar reads what was typed with the same
rule the server does and answers it itself, so an empty field and one holding only spaces
are one submission with one answer — and the field carries no `required`, because the
browser's bubble is not the desk's voice, tells those two apart, and fires only after a
window has already been stood up. The server keeps its own guard for everything that did
not come from that bar.

**The cue.** Two rules that can never both apply. A blank prompt keeps the design's own
placeholder rule verbatim at 4.68:1; a refusal that preserves what was typed has no
placeholder on screen, so the rail takes `--well-alert` — the design's own declared fill
for an input in an alert state — for the same 400ms, leaving every type colour and every
contrast ratio untouched (11.85:1 idle, 6.98:1 under the `.prompt--busy` dimming).

## Adversarial findings, all fixed

Two reviews, 26 findings, none deferred.

- A refusal outlived the run it was about, and the ordinary clear-on-success then wiped
  words the person had typed while being told to wait. The close now asks the bar to retire
  a sentence about that run (`aluna:retire-run-sentence`, answered by cancelling) and keeps
  the unsent words when there was one.
- `asking.closest("[hx-target]")` reimplemented htmx target resolution; a `WeakMap` of
  xhr→requester reconstructed something htmx already hands over. Both deleted.
- An answer landing inside a refusal's 400ms left the bar flashing over the wrong words.
- The logo exemption used `closest`, which would have swallowed 5.9's own controls.
- `renderRestorationFragment` branded every notice a refusal on behalf of callers it does
  not control; the tone comes from the caller now.
- `public/capability-deletion.js` still wrote the slot directly, and flattened a
  refusal-marked reply into plain text on the severed-request recovery path.
- The prompt-form exemption was load-bearing and unreachable by any test, because the
  double's form was not an element. Four mutations are now caught that were not.
- The double had stopped resembling the DOM in four ways that each hid a rule: `dataset`
  was a second empty store beside the attributes, `textContent` was a field whose setter
  left children standing, `<template>` parsing flattened every fragment to one node, and
  `:scope >` matched a grandchild. All four are real now, and none of them props up an
  existing assertion.
- `public/app.js` crossed the 500-line cap, which is what moved the prompt bar into its
  own module rather than a second classic script (TypeScript does not share globals across
  two checked `.js` scripts, so that split could not typecheck).
- Copy: `DESK_ACTION_REFUSAL` was indistinguishable from `mutation_busy`'s sentence, which
  lands on a different surface for a different reason; and two router sentences used an
  ASCII apostrophe beside the curly ones they now sit next to.

## Verification

`bun run test` 1885 passed / 0 failed, `bun run typecheck` and `bun run lint` clean.

Exercised against the running app on :3030 with real server bytes, not only in tests:

- A blank prompt answers with its sentence and the cue, and the cue lets go 401ms later
  while the words stay.
- Two real resolver refusals — a `reject` and a duplicate — speak on the bar, marked.
- A second prompt during a live run is refused in words, the typed prompt is kept, and one
  run stays standing.
- A real 422 `mutation_busy` raised from a create *inside the window* renders in that
  capability's own error node, with the bar silent; the identical 422 sourced from a logo
  on the desk renders on the bar with the in-window node left empty and the window and run
  both untouched.
- A Delete-shaped desk control is refused before it can take the window; the confirmation
  never mounts and the run stays.
- An empty field and a field of spaces both answer on the bar with the cue, send zero
  requests, and mount no window at all.
- Asking for a capability the desk already has: sampled every 60ms for 14s, the window is
  never visible once, and the sentence lands on the bar.
- A real build: sampled the same way, the window goes straight from absent to visible at
  2.2s, which is the frame its first narration line arrived in.
- The three htmx contracts the routing rests on were confirmed live rather than assumed:
  `htmx:beforeRequest` carries an already-resolved `target`; `htmx:beforeSwap` fires on the
  target while `requestConfig.elt` names the requester; and `htmx.swap()` — the call the
  SSE extension makes — fires `htmx:oobAfterSwap` with `detail.target` as the live
  `#prompt-notice`.

## What ships dormant

No control on the desk can reach the desk-action refusal yet. Every element that targets
the window from outside it today is either the prompt bar or a capability logo, and both
are exempt by design. The rule is built because **5.9/02 names it** ("refused on the prompt
bar under 5.8/03's desk-furniture rule") and because 5.9/01's logo menu is what will hang
the first such control — but until that lands it is proved by tests, not by a press. The
same is true of a structured refusal *arriving from the desk*: the one live path is a logo
press during a deletion drain, which needs a capability mid-tombstone to see.

`renderCapabilityDeletionRefusalRestoration` is marked a refusal here and still renders on
the bar. 5.9/02 moves the reverse-dependency case into the window; the tone travels with
it and nothing here entrenches the placement.
