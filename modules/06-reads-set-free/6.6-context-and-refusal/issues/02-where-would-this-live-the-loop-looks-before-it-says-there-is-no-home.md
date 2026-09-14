# Where would this live: the loop looks before it says there is nowhere

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.6 — Context and refusal
(PLAN decision 30; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

A question about something with no obvious home is answered by looking, not by
guessing.

**Because a `data_query` holds the whole catalog, the loop's first step *is*
"where would this live".** It checks whether a capability for the subject exists
and whether the open one could answer — the same shape of check the resolver makes
for evolution — and only when neither can does it reach 6.4/05's gap answer.

**The point is that the gap answer becomes earned.** A model that shrugs at an
unfamiliar word and declares a gap would be wrong most of the time: the subject
may be a value inside a capability rather than a capability of its own, and
6.4/01's vocabulary step is exactly how it finds that out. This issue is what
stands between a real gap and a lazy one.

**No new classifier, no new resolver pass.** The check is a step in the loop, on
the catalog the scope already holds.

## Acceptance criteria

- [x] The loop's first step establishes where the subject would live, against the
      catalog the scope already holds
- [x] A subject that is a value inside an existing capability is found there and
      answered, not reported as a gap
- [x] A subject the open capability could answer is answered from it
- [x] The gap answer is reachable only after the check has run and found nothing
- [x] No additional classifier or resolver pass is introduced
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The plan's living-demo step 6, and the case that makes it honest. With Notes and
Expenses on the desk, ask about a category that lives inside Expenses under
another name and confirm she finds it rather than telling you there is nowhere for
it. Then ask about hiking trips and confirm she names the gap only after she has
looked.

## Blocked by

- modules/06-reads-set-free/6.6-context-and-refusal/issues/01-the-open-capability-is-context-never-a-filter.md

## What landed

Where the subject would live is now the first thing a question settles, and the gap sentence is
what is left when the desk turns out to hold nowhere for it. Nothing new is generated to find that
out: both halves read the catalog the question is already holding.

- **The turn's prompt gained one headed block**, `QUESTION_WHERE_IT_LIVES_HEADING` and its rules,
  sitting immediately above the collections it sends her to weigh. The resolver's version of the
  same check is one prompt line away, so this is the shape decision 30 asked for rather than a new
  mechanism. The two lines that told her to look moved out of `QUESTION_NO_HOME_RULES` and into it:
  looking belongs with the check that earns the ending, not as a caveat on the ending.
- **The gap's catalog check widened from a collection's name to everything a collection holds** —
  its label, what it calls one record, each live column's name and label, and a choice field's
  declared values. That is the half of decision 30 a catalog can answer alone: *vegetables* filed
  under the label *Greens* is caught here. The other half is the looking, and only the looking
  gets from *groceries* to *food*.
- **The check is asymmetric, and the asymmetry is the guard.** A collection's name is matched
  either way round, as it always was. What is *inside* a collection has to be the whole subject,
  because one desk of nine collections puts two hundred names in reach — mostly single ordinary
  words like *light*, *hard*, *other*, *room* — and a bidirectional match there suppresses *light
  bulbs* as soon as *light* is a roast level. A suppressed gap is not a weaker true sentence; it is
  a generated one, because `QUESTION_ANSWER_RULES` forbids the answer from saying they do not have
  the thing.
- **A question naming nothing of its own, asked in front of a window, is about that window.**
  *How many did I add this month* has no subject to copy, so the naming call cannot come back with
  one — and they plainly have the collection standing there. Asked in front of nothing, the same
  words keep the unnamed sentence. An unreadable generation is not that case and never reaches it:
  a provider that hiccuped is no evidence about anybody's desk.
- **`id` is not among the names weighed.** The resolver compares one, but an id is engineering
  language and never this person's, and a renamed capability's is a word nobody on the desk uses —
  *notes from my landlord* would be held by a Journal whose id is still `notes`.

## Findings

Two review agents, adversarial and standards. Every finding is fixed, MINOR, INFO and pre-existing
included. Where the two disagreed, the documented invariant decided.

**Fixed**

- **The widened check killed real gaps** (MAJOR, and found while probing the live desk before
  either agent reported). Matching a column's names in both directions turns the check into "does
  the subject contain any held word", and the held words include *light*, *hard*, *other*, *room*.
  Now: either way round for a collection, the whole subject for what is inside one. Pinned by a
  test that fails the moment the match goes bidirectional again.
- **`row.id` was matched against a person's words** (MAJOR). `src/registry/spec/spec.ts` says an id
  is never user-facing and `whole-catalog-query-scope.ts` states the invariant for this exact path.
  Dropped. **The standards agent argued the opposite** — keep it, because the resolver compares one
  — and the invariant for this path decided it: the resolver's comparison is a model reading
  context, not a string match against what someone typed.
- **The open-window clause swallowed a provider hiccup** (MAJOR). An unreadable naming generation
  and words that were merely not theirs both arrived as "nothing to narrow", so a hiccup with a
  window open silently cancelled the gap. The two are separated now, and the docstring that had
  become false says what the code does.
- **A documented fact was deleted to buy a comment-budget line** (MAJOR). The header was at 15/15,
  so the new sentence cost the one that said what decision 6 actually bounds — *the worst a misled
  turn can do is write another read-only statement*. The paragraph is restored whole and the new
  sentence is gone: the block's own JSDoc already states and cites it.
- **"Having looked" lost its antecedent** (MAJOR). The line that told her to look had moved 25
  lines down the prompt, leaving a participle referring to nothing. The rule carries its own now.
- **The block restated three rules the prompt already carried** (MINOR) — the table bound,
  decision 28's fencing, and the vocabulary rule. Cut to what is genuinely new.
- **A heading welded a label to an instruction** (MINOR). `"Where this would live:"` is the
  heading; settling it first is the block's first rule, beside the other rules.
- **A JSDoc re-derived decision 30** (MINOR) instead of citing it. It now cites the resolver's own
  line, which is the one fact the PLAN does not carry.
- **Three test-fixture comments claimed things that were false here** (MAJOR ×2, MINOR) — a desk
  described as never using the words its own questions ask with, a premise copied verbatim from a
  suite where it held, and a "bespoke rather than shared" claim about a spec that was a byte copy.
- **A restated source literal** (MAJOR). `"The collections:"` is `QUESTION_COLLECTIONS_HEADING`
  now, and the test asserts the block and the catalog arrive adjacent rather than merely in order.
- **Two duplicated test fixtures** (MINOR). `notesSpec` is exported from the support module and the
  plan's worked question lives beside the subject it is built from, as `A_QUESTION_WITH_NO_HOME`.
- **Dead fixture data** (MINOR): a choice option no row used and no assertion named.
- **`CONTEXT.md`'s *Nowhere for it* entry understated what is refused** (MAJOR) — it still said
  "a collection they already have". It names all four places a name can be, and the window case.
- **A barrel comment counted one catalog check** (MINOR) where there are two.
- **An INFO the adversarial agent raised and no test held**: nothing pinned that an unreadable
  naming generation keeps the unnamed gap whatever is standing. A mutation proved the gap; the
  test exists now.

**Recorded rather than fixed**

- **Criterion 1 is satisfied by prose, not machinery.** The block asking her to settle where the
  subject would live is advisory prompt text; what the platform *enforces* is that no gap is heard
  until a statement opened a collection, and `questionOpenedACollection` counts any read that
  returned rows rather than one that established a home. The issue asks for a step in the loop and
  that is what this is, but the distinction belongs on the record.
- **Criterion 3 is implemented for the unnameable subject only.** Where the naming call does come
  back with the person's own words, the open window is never consulted — the subject is weighed
  against the whole catalog, which includes it. For decision 28's pronoun reading that is right;
  for a named subject whose home happens to be the open collection, nothing looks there first.
- **6.4/05 handed "the half that reads the data" to this issue, and this issue does not read data.**
  It matches *declared* values, which covers a choice column and cannot see a free-text column at
  all. The data is read by the loop's own steps — 6.4/01's vocabulary step — which is what gets
  from *groceries* to *food*. 6.4/05's sentence is stale in that one word, and worth the owner's
  eye before it is edited.
- **Three of the new suite's tests survive a full revert of the source.** One is a negative claim
  (no second generation) where passing before and after is the right shape; two are controls that
  only pin the change as a pair with the test above them. Said plainly rather than counted as pins.

## Verification

`bun run test` (3068 passed, 0 failed), `bun run typecheck`, `bun run lint` clean.

Seven mutations, each reverting one behaviour and each caught: the where-it-lives block never
rendered, a column's names never weighed, a column matched either way round again, the open window
never weighed, any desk counted as a window standing open, an unreadable naming generation
swallowed by the window clause, and the looking gate removed from the turn.

### The live round-trip

Against the real model on the real desk — nine capabilities — through the prompt bar on `:3030`.

| Done | Seen |
| --- | --- |
| Asked *"how many cold brews have I made?"*, where `cold_brew` is a steeping method inside the Tea tasting journal and no collection of its own | *"You've made 1 cold brew."* — one row holds it, and she found it in a column rather than reporting a gap |
| Asked *"how many parking tickets did I get last spring?"* | *"You don't have anywhere for parking tickets yet — you can ask me to make one."* — narrated as looking first, then the gap, in the words that were typed |
| Read the answer window on that ending | One sentence. No button, no tile on the desk, nothing to say yes to |

**The second row is what the live test was for.** On the first attempt she searched seven
collections for parking tickets, matched nothing in each, and ended on *"Looking at your Coffee
tasting, Hiking trips … I couldn't find anything matching that"* — true, and not the gap. Trimming
the prompt block on a reviewer's advice had dropped the original rule's *rather than searching for
the thing itself*, which is the phrase that keeps a real gap from being buried under a pile of
empty searches. Restored, with what it costs said out loud, the same question names the gap. No
test could have caught that: both endings are honest, and only one of them is decision 20's.
