# The open capability is context, never a filter, and the scope rides in the sentence

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.6 — Context and refusal
(PLAN decisions 28, 29; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The capability in the window resolves vague references and nothing else.

**It is context** (decision 28). *"these"*, *"ones"*, *"how many did I add"* —
the open capability is what those words point at, exactly as it already does for
evolution in `src/pipeline/intent/resolver.ts`. `data_query` already permits a
non-null `target_capability` in `src/pipeline/intent/schema.ts`, so this is mostly
letting existing, tested machinery through rather than building new machinery.

**It is never a filter.** A question about expenses asked with Recipes open is
answered about expenses. The open window narrows what a pronoun means; it never
narrows what may be searched, and a question that names its own subject ignores it
entirely.

**Scope is stated in the answer, not shown as a control** (decision 29). No scope
chip, badge or pill appears on the prompt bar or anywhere else. *"Of your recipes,
six use butter"* carries the scope in ordinary English, so a mis-scoped answer is
visible at once and a correctly scoped one reads as speech. 6.4/03 already
requires the sentence to say what she looked at, so this costs nothing extra —
what this issue owes is the proof, and the absence of the control.

> **That last premise was stale by the time this was built.** 6.4/03 was reversed by the owner on
> 2026-09-11 and ADR-0008 amended the same day: the forced restatement is withdrawn, and *"where
> she looked is not part of what she says."* What the amendment took away is the **preamble**, not
> the noun — decision 29's own example, *"Of your recipes, six use butter"*, is the shape the
> answer rules already held up as the good one. So this did cost something: one worked example in
> `QUESTION_ANSWER_RULES`, asking that a question which never says what it is about be answered
> by a sentence that does. The owner chose that shape over the two alternatives before it was
> written.

## Acceptance criteria

- [x] A vague question asked with a capability open resolves against that
      capability and says so in the answer
- [x] The same question asked with nothing open is answered across the catalog
- [x] A question naming a different subject is answered about that subject, with
      the open capability ignored — proved by asking about expenses with Recipes
      open
- [x] No scope chip, badge, pill or any other control appears on the prompt bar or
      the answer window
- [x] The resolver is not extended for this; `target_capability` on a `data_query`
      is consumed as it already exists
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

The plan's living-demo step 5. Open Recipes (or Notes) and ask *"how many did I
add this month?"* — she scopes to the open capability and says so in the sentence.
With that window still open, ask about expenses; she answers about expenses, not
about what is on screen. Confirm nothing on the prompt bar shows a scope.

## Blocked by

- modules/06-reads-set-free/6.5-the-answer-window/issues/04-a-query-does-not-lock-the-prompt-bar.md

## What landed

The window a question was asked in front of now reaches the loop that answers it, as one line of
context and nothing more. The whole catalog is opened either way.

- **The window is the desk's fact, not the model's.** `target_capability` alone would have been a
  guess described to the next turn as something the person is looking at, and ADR-0008's amendment
  had just taken away the only check they had on a confident wrong answer. So the two halves cross:
  `standingCapabilityId` (`src/pipeline/jobs/restoration.ts`) reads the restoration the resolver was
  classified against, it rides to `runDataQuery` beside the intent, and
  `windowTheQuestionLeansOn` names a collection only where both agree. A capability the model
  invented, and a window the sentence did not lean on, are each no window at all.
- **One line in the turn's prompt**, under `QUESTION_OPEN_WINDOW_HEADING`, and its two rules sit in
  the `Rules:` block with every other rule — what it is for, and that it fences nothing off. A
  question asked with nothing standing carries no line about a window, so there is nothing in its
  prompt to read a scope out of.
- **The resolver gained one sentence and no machinery.** The rule beside it enumerates the build
  intents and left a question's use of `target_capability` unsaid, so the field arrived null
  whatever was standing and decision 28's "existing, tested machinery" was inert.
  `INTENT_DATA_QUERY_CONTEXT_RULE` says what the field means on a question: the active capability
  where the sentence leans on it for a loose word, null where the sentence names its own subject.
  **This is the one place the work touches the resolver, and acceptance criterion 5 can be read as
  forbidding it** — argued both ways in the findings below, and worth the owner's word.
- **Scope rides as the noun.** One worked example in `QUESTION_ANSWER_RULES`: a question that never
  says what it is about is answered by a sentence that does. No preamble, no second field, no
  platform-joined clause — the shape decision 29 asks for and the shape the rules already modelled.
- **A renamed capability is named the way the person renamed it.** `scopedCapabilitySpecs` now
  resolves `label` through `canonicalCapabilityLabel`, so the collections a turn may read, the
  window it was asked in front of and the names an answer may say are all the words on the person's
  own desk. The second resolution point in `question-turn.ts` is gone, and `registeredSpecs` builds
  a spec the same way the runtime does rather than its own way.

## Findings

Two review agents, adversarial and spec-conformance. Every finding is fixed, LOW, INFO and
pre-existing included.

**Fixed**

- **The window was the model's guess presented as a fact** (HIGH). `target_capability` reached the
  prompt unchecked, under a heading claiming a collection was on screen. Three failures: a window
  named with nothing open, the wrong window named, and the right one dropped. `job.restoration` held
  the truth one function away and was not being passed. Both halves are now pinned by a test that
  fails if either is trusted alone.
- **A renamed capability carried the name the model gave it.** The block whose whole job is matching
  the person's words to a collection used `spec.label`; the person types `display_label_override`.
  Pre-existing in the collections list, and propagated into the new block. No fixture could catch
  it, because `registeredSpecs` built specs a different way from the runtime — so that is fixed too,
  and a renamed-capability case now proves both.
- **The block read as a third collection.** A datum and two instructions shared a bullet list under
  a data heading, directly below a section where every `- ` line is a collection. The label is on
  the heading line now and the rules are with the rules.
- **An answer-rule test asserted a constant contained itself**, line wrap and all, and repeated an
  assertion two other tests in the file already made. Shortened to a distinctive fragment, and
  renamed to what it proves.
- **The absence proof looked in too few places and knew too few shapes.** It swept three words over
  five hand-picked files. It now names the prompt bar's whole inventory — so a control called
  anything at all fails it — and sweeps every stylesheet the desk serves and every module that draws
  the bar or a window. Both new classes are mutation-checked.
- **The comment justifying that sweep was false.** It placed the repo's `.pill` in the developer
  panel; it is in `design/`, which the desk never serves. In an absence proof a wrong premise is how
  the next person widens an exemption.
- **A test name claimed the question's words steered the read.** The scripted model asks for its
  statement whatever was typed; what the test proves is the platform's half, and it says so now.
- **No resolver fixture covered a question at all.** Three `data_query` fixtures now carry decision
  28's three cases, and the fixture shape admits a desk with nothing standing.
- **Two stale comments.** The turn's header claimed the collections block was the one part of a
  prompt no budget weighs; there are two, and a capability name's 48 characters bound the second.
- **A restated source literal** in the byte-identical prompt comparison. The test takes the window
  line away and compares, rather than naming where it would have been inserted.

**Recorded rather than fixed**

- **`intent_target_capability` is now populated for question rows** where it was always null. No
  consumer branches on it, and `carriedResolverMeasurement` still nulls a target naming nothing in
  the catalog. 6.6/04 measures this row and should know that "target set" no longer implies a build.
- **Three test helpers re-introduce `openCapability` as optional.** The production seam is still
  held by the compiler; this is a deliberate convenience so the eight suites that care pass it and
  the rest do not.

## Verification

`bun run test` (3058 passed, 0 failed), `bun run typecheck`, `bun run lint` clean.

Eleven mutations, each reverting one behaviour and each caught: the window block never rendered,
the intent's target dropped, the desk's fact trusted alone, the model's claim trusted alone, the
resolver rule removed, the answer rule removed, the rename ignored, a chip added to the prompt bar,
a control named nothing on any word list, and a pill styled in a quieter stylesheet.

### The live round-trip

Against the real model on the real desk — nine capabilities — through the prompt bar.

| Done | Seen |
| --- | --- |
| Opened Hiking trips, asked *"how many did I add this month?"* | *"You added one hiking trip this month."* — the loose words resolved to the open window, and the scope is the noun |
| Asked *"how many coffees have I tasted?"* with Hiking trips still open | *"You've tasted 22 coffees."* — about coffees, not about what was on screen |
| Put everything away, asked *"how many did I add this month?"* again | *"You added four things this month."* — the whole catalog, and four is what four collections hold |
| Read the prompt bar throughout | A notice slot, a field and a button. No chip, no badge, no capability named anywhere on it |

The first and third rows are the same sentence, and the two answers differ only in what the desk
had standing. That is decision 28, and both sentences say their own scope.
