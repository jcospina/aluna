# Leaving a form with unsaved changes asks first

Status: ready-for-agent — built and verified; waiting on the owner's sign-off

Type: HITL — the question appears on every exit from the desk, and its wording is new
copy. A human walks each exit and approves the drawn question.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.3 — Ownership holds
(PLAN decision 32, amendment 6 and §"Design work this module owes"; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

Leaving a record whose form holds an upload, pending or still streaming, asks first.
Module 5 let half-typed forms die with the window. That still holds for anything a person
typed. An upload is the one exception, because losing it costs a transfer the person has
to repeat.

**It is the same question that guards a running build.** 5.8/04 built the question that
asks before leaving a running build or evolution (`public/desk/leaving-a-run.js`). This issue
reuses that question as it shipped, the veil over the window with its centred panel,
rather than drawing a second one. Its wording for a held upload is drawn in `design/`
first, and that drawing is part of the sign-off.

**It guards every in-desk exit:**

- putting the window away
- pressing another logo
- Back and Forward
- a prompt that takes the window
- Delete from the logo menu
- the form's own close, the create panel's included
- opening another record

**A confirmed leave discards the upload.** It aborts the in-flight requests, whose staged
files the server deletes, and hands the held keys to 7.3/02's pending-only route. Backing
out leaves the form and its upload untouched. A form with nothing uploaded still closes
without asking.

**What 7.3/02 left for this issue.** `holdsUpload(scope)` in
`public/controls/held-uploads.js` answers whether any file control under `scope` holds an
upload no save claimed or is still sending one; that is the question's trigger. The
discard half already runs: a control that leaves the page aborts its in-flight upload
(7.1/08) and hands its held keys to the pending-only route once it is off the page. A
confirmed leave that takes the form away therefore needs no call of its own, and until
this issue lands every such leave discards without asking. A leave while a save is out
aborts that save's request too, and its keys still go to the route, which leaves them
alone if the save committed first. Back and Cancel are disabled during a save, but
putting the window away and pressing another logo are not; what those exits do while a
save is out is this issue's to decide.

**No `beforeunload` dialog.** iOS Safari ignores it, a request sent after one is
unreliable, and a killed tab, a dead battery or a restarted server sends nothing at all.
A reload is 7.3/04's desk-load sweep's to handle.

**Widened by the owner on 2026-10-02.** The question now guards every unsaved change in a
record form, typed or uploaded, not only an upload, and says the owner's sentence: "You have
unsaved changes, are you sure you want to leave?". A form nobody changed, or one changed back to
what it held, still closes without asking. The criteria below are amended to match.

## Acceptance criteria

- [x] Each exit in the list above asks before leaving a form that has unsaved changes:
      a pending or streaming upload, a recording, or a changed field *(widened)*
- [x] The question is 5.8/04's shipped question, reused, with its wording drawn in
      `design/`
- [x] Confirming aborts in-flight uploads and sends held keys to the pending-only route;
      backing out changes nothing
- [x] A form nobody changed, or one changed back, closes without asking on every exit
      *(was: a form holding only typed text; reversed by the owner)*
- [x] No `beforeunload` handler is added
- [ ] **Sign-off gate:** the human has tried every exit with changes made and with none,
      and approved the question's wording
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, open a Photos record and pick a new photo. Try each
exit in turn: put the window away, press another logo, press Back, type a prompt that
takes the window, choose Delete from the logo menu, close the form, open another record.
Each one asks. Back out once and confirm the upload is still there. Confirm once and see
its ledger row enqueued. Then change only a title and try the exits: each asks. Put the title
back the way it was, or open a record and change nothing, and close it; it closes without
asking.

## Blocked by

- modules/07-files-upload-store-serve/7.3-ownership-holds/issues/02-a-discarded-upload-is-let-go-at-once.md

## What landed

**The question.** `public/desk/leaving-unsaved-changes.js` asks "You have unsaved changes, are
you sure you want to leave?" with **Keep editing** (focus lands there) and **Leave without
saving**. It is 5.8/04's question reused: the veil and panel moved from `public/css/demo.css` into
`design/styles/components/window.css` as `.window__leaving*`. The run's server markup
(`src/server/http/fragments/fragments.ts`) now wears those classes too, and the panel's drawn line
is in the design ink list. A run ships its copy hidden in its own surface. A form has no such
surface, so this question is built in the window's body when asked. Nothing is fetched or swapped
to show it. While it stands, the window comes to the front (`raiseWindow`,
`public/desk/window/desk-stack.js`). Everything it covers in the window's body is inert, and a
record form's save is held. The drawing sits beside the run's in `design/controls.html`, under
"A record, assembled" → "Leaving with unsaved changes". The prose is in `design/design-system.md`
and D3.

**What counts as unsaved.** `public/records/unsaved-changes.js` reads a record form's fields the
first time the person touches it (focusin, pointerdown, dragenter). The form counts as changed
when they differ from that reading, when it holds an upload no save claimed, or when a file or
recording would be lost (`losesIn`, a new `loses()` on each file control in
`design/scripts/files/`). A recorder still asking for the microphone loses nothing. Some things
re-baseline the form: a reset (a cancelled or committed create), and a committed save, which
takes what it *sent*. A datetime is read off the field typed into. A blank list row counts as
nothing. A form whose save is out (`aria-busy`) is the save's.

**The exits.** Put away, another logo and Back/Forward already stood behind `askBeforeLeaving`;
it now asks a run's question or the form's (`public/desk/leaving-a-run.js`). The rest go through
`public/desk/leaving-a-form.js`, which listens on `window` in the capture phase, ahead of htmx,
Alpine and the desk. Those exits are:
- a record's Back and Cancel
- the create panel's Cancel
- a record that opens
- Delete on a logo's menu, which closes the menu first with focus on its logo
- a prompt

A yes makes the same press again. The create panel's own Back only hides the panel, but a person
reads it as leaving, so with changes it asks too, and a yes replays the panel's Cancel, which puts
the form down and lets its upload go *(owner's correction at sign-off)*.

**Decisions this issue owned.**
- *A save in flight.* The save carries the upload, so no question and no route. The keys move to
  `carried` (`public/controls/held-uploads.js`), so a discard can never reach the coordinator
  ahead of the save. A refused save hands them back. One cut off by its form going leaves them to
  7.3/04's sweep, noted on that issue.
- *A prompt.* It asks when it is sent, because only the server learns whether it takes the
  window. Its yes is consent only: nothing is discarded, and the prompt is sent once. A build that
  then takes the window lets uploads go through 7.3/02's release path. A prompt the bar would
  refuse while a run holds the window is not asked about.
- *A run still working out its sentence.* The form stays on screen. A changed form asks its own
  question, and a yes stops the run before leaving. An unchanged form's exits ask the run's
  question, which is now visible before the run has drawn anything.
- *Widened by the owner.* Typed changes ask too, which reverses Module 5's half-typed-forms rule.
  The amendments are in both PLANs, CONTEXT.md (Put away), ADR-0009 and `docs/architecture.md`.

`PROMPT_FORM_ID` and `RECORD_FORM_SELECTOR` now live in the `public/core/shell-dom.js` leaf.

## Findings from adversarial review, all fixed

Four passes (Opus): spec and standards, behaviour, then two more over the widened version.

- *Lost without asking.* A recording being made or kept unsent (HIGH). A changed date, because
  the visible datetime input carries no `name` (HIGH). Exits while a prompt was being classified
  skipped the question (MEDIUM). All now ask.
- *The form under the question stayed live.* The keyboard could reach and save it (MEDIUM). Now
  inert, and record saves are held.
- *Gave too much up.*
  - A confirmed prompt discarded and forgot even when nothing left (MEDIUM). Now consent only.
  - A card that opens nothing counted as "another record" (MEDIUM). Now only openable records.
  - The create panel's own Back asked and then reverted only its files (MEDIUM). It was first made
    a non-exit; at sign-off the owner found an image-only draft left without asking, so it asks
    again and a yes now replays the panel's Cancel, putting the whole form down.
- *Questions that could not be answered.*
  - Asked in a window behind another or off-screen on a phone (MEDIUM-LOW), now raised.
  - The run's question asked before the run drew anything was invisible, now shown.
  - A stale question after the window went could swallow every navigation, now dropped.
  - Escape on a stale question moved focus (INFO), now ignored.
- *Asked or re-asked wrongly.*
  - A confirmed typed change re-asked forever on its replay. Now waived until touched again.
  - Tracking gaps after a committed save, a reset or a failed leave (MEDIUM-LOW). Now
    re-baselined as above.
  - A committed edit whose re-read failed read as unsaved (LOW).
  - A datetime twin, a blank list row and a recorder awaiting the microphone nagged (LOW).
- *Focus.* It went to the prompt bar after confirming a create Cancel; it now returns to the
  pressed control. In Safari it was left on `<body>` after backing out; the pressed control is now
  passed in (LOW). The logo menu stayed open beside the question.
- *Mechanics.* `raiseWindow` looped forever while iterating the set it re-adds to; the wiring test
  caught it. Every htmx form request had been treated as a save carrying uploads (INFO).
- *Repo hygiene.*
  - Policies stopped at the old module boundary; the `beforeunload` scan and the not-a-modal guard
    now cover the new modules.
  - The exits were untested end to end; a framed desk suite now covers them on the server's own
    markup.
  - `PROMPT_FORM_ID` had two exported sources; it now lives in the leaf.
  - Dead exports, literal attribute strings, stale comments and docs, a test name that overclaimed,
    and a whitespace-only change to a Module 4 file are all fixed or reverted.
- *Not changed.* The copy's comma splice (INFO): the owner dictated the sentence.

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 4487 tests, 0 failed.

New suites:
- `src/presentation/records/unsaved/`
  - `unsaved-changes.test.ts`
  - `leaving-a-form.test.ts`
  - `leaving-a-form.desk.test.ts`, the real collection, record and run markup on a framed desk
    with every listener wired
- `src/presentation/controls/file/held/held-uploads.leaving.test.ts`
- new cases in `held-uploads.test.ts` and `desk-stack.test.ts`

Live on `:3030` (Personal photos):
- *Upload exits.* With a photo held, all six scriptable exits asked: put away, another logo, Back,
  a prompt, Delete from the real logo menu, and the record's own Back and Cancel. Backing out of
  each changed nothing.
- *Upload confirm.* Confirming once sent one key to the route, and its ledger row and bytes were
  gone.
- *Create panel.* Its Cancel and Back asked. Confirming discarded once, and focus landed on
  **New** as a plain Cancel does.
- *Typed changes.* A changed title or date asked; putting it back closed silently. A confirm left
  once.
- *Save in flight.* A put away during a save asked nothing, and the record kept its photo `owned`.
- *Under the question.* Focus could not enter the covered form, and a scripted create submitted
  under it saved nothing.
- *Phone width.* The question works there too.

An earlier scripted submit, sent before saves were held, renamed the record "Lighthouse at dusk"
to "Changed"; it was put back through the edit form.
