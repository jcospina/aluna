# A question is narrated and answered in the answer window — the first time the module can be seen

Status: ready-for-agent

Type: HITL — this is where the whole module becomes visible and audible, in
authored product voice on a surface a human has to look at. Implementation is
fully specified and agent-ready; a human asks real questions before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.5 — The answer window
(PLAN decisions 3, 15, and decisions 1 and 24, which the plan's epic list assigns
to no epic and which are settled here because this is where the prompt path meets
the query path; ADR-0002's per-job stream; ADR-0008:
`modules/06-reads-set-free/PLAN.md`)

## What to build

The prompt bar's question path is joined to the loop. A sentence the resolver
classifies as `data_query` opens the query scope, runs the loop, streams 6.3/04's
narration into the answer window as the steps go, and ends with 6.4's spoken answer in
the same answer window. **This is the first point the module can be seen, and where the
living demo begins.**

**One prompt bar, and the sentence decides** (decision 1). No mode switch, no
slash command, no ask-versus-build control. The resolver already classifies
`data_query` against the whole registry (`src/pipeline/intent/resolver.ts`), and
asking the user to pre-classify their own sentence would move the platform's one
hard job onto them.

**The narration streams over the per-job stream the prompt bar already opens**
(ADR-0002). No new transport, no second stream, no polling.

**The answer is prose and there is no table** (decision 3). No table, chart,
export, saved query or history of past answers appears anywhere on this path —
every one of those makes a disposable answer persistent, which is the one property
this module exists to preserve.

**Nothing machinery-shaped reaches the surface** (decision 15). The sweep 6.3/04
runs over the sentences runs again here over the rendered fragment: no SQL, table
name, column, error string or step count survives the trip to the desk.

**Build narration stays in the window, untouched** (decision 24). A build
narration is a log — long, streaming, chronological, ending in a thing appearing
in that window — and an answer window is one utterance. Two streams now render Aluna's
words, and this is the issue where one could leak into the other, so the
separation is asserted rather than assumed. The pet travelling into the window is
deferred, not rejected, and is not built here.

**Nothing is added to the desk.** No logo appears, no registry row, version,
artifact, cache or `read_dependencies` row is written by asking a question. Assert
it here, at the seam where a question meets the desk, as well as in 6.2/02's
store sweep.

**The `data_query` deflection line stops being reachable.** `deflectionNarration`
in `src/pipeline/build/admission/deflection.ts` currently answers a `data_query`
with *"I can't answer across your things yet, but I'll be able to soon."* — which
becomes false the moment this issue lands. It goes, and the `reject` line stays
where 6.6/03 will use it.

**A third ending exists and is unlit — from 6.3/02.** The loop has two endings that are
its own (answered, budget spent) and one that is nobody's yet: a question can *throw*. A
generation that faulted, a closing read gate, a worker that will not answer and a context
window overrun all leave `runDataQuery` as an exception rather than as a
`QuestionLoopResult` — and today that surfaces as a raw error string. ADR-0001 and ARCH §9.7
say errors speak in product voice too, so this issue owns an authored sentence for *the
question could not be finished*, alongside the answer and the spent-budget ending.

**`onStep` is the narration seam, and it is synchronous.** `runQuestionLoop` and
`runDataQuery` both take `onStep(step)`, called as each step completes. A throw from it ends
the question (pinned deliberately), so a stream write that can fail needs its own guard.

## Acceptance criteria

- [x] A question typed into the prompt bar is classified, run and answered in the
      answer window, with no mode switch or extra control anywhere
- [x] Narration streams into the answer window as the loop takes its steps, over the
      existing per-job stream
- [x] The answer replaces the narration in the same answer window and reads as prose,
      with bullets only where a sentence would be a list
- [x] No table, chart, export, saved query or answer history exists on this path
- [x] No SQL, table name, column, error string or step count reaches the rendered
      fragment, proved by a sweep over the streamed output
- [x] Asking a question adds no logo to the desk and writes no registry, version,
      artifact, cache or `read_dependencies` row
- [x] Build narration still renders in the window and never in the answer window, proved
      by a test that runs a build and a question and checks both surfaces
- [x] The stale `data_query` deflection line is removed and the `reject` line is
      untouched
