# The model is shown the vocabulary of the data, and no semantic index is built

Status: done

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decisions 18, 19; ADR-0008: `modules/06-reads-set-free/PLAN.md`)

## What to build

The loop is given the vocabulary of the user's data — what their values are
actually called — so it can write SQL that matches them. This is what lets *"how
much did I spend on groceries?"* find categories called food, cheese and
vegetables.

**`choice` fields declare their options in the registry already**
(`src/registry/fields/choice.ts`), so that vocabulary costs nothing and is
supplied as part of what the loop knows about the catalog before its first step.

**Small categorical string fields are enumerated by a bounded distinct read**,
which is one of the loop's ordinary steps rather than a new mechanism — the
`looking at what things are called` label 6.3/04 ships exists for exactly this
step. Bounded is the operative word: it is subject to 6.3/03's size cap like any
other step, and a field whose distinct set is not small refuses and the model
narrows.

**This is one person's app.** An expenses capability has perhaps fifteen
categories, ever, and the entire vocabulary of the user's data fits in a few
hundred tokens.

**Semantic storage is declined** (decision 19), and the decline is the deliverable
half of it. No embeddings, no vector index, no full-text index — the model already
knows "mother", "mum" and "mom" are one idea, and free reads exist so it can put
that knowledge into the query. An embedding would make this a write feature
wearing a read costume: computed on every save, recomputed on every edit, deleted
on every delete, rebuilt on evolution and swept on capability deletion through the
incarnation and tombstone machinery — a fourth derived artifact beside the
Handler, the renderer and the tests, with its own version key, its own lifecycle
recovery, its own coordinator traffic, and an AI call on the write path where the
speed thesis lives. If the cheap version proves insufficient in use, semantic
storage earns its own ADR and its own module; it does not arrive as an
implementation detail of this issue.

## Acceptance criteria

- [x] The loop knows the active catalog's shape and its `choice` fields' declared
      options before its first step, read from the registry rather than by query
- [x] A small categorical string field's values can be enumerated as an ordinary
      bounded loop step, under the same size cap as any other step
- [x] A question whose wording does not match the stored values can still be
      answered by looking first — proved by a fixture where the asked word appears
      in no record
- [x] Nothing is precomputed, stored or cached to support this: no embedding
      column, no vector or full-text index, no derived artifact, no write path
      touched
- [x] A test proves the write path gained no AI call and the artifact set gained
      no member
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless; exercise through 6.3/01's developer-gated turn. Build Expenses, give the
records categories that do not literally read "groceries" — food, cheese,
vegetables — and drive a question about groceries. Watch the loop look at what
things are called before it totals anything. This is the plan's living-demo step 3
arriving early, without a surface.

## Blocked by

- modules/06-reads-set-free/6.3-the-loop/issues/04-every-step-carries-a-label-and-the-platform-owns-the-sentence.md

## Comments

**2026-09-04 — the catalog's *shape* already reaches the model; the *values* are still
yours.** 6.3/01's turn cannot write SQL without table and column names, so
`buildQuestionTurnPrompt` in `src/runtime/query/question-turn.ts` already supplies every
collection's table, its `id` and `created_at`, and its active fields with their types. It
stops exactly there: it does not emit a `choice` field's declared options, and there is no
bounded distinct read. This issue's first acceptance criterion is therefore half-met on
arrival — extend `formatCollection` rather than rebuilding the supply, and treat the shape
half as existing coverage rather than as duplicated work.

## Notes from 6.3/03

The vocabulary read is subject to **two** caps now, not one: the per-step payload cap
and the budget a whole question accumulates against. A vocabulary read spends question
budget that the later aggregate steps need, which is an argument for asking for
`DISTINCT` values rather than rows.

## What landed

**A `choice` field says what it holds, in the catalog block, before the first read.**
`formatCollection` in `src/runtime/query/question-turn.ts` gained one line per choice field —
`one of: food (Food); cheese; vegetables (Greens)` — read off the spec the registry already
stored, so no statement runs to produce it. An option labelled as it is stored is spelled once.
A disabled option is listed like any other: it can no longer be arrived at, but a row written
before it was retired is still data a question has to find. Options are parted by a semicolon
because a comma is ordinary inside a label and would read as a second option.

