# Ten steps, no timeout, and a spent budget that says so instead of answering half

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.3 — The loop
(PLAN decisions 5, 8, 9; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

6.3/01's turn becomes a loop. The model decides its own next step and keeps
deciding until it answers or the budget is spent.

**A real loop, not a fixed pipeline** (decision 5). There is no
read-the-vocabulary-then-map-then-compute sequence with a retry branch bolted to
the side; there is one honest bounded loop that handles the question nobody
anticipated the same way it handles the one everybody did. Each turn's result —
rows, an empty result, a failed statement — goes back to the model and it chooses
again.

**Ten steps** (decision 8). Capabilities in this PoC are simple and the questions
asked of them are simple, so the budget is deliberately one a real question never
approaches; decision 33 is what will tell us whether ten was generous or tight,
and 6.6 records the number.

**No timeout** (decision 9), replacing `docs/modules.md` §6.2's *defensive `LIMIT`
+ timeout*. Slow is allowed. Waiting is a product cost the user accepts; freezing
was a liveness bug and epic 6.2 fixed it structurally. No wall-clock deadline is
applied to a step or to the loop, and a test pins that so one is not added back as
a convenience.

**A spent budget says so, and never answers half.** Reaching ten steps ends the
question in product voice — she says she could not get there, not a partial total
with the confidence of a whole one. The words are platform-owned, like every other
sentence on this path (decision 15), and they carry no step count, no SQL and no
machinery.

## Acceptance criteria

- [x] The loop runs the model's chosen steps in sequence, feeding each result back
      to it, until it answers or the budget is spent
- [x] The budget is ten steps, exercised by a fixture loop that reaches it
- [x] No timeout exists on a step or on the loop, pinned by a test — pinned twice,
      and the one clock a question still inherits is ADR-0003's and is recorded
      below rather than hidden
- [x] A spent budget ends the question with a platform-owned sentence and never
      with a partial computation presented as an answer
- [x] The ending sentence carries no step count, SQL, table name, column or error
      string
- [x] An empty result and a failed statement are ordinary turns and do not end the
      loop early
- [x] The read scope and its tokens release in `finally` on every one of these
      endings
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. Exercise it through 6.3/01's developer-gated turn: drive a fixture that
never converges and confirm it stops at ten and says so rather than answering with
what it happened to have. The user-visible form of this arrives with 6.5.

## Blocked by

- modules/06-reads-set-free/6.3-the-loop/issues/01-one-tool-one-turn-a-parameterized-read-only-query.md

## What landed

- `src/runtime/query/question-loop.ts` — the loop. `QUESTION_STEP_BUDGET` is ten and is
  deliberately not injectable: a budget a caller could lower is a budget no test proves, and
  this is the number 6.6/04 goes on to measure. `QuestionLoopResult` is a union whose two
  endings are **different shapes** — `answered` carries its steps, `budget_spent` carries
  only how many there were — so the thing 6.4 writes an answer from arrives without the
  material when the question never finished. `questionEndingNarration` switches on the closed
  ending set the way `deflectionNarration` does, and returns `null` for `answered` because
  the words for what she *found* are 6.4's.
- `QUESTION_BUDGET_SPENT_SENTENCE` — the one sentence this issue authors. It makes a claim
  about her own looking rather than about the user's data, which is decision 17's rule held
  one issue early. 6.3/04's sign-off gate reads it alongside the label vocabulary.
- `src/runtime/query/question-tool.ts` — `questionDecisionSchema`, the two moves a turn may
  make. It nests the *derived* one-tool call schema rather than restating it, so 6.3/01's
  invariant survives the wrapping: an inventory that grew a second member still fails at
  import. `read` is required-and-nullable with a refinement, for the reason
  `proposed_identity` is in `intent/schema.ts` — an absent key is what strict mode refuses,
  and a refinement emits nothing into the JSON Schema.
- `src/runtime/query/question-turn.ts` — the turn returns a `QuestionTurn` union, the prompt
  carries how many reads are left, and the provider is wrapped in the scope's signal so a
  generation that never settles is ended by the question ending rather than parking the loop.
  `QuestionStep.call` is now nullable, which is how an unreadable decision is shown back.
- `src/pipeline/query/data-query.ts` — `runDataQueryTurn` became `runDataQuery`: one scope,
  the whole loop inside it, an `onStep` seam threaded through.
- `src/server/routes/query/demo-question.ts` — the developer-gated page runs the whole loop
  and watches it through `onStep`, so a spent budget still shows its ten statements while the
  *ending* it renders is Aluna's sentence and nothing else.
- 44 tests across `question-loop.test.ts` (new), `question-tool.test.ts`,
  `question-turn.test.ts`, `data-query.test.ts` and `app.demo-question.test.ts`.

## Findings fixed

Two review agents: one adversarial, mutation-testing every acceptance criterion, one checking
the work against the plan, the ADRs and every sibling issue. Every finding is fixed, INFO and
pre-existing included; the one that is recorded rather than removed was put to the human and is
marked as such.

**The eleventh read ran.** The worst of them, and the fix for the previous finding is what
created it. `runQuestionTurn` does not stop at the decision — it falls through to
`assertWholeCatalogQuery` and `scope.read` — so the final answer-only turn executed a
statement anyway whenever the model asked to read again, and threw the rows away. Every
budget-spent question ran eleven statements while reporting ten: an unbounded wait, with no
timeout to bound it, whose result nobody ever sees, and a skew in the one number decision 33
exists to collect. The comment sitting directly above it claimed the opposite. The budget is
spent *before* the statement now — a read decided with nothing left comes back as a third turn
kind, `spent`, and never reaches the worker. Pinned by counting what reached the worker rather
than what was recorded: the old test asserted ten steps and eleven prompts and stayed green
through all of it.

**The no-timeout pin was two-thirds theatre, and a real deadline walked straight past it.**
The first draft pinned decision 9 with a global timer spy and a three-file string sweep. A
plain `new Date().valueOf() - startedAt > 30_000` added to `question-loop.ts` itself left the
suite fully green: no timer is armed, so the spy saw nothing, and `new Date` was not one of
the seven literals the sweep grepped. Neither could see `Bun.nanoseconds()`, `process.hrtime`,
an `import { setTimeout } from "node:timers"` binding the spy never intercepts, a deadline in
any fourth file, or one applied inside the Worker — which is precisely *a timeout on a step*.
The pin is now behavioural first: every clock the process can reach reports a time that jumps
a **year per read**, and a whole budget is run to its ordinary ending anyway, so a deadline
built from any warped clock fires. Demonstrated in both directions — a loop-spanning deadline
in a swept file turns two tests red, and a *per-turn* deadline planted in an **unswept** file
(`platform/provider/abort.ts`) turns the clock pin red on its own. The sweep survives as the
second line, widened to eleven constructs and to all eight files a question passes through,
the worker's thread included, plus a test that the swept paths resolve so a mistyped filename
cannot pass by reading nothing.

**A question is still wall-clock bounded, and it is not this path that bounds it.** Every AI
call in the product carries ADR-0003's per-generation stage deadline
(`DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS`, five minutes, `platform/provider/spine.ts`), so the
loop's up-to-ten generations each inherit one, and when it fires the question dies carrying
`ProviderStageTimeoutError` rather than anything Aluna would say. The original claim — "nothing
on this path arms a timer" — was literally true and materially misleading. **Recorded rather
than removed, by human decision.** The deadline exists because the SDK leaves `object`
permanently pending on a transport fault; taking it away trades a bounded wait for an
unbounded one in which a parked turn holds the whole catalog's read tokens, and the cancel
triggers that would replace it are 6.5/04's. What *is* fixed here is the liveness half:
`runQuestionTurn` wraps the provider in `abortableProvider(provider, scope.signal)`, so a
closing read gate now ends a stuck generation instead of waiting behind it. Decision 9's own
target — no deadline on a slow read, none on the loop — holds and is pinned.

**One badly shaped object threw away nine unspent reads.** `questionDecisionSchema.parse` sat
above the turn's `try`, so a decision that failed validation left the loop as a raw `ZodError`
— and the likeliest real shape of it is the one the schema is built to reject: an `answer`
still carrying the `read` it just said it did not need. Nine reads and every row already
fetched were discarded for a model's typo, with no retry and no sentence. A decision that will
not parse is now an ordinary step: it costs one read and comes back as words, exactly as a
failed statement does. A generation that *faulted* still ends the question, because a
connection that is not there has nobody to hand a result to — the same line 6.3/01 drew for a
database that is not answering. The two are told apart by where they surface, a rejected
handle versus a resolved one, which is all the provider contract promises.

**The budget counted turns, so the tenth read was spent and never seen.** The loop exited the
moment ten steps existed, discarding all ten results — a question that needed exactly ten
reads could never be answered, and would fail while holding its own answer. The budget counts
*reads* now: after the tenth, the model gets one final turn in which the prompt says there are
no reads left, and only an answer can come back. Eleven generations for ten reads, pinned, and
`formatBudget`'s zero branch is no longer dead code.

**A partial computation could sit beside the sentence and no test noticed.** Rendering a total
assembled from the ten spent steps *above* Aluna's ending left the demo suite green — it only
asserted the sentence was present. The ending block is now pinned whole, heading to closing
tag, so a computed answer appearing next to it turns red. And the structural claim in
`question-loop.ts` was overstated: `onStep` hands every row to every watcher on every ending,
so "nothing downstream is given the choice" was false — the choice had moved to another
parameter. The comment now claims exactly what the type buys, which is that the *default* path
arrives without the material.

**A missing API key was an Internal Server Error.** `deps.getProvider()` was called one line
above the `try`, and `createProvider` resolves its config eagerly — so the single likeliest
developer failure produced a 500 and a console stack, on a page whose stated premise is that a
failure is something you read on it. Moved inside, and tested.

**The loop's own suite did not assert the thing it owns.** Returning `steps: []` from the
answered ending left every test in `question-loop.test.ts` green; only `data-query.test.ts`
caught it, because the multi-step cases read the `onStep` array rather than the result. The
answered payload is asserted on the result now.

**Three sibling issues were told what they could not have discovered.** 6.6/04 cannot take its
duration reading inside the query path, because the no-timeout sweep refuses every clock name
there and a substring sweep cannot tell a measurement from a deadline — its issue now says to
measure above `runDataQuery`, where `metrics-recorder.ts` already does, and that a red sweep
there is this constraint rather than a regression. 6.3/04 now knows a step can carry no tool
call at all, so its narration switch needs the generic-fallback branch for one. And 6.5/03 now
knows the loop has a **third** ending that is nobody's yet: a question can throw — a faulted
generation, a closing gate, a context overrun — and today that surfaces as a raw error string
where ADR-0001 and ARCH §9.7 want product voice, so the sentence for *the question could not be
finished* is named as its work.

**Smaller ones.** A throwing `onStep` was safe but untested, and now has a test proving the
scope still returns its tokens. `UNREADABLE_DECISION` is swept for machinery like the
user-facing sentence, even though it is addressed to the model. The sentence sweep gained the
check that it is the *whole* ending rather than merely present. The two bespoke rogue providers
each suite had grown became `providerResolving` and `providerFaulting` in the shared support,
which is also what kept `question-turn.test.ts` under its file ceiling; `warpClocks` moved out
to `clock-warp.test-support.ts` for the same reason. Two live comments had gone stale and were
corrected — `dev-surfaces.ts` and `scripts/build.ts` both still called `/demo/question` a
one-turn exercise. And the timer-spy test's own comment overclaimed: it runs against a scripted
provider, so it proves this module's code arms nothing, not that a real question does — a real
one arms a `setTimeout` per generation inside the spine, which is the inherited deadline above.

**Not defects, recorded.** The decision schema holds: `theOnlyQuestionTool()` still runs at
module load and the wrapper nests its derived schema, so a second tool fails at import, and no
shape passes the schema and then throws deeper. The demo route's escaping, cross-site guard and
malformed-body handling are unchanged and still hold. Read tokens were checked on every ending
— answered, spent, failed statement, cancel mid-loop, a throwing watcher, a faulted generation
— and every one returns the gate to zero readers.

**Carried into 6.3/03 rather than fixed here.** The prompt re-renders every prior step's
complete row set into every later prompt, so a question's cost grows as n²/2 across the budget.
Measured on a real ten-step loop with one 729-row × 6-column result (~58.6 KB of JSON): prompts
ran 1,734 → 60,290 → … → 529,034 characters, **2,653,692 for one question**, order 660k tokens
— and 729 rows is a small read. The size cap is 6.3/03's by name, but a cap chosen against one
step admits about 50× itself across ten, so 6.3/03's issue was amended with the measurement and
an acceptance criterion that the cap bound the whole question rather than one step.

## Verification

- `bun run test` — 2750 pass, 0 fail; `bun run typecheck`, `bun run lint`, `bun run build` clean
- `bun test src/runtime/query src/pipeline/query src/server/routes/query` — 142 pass across 8 files
- Mutations, each turning exactly the intended test red: the budget check removed, `<` → `<=`,
  a spent budget returning its steps, the answered ending returning none, an empty result and a
  failed statement each ending the loop, the narration returning `null`, a partial total rendered
  beside the sentence, a loop-spanning `new Date()` deadline in a swept file, and a per-turn
  `Date.now()` deadline in an unswept one.
- No worker or memory leak: twenty consecutive spent budgets (200 worker reads, twenty worker
  threads opened and closed) move RSS 83 → 131 MB with the increments shrinking to nothing, which
  is heap warm-up rather than a ramp. One worker per question, whatever its step count.
- **Live, against the real desk on `:3030` and the real provider.** This is what proves the
  decision's wire shape, which no test can establish without spending: the required-nullable
  `anyOf` round-trips, and the model really does return `{next:"answer", read:null}` to stop.
  *"how many of my job applications did I mark as rejected?"* — one read, then an answer.
  *"which of my hobbies have I kept up with most this year?"* — one six-way `UNION ALL` across
  every capability, then an answer. *"how many of my houseplants are succulents?"* — the first
  read matched nothing and the model wrote a second, broader one, which is an empty result
  behaving as an ordinary turn on the real provider rather than in a fixture. And after the
  fixes, a cross-capability CTE joining the reading log to hiking trips, answered in one read.
