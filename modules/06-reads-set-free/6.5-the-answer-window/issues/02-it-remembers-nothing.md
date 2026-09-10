# It remembers nothing

Status: ready-for-agent — built and verified; the sign-off is the only box left

## Epic

Module 6 — Reads Set Free · Epic 6.5 — The answer window
(PLAN decisions 21, 26; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The answer window is the one window with no memory of any kind. Everything below follows
from that single rule, and the rule is what makes "disposable" true at the surface rather
than only in the storage layer.

- **No logo, no tile, no address.** A capability window can be put away because its logo
  is the way back; the developer panel has its own tile. An answer window has neither, so
  there is no route to an answer that is not on screen. Nothing about it appears in the
  logo layer, and no address names it.
- **Dismissing it destroys the answer.** It uses `dismissWindow`, never `putAway` — the
  vocabulary difference is real and should be honoured in code and in any copy. Put away
  means retrievable; this is not.
- **A reload restores nothing of it** — not the answer, not the narration, and not its
  box. No answer window stands after a reload, whatever was on screen before. Note this
  is not in tension with 6.5/01: the frame keeps its place *across questions* because it
  never closes, not because anything was written down.
- **Nothing reaches storage.** No answer text, narration line, query, or result is written
  to the server, `localStorage`, the address, or a presentation record. The store's two
  existing keyed records — the capability window's and the developer panel's — are
  untouched, and no third key is added.
- **Future persistence is explicitly out of scope.** No history of past answers, no
  reopen, no "recent questions", and no groundwork laid for them. If persistence is ever
  wanted it earns its own decision; this issue must not half-build it.
- **The capability window and the developer panel keep their own persistence exactly as
  they have it.** This issue changes nothing about either.

## Acceptance criteria

- [x] No logo, tile, or address for the answer window exists anywhere on the desk
- [x] The window is dismissed via `dismissWindow`; `putAway` is never called for it
- [x] Dismissing leaves no route back to the answer, by any surface or address
- [x] A reload restores no answer window, no answer, and no box for it
- [x] No answer text, narration, query, or result reaches the server, `localStorage` or
      the address — proved by a test, not by inspection
- [x] The presentation store still holds exactly two keyed records, unchanged
- [x] Opening and putting away a capability leaves the answer window untouched
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Ask a question and get an answer. Look at the desk: no new logo, nothing in the logo
layer, no address you could bookmark. Dismiss the window and confirm there is no way to
bring that answer back. Ask another question, then reload — the desk returns with no
answer window at all. Open Notes and put it away throughout; the answer window is never
disturbed by either.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/01-the-answer-window-opens-beside-what-is-standing.md

## What landed

The window already behaved this way; nothing proved it. 6.5/01 pinned the module's shape by
searching its source for words it must not contain, which is the kind of proof that passes when
the word moves. So this issue built a desk that runs.

`src/presentation/shell/window/desk-dom.test-support.ts` is as much of a document as
`AlunaWindow` and the three window modules touch — enough that `openWindow`, `openPanel` and
`openAnswerWindow` mount for real. `standing-desk.test-support.ts` stands one up and watches every
way off it: the browser's store, the address bar, cookies, and the five transports a page can
reach a server with. Each silence in `answer-window-remembers-nothing.test.ts` has a control
beside it — the capability window's drag writes a record, its clay lamp pushes an address — so a
watcher that was never wired fails loudly rather than passing quietly.

The load-bearing test compares the desk before the question with the desk after the answer is
dismissed, node by node and attribute by attribute. That is what "no route back, by any surface"
means, and it catches a reopen control put anywhere, not only a logo in the logo layer.

`src/server/routes/prompt/app.question-writes-nothing.test.ts` asks a real question through
`POST /prompt` and reads the database back. One row is written, the resolver's own measurement,
the same row a refusal writes. It is read three ways: through its strict schema, so an added field
is caught however it was encoded; field by field, so every string in it is one the model did not
choose; and by hunting the sentence across every cell in every table, in each form a leak takes.

One criterion reads narrower than the code, and the code is right. `dismissWindow` in
`public/desk-window.js` is the *capability* window's ending: it puts that window away and forgets
its record. Calling it for an answer would close the wrong window. The answer window keeps its own
`dismissAnswerWindow`, and what the criterion is about — that this is a dismissal and never a
put-away — is now proved by behaviour: pressing the answer's clay lamp leaves the other two
windows standing and both records untouched, and the lamp a person reads and hears says "Dismiss".

## Records amended

None. ADR-0008, the PLAN and `CONTEXT.md` already said all of this, and the code already did it.

## Findings fixed

Two adversarial passes ran before the live test, one against the product and one against the
proofs. Everything they raised is fixed.

The product had three real defects, all found by reading rather than by any failing test.

- `GET /build/:id/stream` carried the user's own sentence under the framework's `no-cache`, which
  permits a browser to store the body and revalidate. Every neighbouring route in that file states
  `no-store`. It now does too, and a test reads the header back.
- `target_capability` is free text the model chose, and it was persisted verbatim. The extend path
  already refuses a target naming nothing in the catalog; `data_query` and `reject` never looked.
  The carried measurement now keeps a target only when the catalog holds it.
- A comment claimed focus returns to the bar "with the person's words still in it". The run's
  ending wakes the bar and clears it, so by then there are no words. The comment says so.

The proofs were weaker than they read, and the reviewer got six mutations past them: a `fetch` of
the question, a reopen control appended to the desk, the question parked in an attribute, a
cookie, a write through `window.localStorage`, and the lamp delegation removed entirely — that
last one because presses were dispatched at the handler rather than at the button. Every one of
them now reddens the suite; each was applied and reverted to check.

On the server side, the sweep read a `BLOB` as a map of numbered bytes and called it silence, it
compared row counts while ignoring the digests it already computed, and the sentence it hunted for
was escape-neutral. The measurement write is fired and not awaited, so three of the five tests
raced it and one of them passed against a database nothing had reached. Every read now waits.

## Verification

`bun run test`: 3004 passed, 1 failed — `counts the successful repair provider call exactly once`,
a 15s budget against a test that takes 21s to 24s here. It fails the same way on a clean tree with
this work stashed, so it is the machine, not the change. `bun run typecheck` and `bun run lint`
clean.

Live on `:3030` against nine real capabilities. With Coffee tasting open, the developer panel
standing and both records written, a question opened a third window titled with the sentence and
`localStorage` stayed byte-identical through a drag and a maximise. The clay lamp read
"Dismiss — how many coffees did I taste this year?" where the capability window's reads "Put
away". Putting Coffee tasting away and opening it again left the answer the same DOM node, the
same box and the same title. After dismissal the question was gone from the document, the two
stores, cookies, the address and the page title. A reload with an answer standing brought back the
two windows that have records and no answer window. The row the live server wrote carried
`data_query`, a catalog id, the model, a duration and token counts, and no part of the question.
