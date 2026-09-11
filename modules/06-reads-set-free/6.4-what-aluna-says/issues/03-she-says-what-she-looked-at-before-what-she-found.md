# Aluna says what she looked at before she says what she found

Status: done, then reversed

> **The `/demo/question` exercise this issue names came down in 6.5/05.** What it proved about
> the loop is proved without it; the references to it below are the record of how this issue was
> verified while the module was still headless.

**Reversed 2026-09-11 by the owner.** What this issue built shipped and was read on a real
desk, and the reading rejected it: naming what she looked at in front of every answer made
every answer arrive in the same shape, and the owner's words were that it *"reads awful and
unnatural"*. The two fields are gone; the answer is one generated sentence and there is no
restatement. Everything below describes what was built, not what runs — the schema, the join,
the order check and the acceptance criteria are all superseded. ADR-0008's amendment of the
same date carries the decision and what it costs; the answer lives in
`src/runtime/query/question-answer.ts` and is proved in `question-answer-material.test.ts`.

Type: HITL — the answer is authored product voice and it is the sentence the whole
module exists to produce. Implementation is fully specified and agent-ready; a
human reads real answers before sign-off.

## Epic

Module 6 — Reads Set Free · Epic 6.4 — What Aluna says
(PLAN decision 16; decision 3's no-table rule belongs to epic 6.5 and constrains
the shape of the answer built here; ADR-0001's product voice:
`modules/06-reads-set-free/PLAN.md`)

## What to build

The answer states what she looked at before it states what she found — not the
SQL, its meaning: *"looking at your expenses from last month, under groceries…"*.

**This is the receipt.** Deleting the table (decision 3) deleted the user's way of
checking her work, and the restatement is the honest replacement — a better one,
because it shows what she **decided** rather than what she retrieved. A user who
reads "under groceries" and calls those Food catches the mistake instantly, and
correcting her costs nothing, because the whole answer is disposable and the same
question asked again runs again.

**It carries the scope at no extra cost.** Decision 29 asks for scope in ordinary
English rather than as a chip or a badge, and a sentence that already says what
she looked at has said it. 6.6/01 proves that case; this issue is what makes it
free.

**The answer is prose in Aluna's voice, with bullets where a sentence would be a
list** (decision 3). There is no table, no chart, no export and no column header
anywhere on this path — a one-cell table with a `count(*)` header is a spreadsheet
apologising for itself, and §9.7's *friendly app, never an engineering tool*
forbids it.

**The restatement is meaning, never machinery.** It names the capability and the
values in the user's own words. It never contains a table name, a column, an
operator or a step count — the same rule 6.3/04 holds the narration to, held here
for the answer.

## Acceptance criteria

- [x] Every answer states what was looked at — which capability and which values —
      before it states what was found
- [x] The restatement uses the user's words for their data, and contains no table
      name, column, SQL fragment, operator or step count
- [x] The answer renders as prose, with bullets only where a sentence would be a
      list; no table, chart, export or column header exists on this path
- [x] A wrong restatement is visible in the sentence itself — proved by a fixture
      where the model picks the wrong categories and the answer says which it used
- [x] Asking the same question twice produces two answers and reuses nothing
- [ ] **Sign-off gate:** the human has read real answers to at least a count, a
      total and a cross-capability question, and confirms they read as speech
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## What landed

**The order is a code check, not a request.** `questionAnswerSchema` went from one
`answer` string to two fields — `looked_at` and `found` — and
`questionAnswerSentence` joins them in that order and no other
(`src/runtime/query/question-answer.ts`). There is no field for a finding on its
own, so an answer with no restatement does not parse. A finding that is itself a
list is introduced with a colon and a line break rather than spliced onto the
clause above it, which is how decision 3's bullets and decision 16's comma both
hold. Both halves are trimmed of the punctuation the join supplies, and a finding
that did not stop itself is stopped.

**The restatement is written from what the statement actually reached for.**
`assertScopedQuery` now hands back the capability tables its `EXPLAIN` names
(`src/runtime/data/access/query-runtime.ts`), `assertWholeCatalogQuery` maps those
to capabilities (`src/runtime/query/whole-catalog-query-scope.ts`), and a
`QuestionStep` carries them as `collections` — the *canonical* label,
`display_label_override ?? label`, so a renamed capability is named the way the
person renamed it. The answer's prompt renders them inside the step's fence as
`in:`, beside the values it narrowed to as `under:`.

**The labels the prompt uses are words the answer may say.** They were `went
through:` and `matched:` for one live run, and a live answer came back saying it
had *gone through* and *matched your words*. Naming the act gets the act repeated
back, so they name the thing instead, and `under` is decision 16's own phrasing.

