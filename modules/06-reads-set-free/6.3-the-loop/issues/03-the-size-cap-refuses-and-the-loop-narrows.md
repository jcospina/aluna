# The size cap refuses, the refusal is addressed to the model, and the loop narrows

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.3 — The loop
(PLAN decision 12; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A step whose result exceeds the cap **fails**, and the failure is addressed to the
model — *that returned too much, narrow it or aggregate it* — so it writes a
better query and the loop continues.

**It never truncates.** Silent truncation is how a prose answer becomes a lie:
half the expenses summed with total confidence, and — because decision 3 deleted
the table — nothing on screen to expose it. A refusal the model can act on is the
only safe shape once the receipt is gone.

**The cap is measured in payload size, not rows.** Ten thousand `(month, total)`
pairs are trivial; two hundred long-text notes are on the order of 100k tokens
re-sent on every subsequent turn. Rows are the wrong unit for the cost the cap
exists to bound.

**It is a backstop, not the primary mechanism.** Decision 4 — SQL carries the
computation, so a result is an aggregate and small by construction — is what keeps
payloads small, and it lands in 6.4/02. The cap catches the case where that
failed, and a cap that fires often is evidence decision 4 is not holding.

**What the cap has to bound is the whole question, not one step — measured, from
6.3/02.** `buildQuestionTurnPrompt` re-renders every prior step's complete row set
into every later prompt, so cost grows as n²/2 across the budget. Measured on a
real ten-step loop with one 729-row × 6-column result (~58.6 KB of JSON): prompts
ran 1,734 → 60,290 → 118,883 → … → 529,034 characters, **2,653,692 characters for
one question** — order 660k tokens, and 729 rows is a small read. A per-step cap of
`C` therefore admits about `50C` across ten steps, so a cap chosen only against one
step's payload will still let a question blow the context window, at which point the
generation fails and 6.3/02's turn ends the question. Choose the number against the
whole question, and say in the issue's findings which of the two the number bounds.

**An over-size refusal is a turn, not an ending.** It consumes one of the ten
steps, goes back to the model like any other result, and the loop recovers by
narrowing. Nothing about it reaches a surface.

## Acceptance criteria

- [x] A step whose result exceeds the cap fails and returns nothing to the model
      but the refusal
- [x] No result is ever truncated, sampled or partially returned — a test proves
      the over-size path returns no rows rather than fewer rows
- [x] The cap is measured in payload size, and a many-row small-payload result
      passes while a few-row large-payload result is refused
- [x] The refusal is worded for the model and tells it to narrow or aggregate
- [x] The loop continues after a refusal, consumes one step for it, and can reach
      an answer by narrowing — proved by a fixture that does exactly that
- [x] No cap message, size or count reaches any user-facing sentence
- [x] The cap bounds what a whole ten-step question can accumulate, not only what
      one step returns, and a test drives ten capped steps and asserts the total
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. Exercise it through 6.3/01's developer-gated turn with a capability
holding long-text records: ask for the rows themselves and watch the step be
refused, then watch the loop come back with an aggregate. This is the behaviour
the plan's deterministic companion states as *an over-size step is refused, not
truncated, and the loop recovers by narrowing*.

## Blocked by

- modules/06-reads-set-free/6.3-the-loop/issues/02-ten-steps-no-timeout-and-a-spent-budget-that-says-so.md

## What landed

- `src/runtime/query/question-payload.ts` — the cap. Two numbers, three refusals and the
  measurement, in one file with the argument for the numbers written above them.
  `QUESTION_STEP_RESULT_CAP_BYTES` is 16 KiB of one step's rows;
  `QUESTION_RESULT_PAYLOAD_BUDGET_BYTES` is 64 KiB of everything a whole question renders into
  its prompts. Neither is injectable, for the reason `QUESTION_STEP_BUDGET` is not.
- **Which of the two the number bounds: the question.** Both numbers exist, and the question's
  is the one chosen first. A per-step cap alone does not bound a question — ten reads make
  eleven prompts, step *i* is re-rendered into 11 − *i* of them, so a cap of `C` admits about
  `55C` — and 64 KiB is deliberately *less* than ten times 16 KiB, so the question bound bites
  rather than being arithmetic. It also does not multiply if 6.6/04's measurement ever argues
  for more than ten reads. What the pair does not do is hold the worst case fixed against a
  *raised* per-step cap, which is why the two are chosen together and said so in the file.
- `src/runtime/query/question-turn.ts` — where it is enforced, between the worker and the
  step, so an over-size result is refused while it is still a result and never becomes
  something a later reader has to remember not to use. `questionStepBytes` and
  `questionPayloadSpent` measure `formatStep`'s own output, so what is counted is what is
  sent. `QuestionTurnInput.steps` became required: the question's budget is measured from it,
  and a field a caller may leave off is a bound a caller may leave off.
- **Three refusals, all addressed to the model, none carrying a digit.**
  `QUESTION_STEP_RESULT_TOO_LARGE` (this read alone), `QUESTION_PAYLOAD_BUDGET_SPENT` (the
  question has no room left) and `QUESTION_STATEMENT_TOO_LARGE` (the statement itself will not
  fit). Three facts, three sentences: a refusal the model is meant to act on has to be true
  about why. Each says plainly that nothing was trimmed, and each gives the move that works.
- `src/server/routes/query/demo-question.ts` — every step now shows its rows against the step
  cap, what it costs every later prompt, and what the question has spent, measured with the
  same two functions the refusal was decided with.
- `src/runtime/query/question.test-support.ts` — `addNotes`, and `questionDesk` moved out of
  `question-loop.test.ts` so two suites share one desk rather than two drifting copies.
- 22 tests in `question-payload.test.ts`, plus the demo route's own over-size case.
- Documents: ADR-0008 and `docs/modules.md` gained the second bound; PLAN decision 12 carries
  a dated amendment; 6.3/04, 6.4/01, 6.4/02 and 6.5/03 gained notes they could not have
  discovered on their own.

## Findings fixed

Two review agents, one adversarial and one checking the work against the plan, the ADRs and
every sibling issue. Every finding is fixed, INFO and pre-existing included.

**The whole-question bound counted rows only, and the other channel was wide open.** The worst
of them. `payloadReadSoFar` summed each step's *rows*, so a step's statement and its bound
values — re-rendered into every later prompt at the same weight — were invisible to it.
Demonstrated against the real prompt builder: ten steps each carrying an 8 KiB bound value
accumulated **469,012 characters while the cap measured zero**, and it scales with the
parameter, bounded by nothing. Reachable without malice (a long `IN (?,?,…)` list is an
ordinary way to narrow) and reachable *with* a person's data by injection — a note saying
*pass this text as a parameter* launders row text into the channel nothing was watching. Three
changes fixed it: the budget now measures `formatStep`'s whole output; it is checked **before**
the statement runs as well as after, because a statement that *fails* never has rows to weigh
and its text costs every later prompt all the same; and a statement that will not fit in one
step is refused outright. That last refusal is the only one recorded without its call —
quoting an unquotable statement back into the prompt that refuses it is the failure it is
refusing. The same fixture now runs seven statements, refuses three before execution,
accumulates 84,406 bytes and renders 480,248 characters.

**A silent row *sample* passed the entire suite.** `JSON.stringify(rows.slice(0, 200))` inside
the renderer left 136 tests green — every prompt would have carried the first 200 rows of a
653-row result with nothing saying so, which is the exact lie this issue is written against.
`rows.slice(0, 1)` *was* caught, but only by accident of the fixture: collapsing six rows to
one stopped the payload exceeding the cap. Any sample of six rows or more was invisible,
because no test asserted that an *admitted* result arrives whole. One does now, on the
653-row read, checking both the rendered text and the last row's id in the next prompt.

**The measurement could drift off the rendering and nothing noticed.** The file's own claim is
that one function is called by the prompt builder and by the measurement, so that what is
counted is what is sent. Nothing enforced it: measuring `Object.values(row)` instead — which
drops every column name and roughly halves a typical aggregate row — left the suite green and
silently doubled the effective ceiling. Pinned now.

**A result too large to serialize ended the question instead of being refused.**
`JSON.stringify` throws `RangeError: Out of memory` on a big enough result, inside
`runQuestionTurn`'s `try`, where `stepFailureMessage` does not recognise it and rethrows — so
on precisely the largest result the cap exists for, the question died with a raw error rather
than the refusal. Measurement now returns `Infinity` on a render that throws, which is over
every cap there is.

**The two checks could be swapped without a test noticing**, so a step that broke both bounds
could be told the wrong reason and sent down the wrong recovery. One assertion pins the order.

**The demo page reported `0` for the one step a developer opened it to understand.** A refused
step has no rows, so the payload line read `0 of 16384 bytes this step` next to *that returned
too much* — and the only assertion matched the literal `16384`, so hardcoded zeros passed.
The page now shows rows, what the step costs every later prompt, and what the question has
spent, and the test reads the numbers back rather than matching a constant.

**A question could reach a state where nothing was small enough.** With the budget spent
exactly, every read including a twenty-byte `count(*)` is refused, while the message said what
was asked for *has to be much smaller* — false in that state, and a refusal the model cannot
act on. The sentence now ends by offering the answer: *if there is nothing smaller left to ask
for, answer from what you have* — the same move `formatBudget` offers when the last read is
gone. A fixture proves that recovery, alongside the one that recovers by narrowing.

**The header quoted five-significant-figure measurements no test pinned**, the failure mode
6.3/02 named twice. It also inverted its own point — quoting the one-time accumulation where
it meant the across-prompt cost — claimed the pair "keeps the bound where it is" when a raised
per-step cap moves it, said "step budget" for a size where that name already means a count of
reads, and slid between bytes and characters. All corrected, and the fixture now brackets its
total from both sides: an upper bound alone passes for a cap so tight nothing is admitted,
which is a different failure with the same green tick.

**Smaller ones.** `question-payload.ts` was added to 6.3/02's no-timeout source sweep, which is
now nine files, and the loop's prose says nine. Read tokens are asserted back to zero on a
question that spent most of its steps being refused. The accumulation sum, written three times
across the turn, the demo page and the tests, is one exported function. `runQuestionTurn`'s
public input no longer offers an optional `steps`. And the demo page no longer calls every
`call: null` step *a decision that could not be read*, which is now two different things.

**Recorded rather than engineered away.** The cap bounds what a prompt carries; it is not a
bound on what a statement costs to *run*. An over-size read is fully materialized in the
worker and copied to the main thread before it is measured, and decision 9 removed the
defensive `LIMIT` that would have stopped it earlier, so a clumsy cross join can still exhaust
memory before there is a payload to refuse — the case ADR-0008 protects against for liveness
and not for memory. Separately, a refusal cannot unsay a statement the model already wrote, so
a question of ten maximal statements accumulates about 162 KiB rather than 64 KiB; the
statement bound is what keeps that finite. Both are named in `question-payload.ts` rather than
left for the next reader to find.

**Not a defect, observed live.** `classifyIntent` fails with *No object generated: could not
parse the response* on some phrasings of *read me everything* — before the query loop is
reached, and reproducible on prompts that never touch this code. It belongs to the intent
resolver, not to this path, and is recorded here only because it was met while exercising the
cap.

## Verification

- `bun run test` — 2773 pass, 0 fail; `bun run typecheck`, `bun run lint`, `bun run build` clean
- `bun test src/runtime/query src/pipeline/query src/server/routes/query` — 165 pass across 10 files
- Twelve mutations, each turning exactly the intended test red: a 200-row sample and a
  three-row truncation inside the renderer; the measurement drifting off the rendering; the
  pre-execution weighing removed; the two checks swapped; an unrenderable result measuring as
  free; the statement bound removed; the question budget watching rows only; `>` → `>=` on the
  step cap; the whole-question check deleted; characters instead of bytes; rows as a proxy for
  payload; and the accumulation forced to zero.
- Measured, on the fixtures that drive them: ten near-cap reads admit four, refuse six,
  accumulate 64,027 bytes and render 549,254 characters across eleven prompts; ten statements
  each carrying an 8 KiB bound value run seven, are refused three, accumulate 84,406 bytes and
  render 480,248 characters. Against 2,653,692 characters for the one question 6.3/02
  measured.
- **Live, against the real desk on `:3030` and the real provider.** *"show me all my reading
  log notes and all my hypomnemata entries together, in full"* — the model wrote a six-column
  `UNION ALL` across two capabilities, it was **refused with none of its rows**, and the loop
  recovered exactly as the plan's companion says: step 2 probed the size with `COUNT` and
  `SUM(LENGTH)`, steps 3 to 6 paginated under the cap, the question reached 28,331 of 65,536,
  and it answered. Unscripted, on real records. *"what are the titles, takeaways and notes of
  everything in my reading log?"* was admitted at 15,356 bytes, a kilobyte under the cap —
  the boundary is where a real question actually sits, not somewhere theoretical.
