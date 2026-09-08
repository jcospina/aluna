# Every step carries a label from a closed vocabulary, and the platform owns the sentence

Status: done

Type: HITL — the narration is authored product voice, one sentence per label, and
these are the words Aluna says while she works. Implementation is fully specified
and agent-ready; a human reads every sentence before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.3 — The loop
(PLAN decision 14; decision 15's never-machinery rule belongs to epic 6.5 and is
honoured here at the source, where the sentences are written; ADR-0001's product
voice: `modules/06-reads-set-free/PLAN.md`)

## What to build

The tool call gains a second field beside its SQL: a **label drawn from a closed
vocabulary**, and the platform owns the sentence for each label.

**The closed set is decision 14's**: looking at what things are called, counting,
totalling, listing, checking dates, and a generic fallback. This is the house
pattern — closed token defaults with a disciplined escape hatch — already used for
the field vocabulary and the logo prompt, and the fallback is the escape hatch. A
label outside the set is rejected the way any out-of-vocabulary token is; the
model does not get to extend it by writing something new.

**The model picks the kind of step. It never writes the words.** It cannot invent
progress, cannot report a number it has not computed, and cannot narrate in words
that are not Aluna's.

**The narration is product voice, never machinery** (decision 15). She says
*"seeing what you call things"*. No SQL, no table name, no column, no error
string, no step count, no percentage, no *step 3 of 10* — the moment SQL appears
on screen Aluna is an engineering tool, and §9.7 says she is never one. Prove it
with a sweep, not with care: a test that drives the loop through every label,
through a failed statement and through an over-size refusal, and asserts nothing
resembling machinery is emitted on any of those paths.

**The narration is produced here and rendered in 6.5.** This issue emits the
sentences and pins them; 6.5/03 streams them into the answer window over the existing
per-job stream (ADR-0002).

**One step has no tool call — from 6.3/02.** `QuestionStep.call` is
`QuestionToolCall | null`: a decision the schema could not read becomes an ordinary step with
no call, so it carries no label either. The acceptance criterion below stays literally true
(there is no tool call to label), but the narration switch needs a branch for it, and decision
14's generic fallback is the obvious home. The spent-budget ending's sentence already exists as
`QUESTION_BUDGET_SPENT_SENTENCE` in `src/runtime/query/question-loop.ts` and is part of what
the sign-off gate below reads.

## Acceptance criteria

- [x] Every tool call carries a label, and the loop rejects a call whose label is
      outside the closed set
- [x] Each label has exactly one platform-authored sentence, and the model
      supplies none of the text
- [x] The closed set covers decision 14's kinds of step and a generic fallback
- [x] A sweep across every label, a failed statement, an over-size refusal and a
      spent budget emits no SQL, table name, column, error string or step count
- [x] No sentence reports a number that no step computed
- [x] Every sentence is in Aluna's voice per ADR-0001, and reads as speech rather
      than status
- [x] **Sign-off gate:** the human has read every sentence in the vocabulary,
      including the fallback and the spent-budget ending
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; the sentences reach a surface in 6.5/03. Exercise them through 6.3/01's
developer-gated turn, which should now show the narration a real question would
produce, so the words can be read before there is an answer window to read them in.

## Blocked by

- modules/06-reads-set-free/6.3-the-loop/issues/03-the-size-cap-refuses-and-the-loop-narrows.md

## Notes from 6.3/03

There are **two** over-size refusals, not one: `QUESTION_STEP_RESULT_TOO_LARGE` (this
read alone was too big) and `QUESTION_PAYLOAD_BUDGET_SPENT` (the whole question has no
room left). Both are exported from `src/runtime/query/question-payload.ts`, and the
sweep in the acceptance criteria above must drive both.

Both strings are addressed to the model and **deliberately contain SQL keywords** —
`GROUP BY`, `WHERE`, `count`, `sum`, `avg`. They arrive as `QuestionStep.result.message`,
which is an *error string* by this issue's own wording, so no sweep over rendered output
may ever be fed a step message. Sweep the sentences the platform authors, never the
words the model was told.

