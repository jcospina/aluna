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

- [ ] A question typed into the prompt bar is classified, run and answered in the
      answer window, with no mode switch or extra control anywhere
- [ ] Narration streams into the answer window as the loop takes its steps, over the
      existing per-job stream
- [ ] The answer replaces the narration in the same answer window and reads as prose,
      with bullets only where a sentence would be a list
- [ ] No table, chart, export, saved query or answer history exists on this path
- [ ] No SQL, table name, column, error string or step count reaches the rendered
      fragment, proved by a sweep over the streamed output
- [ ] Asking a question adds no logo to the desk and writes no registry, version,
      artifact, cache or `read_dependencies` row
- [ ] Build narration still renders in the window and never in the answer window, proved
      by a test that runs a build and a question and checks both surfaces
- [ ] The stale `data_query` deflection line is removed and the `reject` line is
      untouched
- [ ] A question asked twice runs twice and reuses nothing
- [ ] **Sign-off gate:** the human has asked a count, a total and a
      cross-capability question on a real desk and is satisfied with what Aluna
      says and how it arrives
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

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

6.3/01's developer-gated exercise of the loop is scaffolding and comes down in
this issue — the real path is visible now, and two ways to run a question is one
too many.

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
