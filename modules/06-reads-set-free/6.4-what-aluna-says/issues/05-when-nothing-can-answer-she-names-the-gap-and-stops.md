# When nothing can answer, she names the gap and stops — and offers no button

Status: done

> **The `/demo/question` exercise this issue names came down in 6.5/05.** What it proved about
> the loop is proved without it; the references to it below are the record of how this issue was
> verified while the module was still headless.

Type: HITL — the gap sentence is authored product voice and it is the one place
this module comes closest to a proposal without becoming one. Implementation is
fully specified and agent-ready; a human reads the words before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decision 20; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A question about something the user tracks nowhere ends with Aluna naming the gap:
*"You don't have anywhere for hiking trips yet — you can ask me to make one."*
Then she stops.

**No button, no confirmation control, no yes.** An offer-with-a-yes is a
**proposal**, and the proposal surface belongs to Module 10:
`src/pipeline/intent/schema.ts` presently admits only `requires_confirmation:
z.literal(false)`, and its own comment reserves confirmations for M4 deletion and
M10 proposals. Nothing in this issue may add a control that accepts an offer, and
nothing may set that flag.

**The information still arrives, and that is the whole point.** The action is one
ordinary sentence away in the box already under the cursor, which is where every
other thing the user asks for starts. This is the first place M10 should wire its
proposal surface when it has one, and the issue should say so where the code makes
the choice.

**She reaches this ending by looking, not by guessing.** Decision 30 — the loop's
first step is *where would this live* — is epic 6.6's, and 6.6/02 proves the
check. This issue owns the ending itself; it must not be reachable by a model
declining to look.

## Acceptance criteria

- [x] A question about a subject no capability covers ends by naming the gap and
      saying the user can ask for it to be made
- [x] The ending renders no button, link or confirmation control of any kind
- [x] `requires_confirmation` is untouched and still admits only `false`
- [x] The sentence names the subject in the user's words and no capability, table
      or column
- [x] The ending cannot be produced without the loop having looked first
- [x] A comment where the ending is produced records that this is M10's first
      proposal-surface site
- [ ] **Sign-off gate:** the human has read the sentence and confirms it informs
      without offering
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn. Ask about something you
do not track at all — hiking trips against a desk holding Notes and Expenses — and
read what comes back. The plan's living-demo step 6 is this behaviour on a real
surface, and it says explicitly: no button appears.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/04-zero-rows-is-never-a-statement-about-the-users-life.md

## What landed

**A fourth ending, and the model may ask for it.** `QUESTION_DECISIONS` grew `no_home` beside
`read` and `answer` (`src/runtime/query/question-tool.ts`), so a turn can say this desk holds
nowhere for what was asked about. It carries no statement and spends no read, and the loop ends on
the platform's own sentence: *"You don't have anywhere for hiking trips yet — you can ask me to
make one."* Then she stops. Nothing renders a button, a link or a control of any kind, and
`requires_confirmation` still admits only `false` — the surface that would accept an offer is
Module 10's, and the loop says so where the ending is produced.

