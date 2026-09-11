# A query does not lock the prompt bar, and asking again cancels the one running

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.5 — The answer window
(PLAN decision 27, and the two user-raised triggers of decision 10 whose
mechanism epic 6.2 built and whose raiser only exists once the answer window does;
ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

`promptBusy` disabling the field is correct for a build and wrong for a question.
Waiting for an answer is not the same as waiting for a commit: asking something
else must be possible immediately, and doing so cancels the running query.

**The field stays live while a question runs.** `promptBusy` in `public/app.js`
flips on a build stream and disables the input and the submit control; a query
must not take that path. A build still locks the bar exactly as it does today —
this issue narrows the rule, it does not remove it.

**Asking again cancels** (decision 10, first trigger). A new question terminates
the running one through 6.2/03's single cancel entry point, and the second
question answers. The first leaves nothing behind: its tokens release, its worker
is gone, and its narration is replaced rather than interleaved with the new one.

**Dismissing the answer cancels too** (decision 10, second trigger). The answer window
now exists, so the user-raised trigger 6.2/03 could not wire has a raiser. Both
route to the same entry point; there is still one cancel path.

**Cancelling is not an error.** An abandoned question says nothing on its way out
— it is replaced, not reported. The desk has no failure to explain because nothing
failed.

## Acceptance criteria

- [x] The prompt field and its control stay enabled for the whole of a running
      question
- [x] A build still locks the bar exactly as it does today
- [x] Submitting a second question cancels the first through 6.2/03's cancel entry
      point and answers the second
- [x] Dismissing the answer window cancels a running question through that same entry
      point
- [x] A cancelled question releases its read tokens and terminates its worker
- [x] A cancelled question renders no error, no apology and no trace in the answer window
- [x] Narration from an abandoned question never interleaves with the new one
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The plan's living-demo step 10 (this issue cited step 8, which is the several-questions-in-a-row
one; 6.2/03 carries the same mis-citation). Start a long question and immediately ask a
different one: the field never locks, the first is abandoned without comment, and
the second answers. Then start a question and dismiss the answer window, and confirm the
desk goes quiet rather than reporting something.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/03-a-question-is-narrated-and-answered-in-the-window.md

## What landed

The bar's lock is a build's, and the person's two triggers of decision 10 now have raisers that
reach 6.2/03's one `scope.cancel()`.

- **The bar comes back the moment a run says it is a question.** `promptBusy` still goes on at
  `htmx:sseOpen`, where nothing yet knows what the sentence was, and comes off when the answer
  window's own opening frame arrives — with the words that asked it taken, because the field would
  otherwise have to be emptied by hand. **The classification beat is still a lock**, about two to
  four seconds against the real model: decision 23 says the window opens only once the resolver
  returns `data_query`, so there is no earlier moment to unlock at. The demo's "immediately" means
  as soon as she starts speaking, not as soon as you press the key.
- **A close no longer wakes a bar it did not lock** (`public/app.js`). A question woke it when its
  window opened, and the next question is often half typed by the time the answer lands; waking
  again would take those words away and pull focus off whatever the person is doing.
- **A question is not a run using the window.** It gave the frame back as it opened its answer
  window, so `runIsUsingTheWindow()` looks past it — the line `leaving-a-run.js` already drew.
  Beyond the criteria and deliberate: refusing a desk press over a question would hold the desk
  for a run that is not in it, and would put decision 10's *third* trigger, a deletion cancelling
  a question, out of the person's reach entirely.
- **`data-question-run`** marks the run the desk finds a running question by, written by the glue
  and read by `leaving-a-run.js`'s `QUESTION_IN_THE_WINDOW_SELECTOR`.
- **`cancelQuestionIn` and `detachQuestionIn`** (`public/leaving-a-run.js`) split what a build's
  ending does at once. Both cancels — a desk action's and a question's — go through one
  `cancelRun`, so there is still one place outside a run's control row that stops one. Asking
  again cancels *and* takes the story down, in the capture phase, so the shell's own one-run guard
  finds the window empty and a frame already on the wire cannot reach the window the next question
  is about to speak in. Dismissing cancels and leaves the story standing, because the close the
  server sends is what puts the frame it stood in away.
- **The window stops showing a question nobody will finish.** Asking another question takes the
  window over (decision 25 keeps the frame open between questions); a sentence that turns out to
  be a build or a deflection takes it down when that run ends.
- **The signal reaches the scope** through `prompt-pipeline` → `question-pipeline` → `data-query`,
  where the person's triggers join the gate's at `scope.cancel()`. It is a **required** field the
  whole way, `undefined` and all: what it stops is a worker mid-statement, which no test reaching
  this through a route can stage, so the compiler is what notices a caller quietly dropping it.
- **Cancelling is not written down as a fault either.** The three logs a cancel can reach stay
  quiet, and a stream the person took with them is told nothing.