- [x] A question asked twice runs twice and reuses nothing
- [ ] **Sign-off gate:** the human has asked a count, a total and a
      cross-capability question on a real desk and is satisfied with what Aluna
      says and how it arrives
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

This is the plan's living demo, steps 2 to 4. Run `bun run reset`, start Aluna on
`:3030`, build Notes and Expenses from the prompt bar and add a handful of records
to each, giving the expenses categories that do not literally read "groceries" —
food, cheese, vegetables. Put the window away and ask *"how many notes did I add
last week?"*: Aluna narrates in her own voice while she works, then answers in a
sentence, with no table anywhere and no logo added to the desk. Ask *"how much did
I spend on groceries?"* and watch her look at what things are called before she
totals anything. Then ask something that crosses both capabilities and get one
spoken answer.

6.3/01's developer-gated exercise of the loop is scaffolding, and it stays standing
until 6.5/05 — the issue that owns taking it down and re-homing its assertions. This
issue's own prose used to claim the deletion happened here; it does not.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/02-the-answer window-outlives-navigation-but-not-the-next-question.md

## Notes from 6.3/03

The size cap bounds the **row text** a question puts into its prompts: worst case now
about 557,000 characters across a question's eleven prompts, against the 2,653,692 that
6.3/02 measured for one uncapped question. The SQL the model writes, the collections
block and the question itself are **not** bounded by anything. So the context-window
overrun this issue names as part of its third ending got much less likely and did not
go away — the sentence for *the question could not be finished* is still this issue's
work, and the bound is not a reason to skip it.

## What landed

The prompt bar's question path is joined to the loop. `src/pipeline/query/question-pipeline.ts`
(`streamQuestion`) opens the answer window, runs `runDataQuery` with `onStep` wired to the
per-job stream, and ends with the spoken answer in the same window. `runNonBuildIntent`
(`src/pipeline/build/prompt-pipeline.ts`) routes `data_query` there instead of to
`streamDeflection`, which no longer knows what a question is.

- **The third ending is lit.** `QUESTION_COULD_NOT_FINISH` — *"I couldn't finish looking at
  that one. Mind asking me again?"* — lives in `question-narration.ts` with every other
  sentence. It claims only that she did not finish, because a read gate closing under a
  deletion is the platform working rather than a fault.
- **The client seam.** `renderAnswerWindowSaying` / `data-answer-saying` writes into the
  standing window without opening or raising it, so a question that runs for a while cannot
  keep pulling itself in front of a capability the user clicked on. `sayInAnswerWindow`
  replaces rather than appends: a build narration is the log, an answer window is one utterance.
- **A list reads as a list.** `white-space: pre-wrap` on the answer body, so the break
  she writes into a list survives to the desk. No markup is built
  out of her words — the body stays `textContent`.
- **The stale deflection line is gone.** `deflectionNarration`'s `data_query` arm throws
  `NotDeflectableError`; the `reject` line is exported as `REJECT_DEFLECTION` and untouched.
- `writeDeflectionMetrics` became `writeResolverOnlyMetrics` — a question leaves that row too,
  and it is not a deflection.

## Findings

Three adversarial reviews ran. Every finding is fixed.

- **The opening line could clobber the answer, permanently.** `openAnswerWindow` wrote
  *"Let me look at what you've saved."* on a deferred task while `sayInAnswerWindow` wrote
  synchronously. On a fast path the two frames arrive under a millisecond apart and the timer
  put the opening back over a real sentence — leaving the window claiming she never looked, on
  the first question of a page and no other. A write counter makes the deferred opening a no-op
  once anything has overtaken it. Regression-tested.
- **A cancelled question was not cancelled.** The raw provider was handed to `streamQuestion`
  while the build path next door used `abortableProvider`, and `context.signal` never reached
  it. A cancel left the loop running, still narrating into a window the person had stopped, and
  holding the whole-catalog read tokens. The job's own abortable provider is passed now, and the
  narration seam checks `isAborted()` as well as the socket.
- **A cancelled question said something had gone wrong.** `canPresent()` is true on an explicit
  cancel, so the fault sentence fired for a user who simply stopped. It says nothing new now.