**Every other field is left to the data to say.** Two rules joined the prompt, exported as
`QUESTION_VOCABULARY_RULES`: only a choice field lists its values, and another field's values
are read from the data before the question's words are matched against them. That read is an
ordinary step and not a new mechanism — 6.3/04's `naming` label, 6.3/03's cap — so a field whose
distinct set is not small comes back refused with `QUESTION_STEP_RESULT_TOO_LARGE` like any other
over-size step, and the model narrows.

**Decision 19's decline is the other half of the work, and it is pinned by absence.**
`src/runtime/query/question-vocabulary.test.ts` sweeps the desk before and after a whole
vocabulary loop — objects, row counts, content digests, files beside it — proves no module the
router, the data ports or the mutation coordinator holds imports a provider, and holds the
derived-artifact inventory to the item renderer and one Handler per Action. No embedding, no
vector or full-text index, no fourth artifact, no AI call on the write path.

**`questionDesk` took a catalog builder, and `registerCapability` was exported beside it.** The
suite needs a desk whose rows never say "groceries", which `catalogueWithRecords` cannot be, so
the catalog is a parameter rather than a second copy of the desk.

## Findings

Every one fixed; the adversarial and standards rounds ran before the live test.

- **A capability label admitted a literal newline**, and `\s+` swallowed it in the word count, so
  a two-line name passed every other rule and reached this issue's catalog block as a second
  `table:` line under one collection. Pre-existing, and this is the block that made it matter.
  Refused now in `public/capability-name.js`, where the editor and the registry read one rule, and
  pinned in the name corpus.
- **A choice option's value or label admitted U+2028 and U+2029.** `\p{Cc}` covers C0 and C1 and
  neither separator is in them, and most tokenizers break a line on one — so an option could forge
  a column line. `printableText` now refuses `Cc`, `Cf`, `Zl` and `Zp`, and `PRINTABLE_MESSAGE` is
  exported so the suite pins the rule rather than a copy of its wording.
- **The write-path scan did not cover the write path.** It named the data ports and the coordinator
  and skipped `src/runtime/router`, which every record write is admitted and dispatched through. It
  also read static imports only, so a lazy `import()` was invisible. Both closed.
- **The rule said "a string field" and restated the `naming` label's own hint.** `date`, `datetime`
  and `string[]` are all TEXT too. Trimmed to two lines that say where a vocabulary is, not what a
  naming step is.
- **`one row is a expense`.** Article agreement, in every collection heading the prompt has ever
  built.
- **`executed() === 0` proved nothing on its own** — it counts reads through the worker, not a
  query somewhere else. The proof is now two option labels stored in no row: no statement could
  have produced them.
- **A test restated prompt copy**, so rewording a rule would have reddened the suite. The rules are
  a named export now, the way `QUESTION_TURN_PROMPT_PREFIX` already was.
- **The distinct read depended on unspecified SQLite row order**, and **the store sweep walked the
  shared artifact roots inside its own window** — a cross-shard flake. Ordered, and narrowed to
  what sits beside the desk; `question-turn.test.ts` still sweeps the roots around a read.
- **The collections block is the one part of a prompt neither byte budget weighs**, and this change
  makes it the largest part of it. Recorded in `question-turn.ts`'s header rather than capped: what
  bounds it is the spec gate, and a second cap here is not this issue's to invent.

## Verification

- `bun run test` — 2833 passed, 0 failed; `bun run typecheck` and `bun run lint` clean.
- The vocabulary suite runs against the real worker and the real database file. The choice half is
  proved by a prompt built before any statement ran, carrying two labels that appear in no row. The
  over-size case is a real read of 600 distinct values, refused by 6.3/03's step cap rather than by
  a cap this issue invented. The word "groceries" appears in no row of the fixture, asserted before
  the loop starts, and the total still comes back off the three categories the naming step found.
- **Live, on the real desk and the real provider, through `/demo/question`.** *"How many places
  turned me down?"* ran one step and no naming read: `WHERE status = ?` bound to `rejected`, which
  the question never says and the registry supplied — 11, correct. *"How many African coffees have
  I tasted?"* ran `SELECT DISTINCT origin` first, labelled `naming`, then counted with Burundi,
  Ethiopia, Kenya and Rwanda bound as parameters — 6, correct, and the word "Africa" appears in no
  record of that capability.