**The words are the platform's, beside every other ending's.** `question-narration.ts` holds the
sentence, the one naming nothing in particular (`QUESTION_NO_HOME_FOR_THAT`, *"You don't have
anywhere for that yet — you can ask me to make one."*) and the narrowing that makes either safe.
`question-no-home.ts` holds the call that offers a subject and the check that refuses one.

**Only the subject is generated, and it is narrowed to words this person wrote.** One focused call
carries the question and nothing else — no rows, no collections, no steps. What it returns is
matched against the question as an unbroken run of words, case- and punctuation-insensitive, and
what crosses into the sentence is those words joined by single spaces. So neither a phrase the
model assembled out of words they used apart, nor the stretch of question standing between two of
their words, reaches a sentence the platform vouches for. A run long enough to be the question
rather than the thing it asks about is refused too. A subject that is not theirs leaves the
sentence naming none, and so does a generation that would not read — the words are ours either
way, and only a cancellation still ends the question.

**The claim is about their desk, so the platform checks the half of it that it can.** A subject
naming a collection they already have is refused outright against the catalog the question is
already holding, either way round: *expenses* is caught by the Expenses they have, and *notes from
my doctor* by their Notes. Names, never meanings — the half that reads the data is decision 30's,
and 6.6/02 owns it.

**A search that matched nothing keeps its own ending.** That claim is about her search and this
one is about the desk, and where both would be available the weaker one is the true one
(decision 17). So a question whose steps all matched nothing ends on
*"Looking at your Expenses, I couldn't find anything matching that"* and never on the gap, and no
naming call is made for it.

**She has to have looked.** The turn refuses the decision until a statement of hers opened one of
this person's collections (`questionOpenedACollection`), and the model gets `LOOK_BEFORE_NO_HOME`
back as an ordinary failed step: read one first, because what they asked about is often a value
inside a collection rather than a collection of its own. A statement that returned a row of its
own — `SELECT 1` — opened nothing and does not count. It is told once: a second gap claimed with
nothing opened answers out of what it has instead, rather than spending ten turns on the same
refusal. 6.6/02 goes on to make the looking the loop's first step.

**The demo carried it.** `/demo/question` rendered the ending under its own heading, *Nowhere for it
— what Aluna says*, as a sentence and nothing else; the vocabulary block that the sign-off gate
reads lists the gap beside every other sentence there is; and the page's own note says a question
this desk holds nowhere for ends with the gap named and nothing to press. CONTEXT.md gained
**Nowhere for it**, sited against **Nothing matched**, which now points at it.

## Findings

Every finding from the adversarial and standards passes is fixed.

**Fixed**

- **The sentence could name a collection the desk already holds.** *"You don't have anywhere for
  expenses yet"* on a desk holding Expenses — the collection was in the turn's own prompt one line
  earlier. A flat falsehood about this person's desk, in a sentence the platform vouches for.
  The narrowed subject is now checked against the held catalog and the ending gives way.
- **The gap silently superseded a truthful *nothing matched*.** A step that searched Expenses for
  *hiking* and matched nothing, followed by `no_home`, said there was nowhere for hiking. She has
  somewhere for it and simply spent nothing. `questionFoundNothing` now takes precedence, which is
  issue 04's rule applied at the desk instead of at a row.
- **Combining marks were stripped, garbling the person's own word.** The word pattern omitted
  `\p{M}`, so a mark ended a word and was dropped: a decomposed *café* — what a paste from macOS
  routinely is — came back *cafe*, and Devanagari, Arabic and pointed Hebrew came back broken into
  letters. Marks now stay on the word they belong to.
- **The stretch of question between two of their words rode into the sentence.** The subject was
  sliced out of the question, so `hiking "><" trips` put markup inside a sentence the platform
  vouches for. Their words are now joined by single spaces and nothing else crosses.
- **The subject was unbounded, so the whole question could become it.** *"You don't have anywhere
  for how many hiking trips did I take last year yet"* — their own words, and still not a subject.
  A run past a handful of words names nothing instead.
- **A model that would not look burned the whole budget.** Ten `no_home` turns spent ten reads,
  lost the ending to *I couldn't work this one out*, and narrated ten looks she never took through
  the seam 6.5/03 streams. It is told once, and then answers out of what it has.
- **A generation that would not read ended the question.** The real spine rejects the handle of a
  shape its schema refuses, so the fallback was unreachable outside a fake provider. It is caught
  now and the sentence names nothing; a cancellation still rethrows and ends the question.
- **The model would not reach the ending at all.** Live, against the real desk, it answered a gap
  question out of an unrelated collection: *"I did not read any of your guitar practice sessions,
  so I could not find it."* The turn's rules now name the ending, tell it to read what the
  collections hold rather than hunt for the thing, and say to reach for the gap rather than answer
  out of a collection about something else. `QUESTION_NO_HOME_RULES` is pinned by a test — nothing
  else tells the model this ending exists.
- **The worked example in the naming rules was the suite's own fixture.** A live run could not tell
  reading the question from copying the example. It is a subject no fixture and no demo uses.
- **Two dispatchers had a catch-all where this repository uses `never`.** A fourth decision or a
  fifth turn kind would have compiled and misrouted; both are exhaustive switches now.
- **The sentence lived away from the other endings'**, which made `question-narration.ts`'s claim
  to be the only place the words exist untrue.
- Tests: a markup assertion that could not fail; a fallback test naming a behaviour the code did
  not have; two `.not.toBe("no_home")` assertions that passed for any ending at all; a
  self-comparison inside a `toEqual`; a prompt asserted in isolation rather than the one the loop
  built; the unreadable-step shape restated rather than reused, now `toldAgainStep`; the sentence,
  the subject and a whole classification restated across four files; the new vocabulary row and the
  three new turn rules unpinned. All fixed.
- Three comments that restated the code; `findsNoHome`, which read like `questionFoundNothing` and
  named the opposite ending; a heading whose three siblings were subject-and-verb.

**Accepted, and why**

- **The gap is not verified, and cannot be here.** The platform checks that she looked, that the
  subject is not a collection they have, and that no truthful *nothing matched* is available. What
  it cannot check is whether the subject is a value inside a collection — that is decision 30's
  check and 6.6/02 owns it. This issue owns the ending, and the issue says so.
- **The collection check errs toward suppressing a real gap.** *note paper* is caught by what a
  Notes record is called. A suppressed gap costs her the stronger sentence; a gap she should not
  have claimed is something untrue about their desk, so the check leans the first way.
- **`QUESTION_NOTHING_FOUND_ANYWHERE` stays.** 6.4/04 handed on that it sits near this ground. The
  two claims are different — hers touched nothing of this person's, this one is about the desk —
  and the precedence rule above keeps the gap from answering its case.
- **A script written without spaces names nothing.** Thai runs its words together, so a clause
  reads as one word and no subject inside it can be told apart from it. She says the sentence
  without naming the thing, which is true rather than wrong.
- **The developer page shows `LOOK_BEFORE_NO_HOME` verbatim**, token and all, as it already shows
  the unreadable-decision refusal. It is a step failure message on a developer surface; 6.5 must
  not carry step failure messages onto the real one (decision 15).

## Verification

`bun run test` (2939 passed, 0 failed), `bun run typecheck`, `bun run lint` clean.

Live, against the running desk through 6.3/01's developer-gated turn. The desk holds Coffee
tasting diary, Job applications, Freelance invoices, Reading Log, Hypomnemata, Hiking trips, Tea
tasting journal, Houseplants and Reading list.

- **A question this desk has nowhere for.** *"how many guitar practice sessions did I do last
  month?"* — she read Hypomnemata's titles and then its entries, both matched, and stopped:
  *"You don't have anywhere for guitar practice sessions yet — you can ask me to make one."* Under
  *Nowhere for it — what Aluna says*, with nothing to press. The subject is the words in the
  question.
- **A subject the desk does cover.** *"how many hiking trips have I logged?"* — no gap:
  *"Of your Hiking trips, you have logged 22 hiking trips."*
- **The adversarial case, live.** *"how much did I spend on hiking last year?"* — Hiking trips is
  a real collection and hiking is a plausible value inside it, so the gap would have been a lie.
  She read the trips and said *"Looking at your Hiking trips, I could not find how much you spent
  on hiking last year."*

The first live attempt, before the turn's rules named the ending, answered the gap question out of
an unrelated collection instead. It is recorded above as a finding.