- `public/app.js` and `public/desk-window.js` were both at the 500-line ceiling, so two unrelated
  statements were compressed to buy room: htmx's two security defaults became one `Object.assign`,
  and `windowLayer`'s throw became one line. Neither changed behaviour.

## Findings fixed

Two review agents (adversarial and spec-conformance), plus three defects the live desk found that
neither agent nor the suite could. Every finding is fixed, LOW and pre-existing included.

- **Live: the second question had nowhere to land.** The first shape cancelled at submit and took
  the story down only when the replacement opened its stream. In the gap the cancelled question's
  own close emptied the region, the desk put the window away as holding nothing — and took the
  swap target with it, so the second question's subscriber never arrived and the person got
  silence. Cancel and detach happen together now, so no close of hers reaches the desk at all.
- **Live: a dismissed question left an invisible frame that swallowed the next capability.**
  Taking the story down at the press skipped the close that puts an empty frame away, leaving the
  `is-pending` frame standing, invisible, and the next logo pressed opened into it unseen.
  Dismissing leaves the story to its own ending now, which is that close.
- **Live, pre-existing: a request that never comes back leaves the same invisible frame.** No swap
  settles and no stream closes, so nothing answered for it — for a build as much as a question.
  `desk-window.js` puts an unfilled frame away on `htmx:sendError` and `htmx:responseError`.
- **Two questions could be admitted inside one round trip.** The one-run guard reads the window,
  and between the submit and the subscriber landing the window is empty — a gap the bar used to be
  disabled across and no longer is. `hx-sync="this:drop"` on the prompt form closes it.
- **A live question could be dropped without being cancelled.** `runIsUsingTheWindow()` looking
  past a question made `dropHeldRun` reachable for one, and it takes the node out without htmx's
  cleanup: the stream would have stayed open and the reading gone on.
- **An abandoned question left its narration standing for ever** when the sentence that replaced
  it was not a question — a trace of a stopped question, which the issue forbids.
- **A transport reconnect re-locked the bar** for the rest of the question, and then cleared the
  field at the close. `htmx:sseOpen` no longer locks over a question that has said what it is.
- **Focus was taken at an unpredictable moment.** The desk stays usable while she reads, so the
  question's wake only takes the keyboard back from nobody. The dead-transport wake is guarded the
  same way, and the comment claiming a build no longer disables both controls was false and is gone.
- **Cancelling was still reported as a fault on two other log sites**, and a terminal frame was
  still written to a stream the person had taken away.
- **Two existing tests had gone vacuous**: a scene with a run standing in it and no stream open is
  not a state the browser can be in, so `openStream` was added to the double and to four scenes.
- **The DOM doubles answered selectors they did not understand.** The shell double read only the
  first attribute of `[a][b]` and ignored `:not(...)` entirely; it honours both now and refuses
  any other negation rather than quietly deciding a rule. The desk double gained `contains`, which
  the release walk reads off every node.
- Weak assertions strengthened (an exact rejection name rather than "not answered"), wall-clock
  budgets raised off the known flake class, every restated source constant replaced by an import
  (`RUN_ID_ATTRIBUTE`, `QUESTION_RUN_ATTRIBUTE`, `PROMPT_FORM_ID`, `COULD_NOT_FINISH_LOG`), and a
  fixture that logged its own failure into a test that reads the log was quieted.
- **One finding did not reproduce.** A review held that a question abandoned while a deletion
  drains holds the gate for the whole drain, because the abort listener is registered after
  `withTokens` grants. `withTokens` never waits: it takes the complete set or throws at once.

## Verification

`bun run test` (3046 passed), `bun run typecheck`, `bun run lint` all clean. Every new assertion
was mutation-checked: the bar's wake, the close's guard, the question mark, the desk-action line,
both halves of the cancel/detach split, the stale-window rule and its exception, the empty-frame
rule, the quiet log, and the scope wiring each fail when the behaviour they describe is removed.
The two pipeline hops are held by the type system instead, which is why `signal` is required.

## The live round-trip

Run against the real model on the real desk — nine capabilities — through the prompt bar.

| Done | Seen |
| --- | --- |
| Asked a long cross-capability question | Bar locked 2.3s while it was classified, then came back empty and focused while she narrated |
| Asked a different question at once | First abandoned in silence, its story gone from the desk, the window re-titled to the second and answering *"You have 22 houseplants."* — one window throughout, nothing on the prompt bar |
| Dismissed a running question | Window gone, desk quiet, nothing reported — and the next capability pressed opened **visible**, which is the defect that found the empty-frame rule |
| Abandoned a question with a sentence that was not one | *"I'm not quite sure what to make from that yet…"* on the bar, and the answer window went with that run's ending rather than standing on |

## Still open

- **The classification beat.** The bar is locked from the key press until she says the sentence was
  a question. There is no earlier moment to unlock at without guessing what the sentence is.
- **A transport failure between the cancel and the new subscriber** still leaves the desk without
  the run the person asked for; the empty frame is put away, but nothing retries the prompt.