## What landed

**The vocabulary is on the wire, and the words are not.** `QUESTION_STEP_LABELS`
(`src/runtime/query/question-tool.ts`) is decision 14's six kinds — `naming`,
`counting`, `totalling`, `listing`, `dates`, `other` — as a `const` array behind a
`z.enum`, the shape `SCALAR_FIELD_TYPES` and `LOGO_HUE_FAMILIES` already take. It is a
required key of the strict call object, so `QuestionToolCall` cannot exist without one,
and the offered tool's description is rendered off `QUESTION_STEP_LABEL_HINTS` so the
prompt cannot describe a vocabulary the schema does not gate. There is no second field
for words of its own: a decision carrying a `narration` key is refused by the strict
object.

**`question-narration.ts` is the single home for everything Aluna says.** One authored
sentence per label through an exhaustive switch, plus `questionStepNarration` (which
reads `call.label` and nothing else — not the SQL, not the bound values, so a person's
own saved data can never become her words) and the fallback for a step with no call.
`QUESTION_BUDGET_SPENT_SENTENCE` and `questionEndingNarration` moved here from
`question-loop.ts`, so "what does she say" has one answer and one file — and nothing
copies the words out of it, the suite included.

**A label outside the set fails closed, at the schema.** It never reaches the worker:
`questionDecisionSchema.safeParse` rejects it, the turn returns the unreadable-decision
step, and `desk.executed()` is zero. `UNREADABLE_DECISION` now names the vocabulary,
because a refusal the model must act on has to say what the shape is.

**The label is said to a person and never back to the model.** `formatStep` keeps it
out of every later prompt — pinned by counting occurrences, since the vocabulary itself
legitimately appears once, in the offer.

**The demo page shows the machinery and the words side by side**, and prints the whole
vocabulary above the form on every response, so the sign-off gate has a surface that
does not require running a question to reach it.

## Findings

**Every adversarial finding was fixed.** Two reviewers, and the ones that changed the
work rather than the prose:

- **`listing` claimed the user's data existed.** *"I'm gathering the ones you asked
  about"* asserts the rows are there before any have come back, which is the one line
  decision 17's honesty rule draws. It now says she is looking for them, not gathering
  them.
- **The spent-budget sentence claimed looking she may not have done.** *"I looked at
  this a few different ways"* is false on a question whose every decision was
  unreadable: that spends ten reads and executes no statement. Rewritten to claim only
  what is true on every path to that ending.
- **`counting` and `totalling` had dangling referents** — *how many what?* — against
  the module's own claim that each sentence stands on its own, since a person may hear
  any one of them first.
- **The sweep's identity check was called a tautology, and it stays one on purpose.**
  A reviewer was right that `AUTHORED`, derived from the function under test, cannot
  fail. It was briefly replaced with a literal list; the human who owns these words
  removed it, and correctly: a second copy has to be edited in step with the first, so a
  rewording — a rename, a comma — reddens the suite reporting a defect nobody has.
  `question-narration.ts` is now the only place any of these words exist. What the
  derived set still buys the sweep is the set to sweep, and the completeness check that
  every label was spoken on a real path; the machinery patterns run over whatever the
  module currently says, so a reworded sentence is swept on its new words. Drift-
  detection on wording is what was given up, and wording is a human's to change without
  asking a test.
- **Two machinery patterns could never fire.** The aggregate guard required a literal
  `(`, so it was inert against the realistic leak (*"I'm summing your expenses"*); the
  bare-word form catches it, and the English participles Aluna does say are different
  words. CONTEXT.md's own forbidden-internals list was missing entirely and is in.
- **The error-string check was array membership, not containment** — a sentence quoting
  a *fragment* of a refusal would have passed.