- **An un-deliverable frame shipped its reason to the desk.** A rejected write on the opening
  fragment left `streamQuestion` through the pipeline's generic catch, which puts `error.message`
  on `build-error-preview`. Every frame a question sends is guarded now, swept across all four.
- **Criterion 7 was proven against a build that failed.** The two-windows test pre-registered
  `notes` and then built `notes`, so the build died on a registry CAS and its single failure line
  satisfied "narration is non-empty". It builds on an empty desk now and asserts the `commit`.
- Replacement-not-append, the absence of a mode control, and `renderAnswerWindowSaying`'s escape
  were all unpinned — a model answer carrying `</div><div data-answer-window="…">` would have
  re-titled and re-raised the window. All three are pinned and mutation-checked.
- The unit test's fixture was fake (`readGates.openRead` is not a method) and its sweep asserted
  the absence of words the thrown error never carried. It sweeps the words the real failure
  produces now, and asserts the saying *equals* the authored sentence.

## Verification

`bun run test` (3022 passed), `bun run typecheck`, `bun run lint` all clean. Every new
assertion was mutation-checked: the narration, the machinery sweep, the cancel guard, the
opening-overtake guard, the replacement pin, and the escape pin each fail when the behaviour
they describe is removed.

## The live round-trip

Run against the real model (`gpt-5.6-terra`) on the real desk — nine capabilities, ~190 records —
through the prompt bar, not a fixture. Every answer checked against the database:

| Asked | Said | Truth |
| --- | --- | --- |
| how many job applications have I sent? | *Looking at your Job applications, you have sent 22 job applications.* | 22 ✓ |
| how many of my coffees are from Africa? | *Looking at your Coffee tasting under Burundi, Kayanza; Ethiopia, Guji; Kenya, Nyeri; and Rwanda, Nyamasheke, you have 6 coffees from Africa.* | 6 ✓ |
| do any of my coffees and teas come from the same place? | *Looking at your Coffee tasting and Tea tasting journal for places shared by your coffees and teas, I could not find any.* | no overlap ✓ |
| what's my average coffee rating? | *Looking at your Coffee tasting, your average coffee rating is 3.8863636363636362.* | 3.886… ✓ |

The Africa question is the thesis: she read what the origins are *called* before counting, and
named all four so the decision can be checked. Narration streamed in order — *"I'm seeing how you
named things."*, *"I'm looking for the ones you asked about."* — then the answer replaced it. No
table anywhere, no logo added, one window throughout.

**One defect found and fixed here.** The zero-result answer came back as *", i could not find
any"* — lower case pronoun. The schema tells the model `found` opens in lower case because it
continues the clause after a comma, and the model applied that to the pronoun too. `findingText`
now restores the capital deterministically rather than asking the model to remember
(`question-answer.ts`), with the ordinary words that start with `i` left alone.

## The answer's prose, after a human read it

The first human reading rejected the answers outright: *"Looking at your Coffee tasting, under
Colombia, you have 7 coffees from Colombia."* and *"Looking at your Tea tasting journal under
Colombia, I could not find it."* — "awful to read and unnatural".

Three causes, all authored rather than emergent, and all in `QUESTION_ANSWER_RULES`:

- **One worked example dominated.** The rules carried two, and the model collapsed onto
  *"Looking at your fuel log from last winter, under diesel"*. Every answer opened that way. This
  is the repo's own `worked-examples-bias-the-model` finding repeating.
- **Nothing forbade naming the narrowing twice**, so *under Colombia … 7 coffees from Colombia*.
- **The rules handed the model its own vocabulary.** *"where you narrowed"* came back out as
  *"narrowed to Colombia"*, and *"Say you could not find it"* as *"I could not find it"*.

Fixed by varying the examples, telling it to open differently each time, showing the repetition as
a bad case rather than describing it, and taking the rules' own words out of its mouth. Measured
live, same questions:

| Before | After |
| --- | --- |
| Looking at your Coffee tasting, under Colombia, you have 7 coffees from Colombia. | Under Colombia in your coffee tasting, you have 7. |
| Looking at your Tea tasting journal under Colombia, I could not find it. | In your Tea tasting journal under Colombia, I could not find any. |

The restatement is untouched in substance — it still names what she read and how she narrowed,
still first, which is what ADR-0008 protects. Only the phrasing moved.