**The turn asks for column names.** The whole-catalog worker projects no result
descriptor, so an unaliased `count(*)` comes back keyed `count(*)` and rides into
the answer's prompt — the one operator that can get near a sentence a person
reads. `QUESTION_NAMING_RULES` asks for `AS` in the person's words.

**The developer page shows what the statement named**, beside the statement, so a
human at this gate can check a restatement against what actually ran.

## Findings

Every finding from the adversarial and standards passes is fixed except where
recorded below as accepted or handed on.

**Fixed**

- The restatement used `spec.label` — the name the *model* gave a capability —
  where `display_label_override` holds the name the person chose. Reproduced on
  the live desk: "Coffee tasting diary" had been renamed to "Coffee tasting" and
  the answer used the old name. Now `canonicalCapabilityLabel`, the one display
  path the rename contract names.
- The comma join spliced a bulleted finding onto the clause above it.
- The punctuation strip missed the ellipsis decision 16's own worked example ends
  on, and `found` had no leading-punctuation check.
- The schema read and the plan were not in one snapshot, so a committing `CREATE`
  could stale the rootpage map — which used to mis-*bound* and would now mis-*name*
  a collection in a sentence a person reads. Both are under `withReadSnapshot`.
- The frame-size test measured a claim it could not see: it now compares a light
  and a heavy run byte for byte, and a second test names the growth that is real —
  the collection line grows with the desk, the way the turn's collections block
  does, against the spec gate rather than against a budget.
- Rules that sent *every* figure to `found` when a threshold is a value the
  restatement has to name; rules that never said who she was speaking to; a rule
  set that named no shape for `found` to open in.
- Tests that restated the join separator, the rule text, and a source constant.

**Accepted, and why**

- **The plan names what a statement *may* read.** A `CASE` whose branch the
  parameters never take is still named, because `OpenRead` is a compile-time fact.
  Over-naming is what makes the same enumeration sound as a table bound, and what
  it reports is what she reached for — which is the decision the receipt is about.
- **The order collections are named in is the scope's, not the plan's.** Neither
  order means anything; an unstable one would look like it did.
- **The sentence is still the model's.** The platform decides the order, supplies
  the material, and can prove both. Nothing makes the model *use* the material —
  a model writing the question's own word instead of the data's would hide a
  mis-scope. That is what the sign-off gate is for, and it cannot be closed here.
- **Two worked restatements are in the rules**, so live answers will lean on their
  two openings. A closed shape was worth the bias; worth watching at the gate.
- **A cost, not a defect:** `deriveCapabilityTableDdl` re-parses a spec to recover
  `cap_${id}`, so the table-name derivation now runs twice per statement. Left
  alone rather than restructured around a formula the repo derives in one place.

**Handed on**

- **A choice field's stored value reaches the answer, not its label.** A live
  answer said `medium_dark` where the person's word is *Medium-dark*. It reaches
  the sentence through returned rows as well as through bound values, so a fix
  spans more than the restatement, and the vocabulary that maps value to label is
  6.4/01's. Wants its own issue.
- **The no-rows ending.** When nothing came back, the prompt carries no `in:` line
  and `looked_at` is still required, so only a rule stands between her and a
  restatement written out of the question's own words. The ending itself is
  6.4/04's, and the deterministic classification it asks for is what closes this.

## Verification

`bun run test` (2874 passed, 0 failed), `bun run typecheck`, `bun run lint` clean.

Live, against the running desk through 6.3/01's developer-gated turn — a count, an
aggregate, a cross-capability question and the mis-scoping case:

- *"Of your Houseplants, you have 22 houseplants."*
- *"Looking at your Coffee tasting, your average coffee rating is 3.89."*
- *"Looking at your Coffee tasting diary and Tea tasting journal, you tasted 22
  coffees and 22 teas, and no origins show up in both."*
- *"Looking at your Freelance invoices and Hiking trips, under paid, cancelled,
  refunded, voided, written_off, and hard, you have 10 finished invoices and 5
  hard hikes."*

The last is decision 16 working: she decided that *finished with* means five of
the twelve stages her invoices carry, and the sentence says which five.

## Living demo

Headless; exercise through 6.3/01's developer-gated turn until 6.5 gives it a
surface. Ask *"how much did I spend on groceries?"* against expenses whose
categories are food, cheese and vegetables, and read the answer: it should say
which categories it counted before it says the number. Then correct it and ask
again.

## Blocked by

- modules/06-reads-set-free/6.4-what-aluna-says/issues/02-sql-computes-and-the-model-only-finds-the-words.md
