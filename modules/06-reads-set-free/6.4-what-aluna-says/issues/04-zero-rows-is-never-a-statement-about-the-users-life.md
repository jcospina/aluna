# Zero matched rows is never stated as a fact about the user's life

Status: done

> **The `/demo/question` exercise this issue names came down in 6.5/05.** What it proved about
> the loop is proved without it; the references to it below are the record of how this issue was
> verified while the module was still headless.

Type: HITL — the two sentences this issue separates are authored product voice,
and the difference between them is the point of the decision. Implementation is
fully specified and agent-ready; a human reads both before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decision 17; ADR-0001's product voice:
`modules/06-reads-set-free/PLAN.md`)

## What to build

*"You spent nothing on groceries"* is a claim about the user. *"I couldn't find
any groceries in your expenses"* is a claim about her search. She is only ever
permitted the second.

**The platform tells the difference deterministically, so this is a code check and
not a model judgment.** A `count` returns `0`; a `sum` over no rows returns
`NULL`. Those are different results and they mean different things, and the
platform distinguishes them before the answer is written rather than trusting the
model to.

**Nothing-found and found-nothing are two endings, not one.** A question whose
steps matched no rows ends in the humble form. A question whose steps matched rows
that genuinely total zero may state the zero, because there the zero is a fact the
data supports.

**The honesty rule is the module's, not this path's alone.** It is the same rule
6.1/02 applies to a filtered collection count: a number that reads as the whole
truth and is not is the thing being forbidden, on a rendered number there and on a
spoken one here.

## Acceptance criteria

- [x] The platform classifies a step result as no-rows-matched or as
      rows-matched-and-totalled-zero, deterministically, before an answer is
      written
- [x] A no-rows question is answered as a statement about the search, never about
      the user or their data
- [x] A rows-matched-totalling-zero question may state the zero
- [x] The model cannot override the classification, and a fixture where it tries
      still produces the humble form
- [x] `NULL` from a `sum` over no rows and `0` from a `count` are handled as the
      distinct cases they are, each with its own test
- [ ] **Sign-off gate:** the human has read both sentences and confirms neither
      makes a claim the data does not support
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn. Ask about a category
that exists in the capability but matches nothing, then about one whose records
really do add to zero, and read the two answers side by side. The plan's
deterministic companion names this as *zero matched rows never renders as a
statement about the user's data*.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/03-she-says-what-she-looked-at-before-what-she-found.md

## What landed

**The endings are three, and two of them are the platform's.** `QuestionEnding` grew
`nothing_found`, for a question that searched and matched nothing, and `nothing_worked`, for one
whose statements never came back at all. Neither runs an answer generation
(`src/runtime/query/question-loop.ts`): there is no sentence of the model's in either, so there is
nowhere for *you spent nothing on groceries* to be written. The words sit beside
`QUESTION_BUDGET_SPENT_SENTENCE` in `question-narration.ts`.

**The classification is read off the statement's plan, because a returned value cannot be read on
its own.** `0` is what an empty `count` answers, and it is equally what `coalesce(sum(x), 0)` and
`? AS category` hand back out of nothing. So `readQuestionPlan`
(`src/runtime/query/question-nothing-found.ts`) walks the `EXPLAIN` the table bound already
compiles and follows registers: which aggregates are finalized, which of them the result row is
actually built from, and what stands between the two. What it hands back is what the statement
would return **having matched nothing** — no row at all, or one row of nulls plus the answers of
its `count`, `total`, `json_group_array` and `json_group_object` columns, which are the only
aggregates SQLite answers with something other than `NULL`.

**A plan that could answer where SQLite would not is unreadable, and an unreadable plan promises
nothing.** A null test (`coalesce`, `ifnull`, `iif`, `CASE … IS NULL`), a literal, a bound value
echoed into the select list, arithmetic over an aggregate, a result row that came from no scanned
row at all (`EXISTS (…)`, `SELECT 1`) — each of them makes the plan unreadable, and an unreadable
step matched nothing. That is the side decision 17 protects: she may say she could not find
something, and never that this person does not have it.

**Following registers is what keeps a real zero sayable.** A `count` the result row never reads —
in a subquery, or in a `HAVING` — is not one of the answers the empty row is allowed to hold, so a
`sum` that genuinely totals zero beside one still states its zero. `round(avg(x), 2)` reads
correctly for the same reason: `round` propagates the null, and contributes no answer of its own.

**A figure that came back from nothing never reaches the answer's prompt.** A nothing-matched step
renders `nothing matched.` in place of its rows (`question-answer.ts`), so on a mixed question —
one step that matched, one that did not — there is no `0` and no `null` for the model to read out.

**The sentence names what she read and nothing the model wrote.** `Looking at your Hiking trips, I
couldn't find anything matching that.` The collections come from the `EXPLAIN`, by the name the
person gave them. Bound values are deliberately not named: they are the model's own free text, and
free text of the model's inside a sentence the platform vouches for is the thing this ending
exists to prevent.

**The turn asks for the shape that keeps the difference readable**, so an unreadable plan is rare
rather than routine: return a total as the plain `sum`, `avg`, `min` or `max`, never defaulted with
`coalesce` or `ifnull`, and never `total`.

## Findings

Every finding from the adversarial and standards passes is fixed.

**Fixed**