**The raw float went the same way.** *"your average coffee rating is 3.8863636363636362"* was a
rule reading as optional — *"The SQL does the arithmetic, rounding included"* — which the model
took as permission rather than instruction. Made concrete in `QUESTION_COMPUTATION_RULES`
(`round(avg(x), 2)`), so the rounding happens where decision 4 says arithmetic happens rather
than in the sentence. Live: *"In your Coffee tasting, your average coffee rating is 3.89."* Two
decimals is a default, not a considered policy — currency and percentages may each want their own.

**Measured after the change, five live questions.** The collapse did break — four distinct
openers where every answer used to start *"Looking at your"*:

| Asked | Said |
| --- | --- |
| what's my average coffee rating? | *In your Coffee tasting, your average coffee rating is 3.89.* |
| how many coffees from Colombia? | *Under Colombia in your coffee tasting, you have 7.* |
| how many teas from Colombia? | *In your Tea tasting journal under Colombia, I could not find any.* |
| which houseplants need watering most often? | *Among your houseplants, Boston fern (Nephrolepis exaltata) in the Bathroom needs watering every 3 days.* |
| how many coffees from Africa? | *Among your Coffee tasting coffees under Burundi, Kayanza, Ethiopia, Guji, Kenya, Nyeri, and Rwanda, Nyamasheke, you have 6.* |

That pass left two warts, one of them a regression it caused: the collection's noun doubled
(*"your Coffee tasting coffees"*), and a multi-value narrowing ran together as
*"Burundi, Kayanza, Ethiopia, Guji, Kenya, Nyeri, and Rwanda, Nyamasheke"* — eight things rather
than four places. The model had been separating those pairs with semicolons on its own; the
reworded examples lost it, and no rule had ever asked for it. One rule now does, and both warts
went with it:

> *In your Coffee tasting under Burundi, Kayanza; Ethiopia, Guji; Kenya, Nyeri; Rwanda,
> Nyamasheke, you have 6.*

**Wording did hold here, against expectation.** The repo's note says examples alone re-collapse,
and the openers did not: four shapes across five questions. That is one measurement on one model,
not a refutation — the seeded draw over restatement shapes remains the fix that does not depend
on the model remembering, and it is still the human's to choose.

## The second human reading: the restatement is gone

The first reading fixed the wording and kept the shape. The second rejected the shape. Every
answer still arrived as *"Under Colombia in your Coffee tasting, you have 7"* — a phrase naming
what she read, a comma, then the answer — and the owner's reading of it was that it *"reads awful
and unnatural"*, a corporate robot rather than Aluna. The diagnosis held three parts, all
authored:

- **The prompt never said who she is.** Sixteen rules, six of them dictating sentence shape, one
  half-line on register, and not one word from CONTEXT.md's product voice. A model mirrors the
  register of its instructions, and a clipboard of constraints writes like a clipboard.
- **The worked examples were a mould, not a voice.** All three shared one skeleton — *"Of your
  postcards"*, *"Across your fuel log last winter"*, *"Your reading list"* — so the model read one
  grammar three times and cast every answer in it. The previous pass varied their wording and kept
  their shape, which is why it half worked.
- **The two-field schema was itself the shape.** `looked_at` + `found`, joined by the platform
  with a comma, can only produce a fronted phrase and a subordinate finding. No amount of voice
  guidance survives a form with two boxes on it.

So the schema is one field, `answer`, and the prompt instructs the voice rather than the grammar:
who she is, what has to be true, and four rejected shapes with the natural sentence beside each.
No worked answer stands on its own to be copied, and the examples are recipes so that a model that
copies one writes something nobody could mistake for an answer about this desk.

**ADR-0008 rule 1 is withdrawn with it, by the owner, twice stated.** She no longer says what she
looked at before what she found; 6.4/03 is marked reversed, and the ADR, `PLAN.md` decision 16,
ARCH and `docs/modules.md` all carry the amendment and what it costs — the restatement was the
only check on a fluent wrong answer, and there is now none. The collections and the bound values
still cross into the answer's prompt, because the sentence needs them: *from Colombia* is the
value she searched on.

Measured live on the real desk, every figure checked against the database:

| Asked | Said |
| --- | --- |
| how many of my coffees are from Colombia? | *You have 7 coffees from Colombia.* |
| what's my average coffee rating? | *Your average coffee rating is 3.89.* |
| how many teas do I have from Colombia? | *I could not find any teas from Colombia.* |
| how many of my coffees are from Africa? | *You have 6 coffees from Africa.* |
| which houseplants need watering most often? | *Your Boston fern needs watering most often, every 3 days. Your Calathea orbifolia, Alocasia 'Polly,' and prayer plant are next, every 5 days.* |
| do any of my coffees and teas come from the same place? | *I could not find any coffees and teas from the same place.* |

## Findings from the prose pass

Two adversarial reviews ran over the change. Every finding that still applies is fixed.

- **Trimming the truth rules broke the answers.** The first cut compressed *"Answer the question
  from the results below"* out of existence and turned *"Say nothing the results do not say"* into
  a fragment. She stopped answering the question and started describing rows: *"I found coffees
  and teas from China, India, Japan, and Taiwan"* over a union that distinguishes the two, when no
  origin is shared at all. Reproduced twice, fixed by restoring both as whole sentences, correct
  three times after. Only the grammar was on the diet; the truth rules were not.
- **The prompt handed the model its own words again.** `QUESTION_ANSWER_NOTHING_MATCHED` was the
  sentence *"nothing matched."*, and it came back out as *"Nothing matched for Colombia in your
  Tea tasting journal."* It is `(none)` now — a token rather than a sentence — and the empty case
  has a worked pair of its own.
- **The examples were the live desk's own figures.** *"In your Coffee tasting, your average coffee
  rating is 3.89"* is a true sentence on the desk the sign-off gate runs on, so a model copying it
  would have been undetectable there. Every example is recipes and butter now.
- **Answers were unbounded and unscrubbed.** Nothing capped the length of a generated answer
  anywhere — not the schema, not the provider, not the frame — and control characters, zero-width
  marks and a bare `\r` reached `textContent` unseen. `MOST_ANSWER_CHARACTERS` refuses a runaway
  generation into the third ending, characters with no shape are dropped, and every way of
  breaking a line becomes the one the desk renders.
- **Punctuation doubled at both ends.** The two halves each had a transform and the join took the
  rest; with one field, *"you spent 84.20,"* became *"you spent 84.20,."* and a leading comma
  survived. Only her last line is weighed now, so a trailing join mark is replaced rather than
  added to, and a list keeps its own shape.
- **A truncated answer could pass as finished.** `:` had been added to the set of ways a sentence
  stops, so *"Here is the breakdown:"* with no breakdown read as complete.
- **Two assertions did not redden when the behaviour was removed** — the rule pin matched a clause
  opener rather than a claim, and the mis-scope check had become a statement about its own
  fixture. The first pins a whole claim now; the second is deleted, because the platform no longer
  orders anything and a test that cannot fail is worse than none.
- `question-restatement.test.ts` is `question-answer-material.test.ts`: there is no restatement.

## Still open

- **The sign-off gate.** A human has not yet asked a count, a total and a cross-capability
  question on a real desk.
- **Two apostrophes disagree, and it is now visible in one frame.** `ANSWER_WINDOW_OPENING`
  uses a curly `’`; every sentence in `question-narration.ts` uses a straight `'`. They render
  back to back in the same window now. `docs/prose-guidance.md` says straight, but the opening
  is 6.5/01's signed-off copy, so this is not changed here.
- **A context-window overrun will overrun again**, so "Mind asking me again?" invites a retry
  that cannot succeed — the case `RESERVED_ID_BUILD_ENDING` was carved out for on the build
  side. The code deliberately does not inspect the error, so the sentence is not split.
- **A compound question answers nothing rather than answering half.** *"what's my average coffee
  rating, and how many days between waterings do my houseplants need in total?"* read both
  collections and ended on *"I couldn't find anything matching that."* The platform behaved
  correctly — she did not invent a number — but the model's single statement matched nothing and
  the honest ending is unhelpful. Worth knowing before 6.6 scopes context.
- **`done: "ok"` for a question that could not be finished**, while a cancelled one gets
  `done: "error"`. The sentence lives in the window rather than the bar, so the transport says
  the stream ended cleanly; it is the one place it disagrees with what the user is told.
