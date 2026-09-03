# A query does not lock the prompt bar, and asking again cancels the one running

Status: ready-for-agent

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

- [ ] The prompt field and its control stay enabled for the whole of a running
      question
- [ ] A build still locks the bar exactly as it does today
- [ ] Submitting a second question cancels the first through 6.2/03's cancel entry
      point and answers the second
- [ ] Dismissing the answer window cancels a running question through that same entry
      point
- [ ] A cancelled question releases its read tokens and terminates its worker
- [ ] A cancelled question renders no error, no apology and no trace in the answer window
- [ ] Narration from an abandoned question never interleaves with the new one
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The plan's living-demo step 8. Start a long question and immediately ask a
different one: the field never locks, the first is abandoned without comment, and
the second answers. Then start a question and dismiss the answer window, and confirm the
desk goes quiet rather than reporting something.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/03-a-question-is-narrated-and-answered-in-the-window.md
