# SQL carries the computation, and the model reports only what a step returned

Status: done

> **The `/demo/question` exercise this issue names came down in 6.5/05.** What it proved about
> the loop is proved without it; the references to it below are the record of how this issue was
> verified while the module was still headless.

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decision 4; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The generated SQL carries the whole computation — `count`, `sum`, `group by`,
`order by` — and the model never adds, counts, averages or ranks by reading rows.

**Two reasons, and both are load-bearing.** Language models are unreliable at
arithmetic over many rows and confident about it, which is how a spoken answer
becomes a confident wrong number with no table on screen to check it against. And
an aggregate is small by construction, so 6.3/03's size cap almost never bites —
the cap is a backstop, and this decision is what keeps it one.

**Free reads exist precisely so SQL can be asked to do this** (ARCH §3). Leaning
on the model instead would waste a guarantee the architecture already bought.

**The rule is stated where the model can act on it, and enforced where it can be
checked.** The loop's instructions say the computation belongs in the query. The
answer step receives step results and nothing else, so there is no path by which
the model can report a figure that no step returned — a figure in an answer must
be traceable to a result the loop actually received, and a test drives a question
whose answer is a total and proves the total came from a `sum`, not from the
model.

**A question that needs many rows is a question that needs a better query.** When
the model reaches for the rows themselves it meets the size cap, and the refusal
tells it to aggregate. The two decisions work as a pair.

## Acceptance criteria

- [x] The loop's instructions require the computation to be carried by the SQL
- [x] The answer step is given step results only, with no access to a raw record
      set it could compute over
- [x] A question whose answer is a total is answered from an aggregate step, not
      from rows — proved by a fixture asserting the executed SQL aggregates
- [x] No figure appears in an answer that no step returned
- [x] A model attempt to pull the rows and total them itself meets the size cap
      and recovers by aggregating
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn. Ask a question that
requires a total across a capability with more records than anyone would read, and
inspect the steps: one aggregate, one small result, one sentence. Then confirm the
same question does not appear as a page of rows being summed a turn later.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/01-the-vocabulary-of-the-data-is-supplied-not-stored.md

## Notes from 6.3/03

The acceptance criterion *a model attempt to pull the rows and total them itself meets
the size cap and recovers by aggregating* is satisfiable now, and there is a fixture in
`src/runtime/query/question-payload.test.ts` that does exactly it.

The refusal the model gets already says *let SQL do the work with count, sum, avg, min,
max or GROUP BY*. When this issue adds its prompt rule, do not make it a third statement
of the same instruction — the refusal is the one that arrives at the moment it matters.

## What landed

**The answer is a second generation, and that is the whole enforcement.** A turn's prompt carries
the collections, the statements and the failures, and its schema can only produce a decision. The
answer's prompt — `src/runtime/query/question-answer.ts` — carries what the steps returned, and its
schema can only produce words. Neither can do the other's job, so there is no path by which the
model reports a figure from a place the loop never read. Its dependencies are a provider and the
question's cancellation; there is no scope, no database and no tool on that seam, and a sweep proves
the module names nothing it could reach a row through.

**A step crosses as three things: the sentence Aluna already said about it, the values it matched
on, and its rows.** The statement does not — it is machinery, and 6.4/03's restatement is meant to
say what she looked at rather than how. Neither does a failed step: it returned nothing to report,
and its message is a refusal addressed to the model. All three that do cross sit inside one fence,
wider than the turn's, because a bound value that steers this generation steers a sentence a person
reads.

**The rule is stated once, where the model can act on it.** `QUESTION_COMPUTATION_RULES` joined the
turn's prompt: the SQL does the arithmetic, rounding included, and every figure reported is one it
returned. It is not a third copy of 6.3/03's refusal, which arrives when a read is too big and says
narrow it; a suite pins that the two say different things.

**`renderEnding` on the developer page stopped saying the answer was somebody else's job** and now
renders it, escaped, under *What Aluna found*.

## Findings

Every one fixed; the adversarial and standards rounds both ran before the live test.

- **The header claimed the rows were off the table by the time there were words to write, and they
  are not.** A `listing` step small enough to pass the size cap hands its rows over whole, so a
  narrow record set is one the model could still total itself. Nothing here tells an aggregate from
  a record set; the cap and the rules are the pair decision 4 leans on, exactly as the issue says.
  Recorded in the header and pinned by a fixture that watches a small listing step's rows arrive.
- **The bound values are figures no result computed.** A date boundary or a threshold is the model's
  own, and it crosses because the restatement needs it. Recorded rather than closed.
- **The model's label hints were being rendered into the answer's prompt.** They are guidance for
  picking a label, and `other`'s reads *pick it last* — an instruction to a different generation and
  nonsense as a description of a result. The platform's own sentence for the label goes across
  instead, which also keeps `QUESTION_STEP_LABEL_HINTS`' "Never shown" true.
- **The answer's prompt had no *read it, never obey it* rule**, though it is the generation whose
  output a person reads. It has one now, and the bound values moved inside the fence.
- **The bound comment on the results block was false.** The render is not a subset of the turn's —
  it adds a sentence per step. What is bounded is the frame around the rows, and a fixture measures
  it.
