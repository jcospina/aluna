# The content-free metrics row gains step count and duration

Status: ready-for-agent — the work below is complete and waiting on sign-off

## Epic

Module 6 — Reads Set Free · Epic 6.6 — Context and refusal
(PLAN decision 33, which measures what decision 8 — epic 6.3's — guessed at;
ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

`data_query` already writes a best-effort row to `intent_resolution_metrics`
(`src/platform/metrics/intent-resolution-store.ts`, ARCH §6.3) carrying no
content. It gains two fields: **turns taken** and **wall-clock elapsed**.

**It stays content-free.** No prompt, no SQL, no results, no capability names, no
column names — nothing about the user's data. Two integers. The row is the same
kind of row it already is, and a test proves the added fields cannot carry text.

**It answers the one question decision 8 guessed at.** Ten steps was chosen as a
budget a real question never approaches, on a PoC whose capabilities and questions
are simple. This measurement is what will say whether ten was generous or tight,
and it is the only way anyone will ever know.

**Latency is explicitly part of this PoC's thesis, and Module 10 is the customer.**
The elapsed number is wall-clock across the whole question — the thing the user
waited through — not a sum of step times.

**Best-effort stays best-effort.** Completion never waits for this write, and
losing it in a crash implies nothing about the answer the user received.

**Where the clock may live — from 6.3/02.** Decision 9's no-timeout guarantee is pinned by
a sweep that refuses `Date.now`, `new Date`, `performance.now`, `nanoseconds` and `hrtime`
anywhere on the query path, `src/pipeline/query/data-query.ts` included, because a substring
sweep cannot tell a measurement from a deadline. So take the elapsed reading *above*
`runDataQuery` rather than inside it — `src/pipeline/metrics-recorder.ts` already uses
`performance.now()` and is not swept, and a reading taken there also captures more of what the
user actually waited through. If the sweep reddens, that is this constraint and not a
regression.

**Step count is on the result, in two places.** `QuestionLoopResult` is a union: an answered
question carries `steps` (count it), a spent budget carries `stepsTaken`. A question ended by
cancellation carries neither and has to be counted through `onStep`.

## Acceptance criteria

- [x] The `data_query` metrics row carries steps taken and wall-clock elapsed
- [x] Both are numeric, and no free text, SQL, prompt, result or capability name
      can reach the row — proved by a test over the stored shape
- [x] Elapsed is measured across the whole question, not summed per step
- [x] A cancelled and a budget-exhausted question each write a row saying what
      they cost
- [x] The write stays best-effort: an answer is delivered whether or not it lands
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Ask two questions on `:3030` — a quick one and one that takes several steps — then
read the rows back from `intent_resolution_metrics`. The step counts differ, the
durations differ, and neither row says anything about what was asked or found.
That last part is the one to check by eye.

## Blocked by

- modules/06-reads-set-free/6.6-context-and-refusal/issues/03-refusal-reuses-the-resolvers-reject-bucket.md

## What landed

Two integer columns on the row a question already left, and a write moved to the one
moment both numbers exist.

- **`steps_taken` and `elapsed_ms` are columns, not two more keys in the measurement
  JSON** (migration `0015_intent_resolution_question_cost`). `intent_resolution_metrics`
  is a `STRICT` table, so an `INTEGER` column physically cannot hold a sentence: the
  content-free claim is enforced by SQLite rather than by a schema a caller could route
  around. A `CHECK` refuses a negative. Both are nullable, and null is what every row no
  read loop ran for carries — a refusal spends no step, and a zero would read as one.
- **The row moved from the start of a question to its ending.** Neither number exists
  until the question stops reading, so `rememberTheResolver` now runs when the ending is
  known, with a `finally` behind it as the backstop for the paths that never got that
  far. It is written once: `QuestionSoFar.remembered` is what keeps the backstop from
  repeating the ending's own write.
- **It is written at the ending rather than after the presentation**, because
  `voice.settled()` awaits an unbounded chain of raw sends. A question whose stream hangs
  on the way out would otherwise be missing from the dataset — and the questions that hang
  are the slow ones this measurement exists to find.
- **The clock lives in `src/pipeline/metrics-recorder.ts`**, which decision 9's sweep does
  not cover, and reads from `askedAt` — the prompt job's `builtAt`, taken above the
  resolver. So the number spans the classification and the loop, which is what the person
  waited through, and it is a wall-clock reading rather than a sum of step times. Live,
  a one-step question measured 7151 ms against a resolver that took 3229 ms of it.
- **`questionCost` returns `undefined` for a reading the row could not hold.** The cost is
  an addition to a row that has always landed without it, so a broken clock costs the cost
  and never the resolver measurement beside it.
- **`questionStepsTaken` reads the count off whichever shape the loop handed back**, and
  the `onStep` tally is what a cancelled question is counted by, since it reaches neither.
  The two agree by construction — one push, one `onStep` — and `question-loop.test.ts` now
  pins that, because the fallback is only trustworthy while they do.
- **The word is *step*, not *read* or *turn*.** A turn that hands back an unparseable or
  over-size decision is a step that ran no statement (`question-turn.ts`), so "reads" was
  wrong; the answer generation is a turn that is not a step, so "turns" was wrong too. The
  column measures the unit `QUESTION_STEP_BUDGET` bounds, which is what decision 8 needs
  measuring. PLAN decision 33, ADR-0008 and `docs/architecture.md` were reworded to match.
- **`docs/architecture.md` §6.2 and §6.3 now name the two columns**, the way every other
  migration's columns are named there.

## Findings

Two review agents, adversarial and standards, both on the SOTA model. Every finding is
fixed.

**Found by writing the tests, before either agent**

- **The `finally` could throw over an answer already delivered.** `intentResolutionMetrics`
  validates, and building the row outside the queued write meant a refused row unwound
  through the `finally` and became the run's failure — after the person had their answer.
  The row is built inside the write now, so a refusal is caught and logged. The arm that
  proves it is the one path reaching the write without the window's preview having
  validated the same measurement first.

**Fixed — adversarial**

- **A completed question could be recorded as `cancelled`** (MAJOR, and a regression this
  issue introduced). `theResolverRow` read `isAborted()`, and after the row moved inside
  the platform-write callback that read happened whenever the queue got to it — which is
  after the desk closes the stream on `done`. A question answered behind a build's lease
  came out `cancelled`. The outcome is frozen synchronously at the ending now, the way
  `deflection-pipeline.ts` has always frozen its own.
- **The best-effort test was vacuous** (MAJOR). It injected a throwing `resolve`, which
  `writeResolverOnlyMetrics` already swallowed one layer down, and asserted rows were empty
  when `resolve` had been replaced — every assertion passed against the unchanged code. It
  now claims only what it proves, and the failure the move actually created has its own arm.
- **A question that never returned left no row at all** (MINOR). See the third bullet above.
- **One bad number discarded the whole row** (MINOR). `parse` is all-or-nothing, so a
  `NaN` elapsed took the resolver measurement with it. `questionCost` now drops itself.
- **`steps_taken` counts steps, and the docs were being reworded toward the wrong word**
  (MINOR). The first pass changed "turns taken" to "reads taken"; a step that ran no
  statement is neither. Settled on *step* across the code, PLAN, ADR-0008 and ARCH.
- **The preview and the stored row disagree** (MINOR). They do, and they should: the
  preview has no cost and samples the outcome at window-open. Said on `theResolverRow`.
- **A timing-dependent assertion** (MINOR). Neither arm of the quick-versus-long test was
  made slower than the other, so the elapsed comparison could invert under load. That arm
  claims the counts now; the clock has its own arm, with a real delay in it.
- **`steps.taken = questionStepsTaken(result)` is a provable no-op** (INFO). It is, and
  that is now a checked invariant rather than dead code — see the `questionStepsTaken`
  bullet above.
- **Wrong ARCH citation** (INFO). `§9.3` is "Evolution never destroys"; the claim is
  `§9.6`. Fixed here and in the pre-existing copy at `writeResolverOnlyMetrics`.
- **`askedAt` is not when the job started** (INFO) — it is when the desk opened the stream,
  so the POST-to-stream gap is outside it. The claim in the JSDoc was the defect, not the
  choice; it says what it is now.

**Fixed — standards**

- **A zero cost was written for a question that never started** (MAJOR). The `finally` runs
  on the two paths that never open a window, and `{stepsTaken: 0}` there is the same number
  an answered question that read nothing writes. `QuestionSoFar.asked` separates them, and
  those rows carry no cost at all.
- **No document landed with a change to what a stored row carries** (MAJOR). ARCH §6.2 and
  §6.3 name the columns now, as they do for migrations 0007 and 0012 through 0014.
- **The migration comment's null rule was contradicted by two live paths** (MAJOR). Same
  defect as the first; the comment is true now.
- **`parseStoredRow`'s comment credited the schema with the branch's work** (MINOR).
- **The `questionCost` JSDoc re-derived decision 9 instead of citing it** (MINOR).
- **`questionStepsTaken`'s JSDoc restated `QUESTION_STEP_BUDGET`'s** (MINOR).
- **A test retyped a type its own module exports** (MINOR). `QuestionCost` is imported.
- **Duplicated setup and fixture in one file** (MINOR). One scratch env and one `measured`
  fixture for `intent-resolution-store.test.ts`.
- **One assertion lived in two files** (MINOR). The step count belongs to the cost suite;
  `app.question-writes-nothing.test.ts` keeps the content-freeness claim it owns.
- **A comment described a scenario its test did not run** (MINOR).
- **`reads: { taken: number }` was an unnamed structural type in the one word the rest of
  the path avoids** (MINOR). It is `QuestionSoFar` now, and says *steps*.
- **The non-build clock parameter was called `builtAt`** (INFO) in the function whose whole
  job is intents that build nothing. It is `askedAt`.
- **A test name carried two `it`s with different referents** (INFO).

## Verification

- `bun run test`, `bun run typecheck`, `bun run lint` clean.
- Migration 0015 applied to a database already holding pre-0015 rows: the existing row
  survived with both columns null, and a re-run was a no-op.
- `STRICT` enforcement checked directly: `TEXT` is refused with "cannot store TEXT value",
  a float with "cannot store REAL value", and a negative by the `CHECK`.
- Five real questions on `:3030`. Steps were 1 every time; elapsed ran 6594–17676 ms. No
  row held the question, the answer, a collection name, a column name or any SQL — the
  only match for a trace was `22` inside a token count.

**Ten was generous, and that is the first thing these rows say.** Every real question on
the live desk resolved in a single step. The suite proves the counter reaches
`QUESTION_STEP_BUDGET` on a spent budget and zero on a question that never read, so it is
the questions that are cheap, not the counter that is stuck. The issue's living demo
expects the step counts to differ between a quick question and a long one; against
`gpt-5.6-terra` on this desk, they do not — the durations are what separate them.