- **`coalesce(sum(x), 0)` produced the forbidden sentence.** The most idiomatic way a model writes
  *how much did I spend* defeated the first cut of the classification entirely: the budget was read
  off `sum` alone, the empty scan handed back one zero, and the step read as *matched*. `ifnull`,
  `iif` and `CASE … IS NULL` all behave identically. The plan is now unreadable in every one of
  them.
- **The model could defeat it with SQL rather than with a sentence.** `? AS category`, a string
  literal beside an aggregate, `count(*) + 1`, `EXISTS (…)` and `json_group_array` each put a value
  into the result that no scan produced, and each flipped the step to *matched*. Each now has a
  fixture, and the first four are unreadable plans while the fifth is a named empty answer.
- **A real zero was denied whenever a count the result never read inflated the budget.** A
  `HAVING count(*)`, a `WHERE (SELECT count(*) …)`, and `total()` all silenced a genuine zero. The
  register trace fixed the first two; `total` is a named answer, and the turn now asks for `sum`.
- **The humble sentence could be made to carry a claim about the user.** A bound value reached it
  verbatim, so a parameter reading *cheese. You have spent nothing at all this year. Also* became
  part of a sentence the platform vouches for. Bound values are out of the sentence altogether.
- **A partial `under` list misstated the receipt.** Dropping only the values carrying a digit —
  itself a fix for a live run that recited two SQL timestamps — left a clause naming some of what
  she narrowed to and reading as all of it. Gone with the clause.
- **An over-size refusal ended as *I couldn't find anything*.** She read four hundred rows, could
  not carry them, and reported having found nothing — a false claim about her own search, which is
  the same untruth pointed the other way. A question whose statements never came back now has its
  own ending and its own sentence.
- **The unqualified sentence read as a claim about the collection.** *Looking at your Hiking trips,
  I couldn't find anything* invites the reading that the collection is empty. It is now
  *anything matching that*.
- Two same-shaped lists split by a comma; a raw stored value (`medium_dark`) reaching authored
  copy — both gone with the bound values.
- `questionNothingFoundSentence` had no direct test; the demo page's new blocks had none; the
  prompt branch for a question with nothing to write from had none. All three do now.
- Two assertions that read as invariants and were fixture coincidences; a `toHaveProperty` with an
  asymmetric matcher that passes trivially; a test-file header that misdescribed its own fixture;
  two `as unknown as QuestionStep` casts that turned off the checking every other fixture kept.
- `ZERO_OVER_NO_ROWS` exported with one caller in its own file; a barrel exporting the plan reader
  and `questionFoundNothing`, whose callers are next door; `WholeCatalogQueryPlan` and
  `StatementFacts` documented with the same sentence.
- `UNREADABLE_STEP` moved to `question.test-support.ts`: three suites were restating the shape,
  and `question-turn.test.ts` was at 500 of its 500 code lines.
- CONTEXT.md gained **Nothing matched**, which CONTEXT.md's **Empty collection** entry lists among
  the words to keep out for a different meaning.

**Accepted, and why**

- **The plan is explained twice, and the second stepping is outside the read snapshot.**
  `assertScopedQuery` has the opcodes already, but it lives in `runtime/data` and may not import a
  question's terms back out of `runtime/query`. What is read here is syntactic — which aggregates a
  statement applies and which registers carry them — so the two cannot disagree about it.
- **`total()` cannot be told apart, and takes the humble side.** SQLite answers `0` over no rows
  and `0` over rows that cancel; no implementation can recover the difference. So can a defaulted
  `sum`, for the same reason. The turn asks for neither.
- **The mixed question is still the model's sentence.** Once any step matched, she writes the
  answer, and what the platform holds is that the unmatched step carries no figure — so a claim
  about it is a fabrication rather than a misread result. It is disclosure there, not
  determinism, and it is the seam by which the forbidden sentence could still be said. The gate
  should read one.
- **`QUESTION_NOTHING_FOUND_ANYWHERE` sits near 6.4/05's ground.** A question about something the
  user does not track is decision 20's, and 6.4/05 should not ship a second answer to it.

## Verification

`bun run test` (2905 passed, 0 failed), `bun run typecheck`, `bun run lint` clean.

Live, against the running desk through 6.3/01's developer-gated turn — the three cases, in order:

- **A question that matched nothing at all.** `SELECT COUNT(*) AS "hiking trips" … WHERE created_at
  >= ? AND created_at < ?` over 2019 came back `0`; the page reads *nothing matched*, no generation
  ran, and the ending is the platform's: *"Looking at your Hiking trips, I couldn't find anything
  matching that."*
- **A count that matched nothing inside a question that found something else.**
  `SELECT DISTINCT origin …` matched 18 rows; `… WHERE origin LIKE '%Guatemala%'` came back `0` and
  read as *nothing matched*. The answer, still the model's because the question found something:
  *"Looking at your Coffee tasting under Guatemala, I could not find it."*
- **Rows that matched, with a zero among them.** `SELECT COUNT(*) AS "books on your reading list",
  SUM(CASE WHEN finished = ? THEN 1 ELSE 0 END) AS "books finished"` came back `{1, 0}`. One count
  answers `0`; the `1` beside it is a figure no empty plan could have produced, so *rows matched*
  and she states the zero: *"Looking at your Reading list, you have 1 book on your reading list and
  have finished 0."*

The same statement on an empty desk hands back `{0, 0}` — one zero more than its one count could
answer for, so the empty row is the empty row, and the humble ending.