- **The switch failed open.** A label arriving through a cast fell off the end and
  would have put the word `undefined` in front of a person. It now throws on an
  unreachable label, and the `never` assignment still makes a seventh kind a type error.
- **One claim was simply false and is now pinned rather than reworded away.** *"A step
  that failed says the same thing as one that worked"* has exactly one exception: the
  statement too large to carry keeps no call (6.3/03), so its label goes with it and it
  falls back. The suite asserts the labels that survive that run.
- **The demo's step assertion was nearly vacuous** — every sentence appears on every
  response in the vocabulary block, so a bare `toContain` proved nothing. It now asserts
  the rendered heading/sentence pairing.
- Plus: a pre-existing 6.3/02 fixture silently weakened by the new required key (it
  failed on the missing `label` before the refinement it exists to test was consulted);
  four barrel re-exports with no consumers, including `QUESTION_STEP_LABEL_HINTS`, which
  is model-facing text and was reachable from `src/server/`; an unescaped `RegExp`
  interpolation; a JSDoc block orphaned onto the wrong constant; a header that said the
  vocabulary renders above the form while it rendered below; and a `?? ""` that would
  have rendered the spent-budget block as an empty box.

**Recorded rather than engineered away.** The model picks *which* kind of step it says
it is taking, and nothing cross-checks a label against the statement beside it — a
mislabelled read says a true sentence about the wrong thing. A cross-check was
considered and not built: the closed set already removes the failure that matters (the
model writing the words), and a validator that demoted a mismatch to `other` would trade
a rare wrong sentence for a common generic one. Two related costs are named in the
files: the label never returns to the model, so a mislabelling one is never corrected;
and `UNREADABLE_DECISION` grew some sixty bytes that every later turn of a question that
hit it now re-renders.

## The sign-off

The human read all seven sentences and signed off the six step ones as they stood.
They rejected the spent-budget ending and sent it back to be rewritten against
`docs/prose-guidance.md`, which found three faults in it: a clause announcing its own
honesty (*"I'd rather tell you that than guess"*), which also manufactured a contrast
nobody had raised; *"get to an answer"*, a verbal false limb where a verb belonged; and
the stress position spent on her self-regard rather than on what the person could do
next. Twenty-one words became twelve, in two sentences doing one job each. Approved on
the rewrite.

They also changed `naming` themselves during the review, and removed a literal copy of
the sentences the suite had been holding — see the findings above.

## Verification

- `bun run test` — 2792 pass, 0 fail; `bun run typecheck`, `bun run lint` clean
- The sweep drives three real loops against the real worker and the real database file:
  six labelled reads over real rows, then a statement SQLite refused plus
  `QUESTION_STATEMENT_TOO_LARGE` plus `QUESTION_STEP_RESULT_TOO_LARGE`, then a question
  that spends its payload budget and then its reads. Each path is asserted to have
  actually happened before anything is asserted about what was said on it, and every
  sentence in the vocabulary is proved to have been spoken on one of them.
- No `QuestionStep.result.message` is ever pattern-swept (6.3/03's constraint): messages
  are collected separately and used only to prove no sentence contains one.
- Exhaustiveness verified by mutation: a seventh label in `QUESTION_STEP_LABELS` fails
  `tsc` in two places — the switch's `never` assignment and the hints record's
  `satisfies`.
- **Live, against the real desk on `:3030` and the real provider.** *"how many hiking
  trips have I logged, and what do I call them?"* — the model labelled its
  `COUNT` + `GROUP_CONCAT` statement `listing`, and the page showed the SQL beside the
  sentence for it. *"what months did I log hiking trips in,
  and how many in each?"* — a `strftime` + `GROUP BY` statement labelled `dates`, shown
  beside that label's sentence. Two unscripted questions, two specific labels rather than
  the fallback, which is the evidence that matters against a model collapsing to the
  escape hatch. (The sentences themselves are quoted nowhere in this file: they live in
  `question-narration.ts` and are read there.)