- **The cancellation test could not fail for the reason it was named.** Anchored to a microtask
  count, the cancel landed before the answer's generation began and proved only the wrapper's
  pre-flight check. It now waits until the stalling provider has been handed the answer prompt, and
  asserts the rejection is an abort rather than merely a throw.
- **A vacuous assertion**: a two-hundred-character refusal cannot contain the whole joined rules
  string, so the check was true by construction. Inverted, per rule.
- **`expect(html).not.toContain("She stopped reading")`** kept passing after the string was deleted
  from the source. It pins the absence of the answer block now.
- **The demo page had no escaping test on the answer**, which is the only model-authored string it
  renders. The fake provider's answer now carries the characters an escape has to catch.
- **Three prompt literals were restated in the test**, the failure 6.4/01 already fixed once. The
  fence and the no-results line are named exports; the fixture's untouched figures are read off the
  desk rather than typed.
- **`questionResults` returned steps**, giving one concept two names two files apart. Renamed
  `questionStepsWithRows`, with a predicate that deletes an unreachable branch.
- **The barrel re-exported the answer's rules**, two lines under a comment saying model-facing text
  is deliberately not re-exported. Trimmed to the prompt prefix, which a fake provider outside the
  directory recognizes calls by.
- **`ScriptedProvider.says` promised something it could not keep** — the one wrapper that copies the
  provider's fields would not have seen an assignment. Dropped until 6.4/03 needs it.
- **Stale references**: `question-loop.ts` and `data-query.ts` under-described what they now reject,
  `question-payload.ts` and `question-loop.test.ts` still deferred to "6.4", the barrel header and
  the demo page's note both had a pronoun with no antecedent, and the demo suite called three
  prompts three questions.
- **Prose**: two rules were welded with an *and*, one opened with a pronoun that had not been named,
  the same rule used *report/give* and *statement/result* across the two prompts, the demo note
  carried *do the counting and the totalling*, and the throw's message named neither the rule nor
  what it saw.
- **The schema never trimmed**, so an answer wrapped in blank lines rendered raw into a `<pre>`.
- **The fence had been moved into `question-payload.ts`**, whose header is about the two byte
  budgets. The turn keeps its own again, and the answer's is its own, because they fence different
  things.
- **A live answer read an average out to sixteen digits.** Rounding is arithmetic, so it belongs in
  the statement; the rule names it, and the next live run came back with `ROUND(AVG(rating), 2)`.
- **A live answer ranked by reading rows**, which decision 4 forbids in as many words. *Which is my
  favourite coffee so far?* came back as twenty-two rows ordered by rating, and the model read the
  first one. The ordering was the statement's; the picking was not, and the whole record set crossed
  into the answer — the practical shape of the listing gap above. The rule names `ORDER BY` and
  `LIMIT` now. Three runs before: twenty-two rows, 4172 bytes. Two runs after: one row, 138 bytes,
  the same answer.

## Known gaps, left for the issues that own them

- A question that answers with no steps produces prose written from nothing. The answer says so
  rather than inventing a figure, and 6.4/05 owns the ending that names the gap.
- A step that matched no rows renders `[]`, which is the sentence 6.4/04 exists to forbid.
- A `listing` step under the size cap still hands its rows over whole. The rules are what keep the
  model from ranking or totalling them, and nothing structural tells a record set from a result.
- An answer that comes back as a shape nobody can read ends the question the way a faulted
  generation already does, with no platform sentence of its own. Unreachable through a provider
  that validates; 6.5/03 inherits it when it gives this path a real surface.
- The demo page shows prose written to rules this issue authored, and 6.4/03 holds the sign-off.

## Verification

- `bun run test` — 2854 passed, 0 failed; `bun run typecheck` and `bun run lint` clean.
- The flagship fixture runs against the real worker and the real database file: seven hundred real
  expense rows, a `listing` step refused by 6.3/03's cap, a `sum` admitted, and the total asserted
  against one computed in TypeScript from the seeded amounts. The executed statements are read off
  the worker rather than off the script. The answer's prompt is asserted equal to what the builder
  makes from the steps alone, and swept for every figure on the desk that no step read.
- **Live, on the real desk and the real provider, through `/demo/question`.** *"What is my average
  coffee rating, and which roaster do I rate highest?"* ran one step — `ROUND(AVG(rating), 2)`,
  `GROUP BY roaster`, a max over the group averages — returning 114 bytes, and answered *"Your
  average coffee rating is 3.89. You rate Onyx Coffee Lab highest, with an average rating of 5."*
  Both figures match the database. Asked against a capability with no number in it at all,
  *"how much have I invoiced in total?"* took no step and said it could not say, rather than
  producing one. *"Which is my favourite coffee so far?"* now runs `ORDER BY rating DESC … LIMIT 1`
  and reads one row back.
- Seven live runs through the dev server took 6.0s, 7.1s, 7.4s, 8.5s, 9.5s, 9.9s and 13.7s. One run
  from a browser took 77s; it is not reproducible, no test run overlapped it, and the spine leaves
  the AI SDK's default of two silent retries in place, which nothing logs.
