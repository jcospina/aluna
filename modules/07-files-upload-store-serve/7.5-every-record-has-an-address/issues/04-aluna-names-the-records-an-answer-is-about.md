# Aluna names the records an answer is about

Status: done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.5 — Every record has an address
(PLAN decisions 45 to 47; ADR-0008, ADR-0010: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

The question loop can already read each record's `id`, but nothing asks for it and the
answer is one string. This issue has the model say which words in its answer name which
record. The platform checks each claim and sends the answer with those words linked.

**The turn asks for ids when they matter.** A rule in `question-turn-prompt.ts` says that
when a question asks about particular records rather than a figure, the statement
selects `id` beside the columns it names. A count, a total or a grouping does not.

**The answer schema nominates.** `questionAnswerSchema` becomes `{ answer, records }`.
`records` is a required array, possibly empty, of `{ says, id }`, with a small cap. Every
key is required, and the emitted JSON schema has no `oneOf`, `minLength` or optional
property (see `question-answer-material.test.ts`). The answer prompt tells the model to
nominate a record only when its answer is about that record, and never to write an id.

**The platform vouches.** A nomination survives only when four things hold. Its id came
back as a cell in a row some step returned. Exactly one capability that step read holds
a record with that id, checked inside the same read scope. That capability has a record
view. And `says` occurs in the answer outside another link. The platform links the first
free occurrence and drops every other nomination without a word. The four platform-written
endings carry no links.

**The prose never shows an id.** Before the answer is shown, the platform removes every
record id the steps returned from the spoken text.

**The fragment carries links.** `renderAnswerWindowSaying` writes escaped text runs and,
for each surviving nomination, `<a data-answer-record href="/capability/:id/:record">`
around the escaped `says`. A model-written `<a>` or `href` is still escaped text. Until
7.5/05 the client reads `textContent`, so the names show unlinked and nothing breaks.

## Acceptance criteria

- [x] Scripted providers show a listing question selecting `id`, and a counting question
      not selecting it
- [x] The answer schema is strict-mode safe, pinned by the existing schema test
- [x] Nominations with an id no step returned, an id in two capabilities, an id in a
      capability without `update`, a `says` missing from the answer, and a `says` inside
      another link are each dropped, and the answer is still spoken
- [x] No answer fragment contains a record id outside an `href`
- [x] A model answer containing `<a href=...>` reaches the client escaped
- [x] `intent_resolution_metrics` records no record id
- [x] No test calls the real provider
- [x] An adversarial pass on forged ids, prompt injection through row text, and ids hidden
      in prose is clean
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On `:3030`, with a capability holding several records, ask "which ones did I rate five?".
The answer reads the same as before, with no id in it. The network panel's last
`fragment` event shows each named record wrapped in a `data-answer-record` link.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/01-the-record-address-is-decided-and-drawn.md

## What landed

**The turn asks for ids when they matter.** `QUESTION_RECORD_ID_RULES` in
`question-turn-prompt.ts` asks a statement about particular records to select `id` beside the
columns it names, and leaves it named `id`. A count, a total or a grouping does not select it.

**The answer schema nominates.** `questionAnswerSchema` is `{ answer, records }`. `records` is a
required array of `{ says, id }`, both keys required. The cap is `MOST_ANSWER_RECORDS = 20`,
applied after parsing, so the emitted schema has no `maxItems`; names past it show unlinked.
`says` is cleaned the way the answer is, then trimmed. `QUESTION_ANSWER_RECORD_RULES` asks for a
nomination only when the answer is about that record, and never for an id in the prose.

**The platform vouches** (`src/runtime/query/records/`), inside the question's own scope, after
the answer is written:

1. The id must equal a whole cell of some step's rows, hyphenated or as its bare 32 digits.
2. Exactly one capability those steps read holds it. One read (`record-reads.ts`) asks the whole
   catalog which capabilities hold each id the steps returned.
3. That capability has a record view (`hasRecordView`: it declares `update`).
4. `says` occurs in the answer outside another link. The first free occurrence is linked,
   preferring one that does not cut a word.

One further check is the platform's own. A statement can return any id beside any name, so the
words must stand as whole words in a cell of a row that returned the id. That cell must also be
one of the stored record's own `string` or `choice` values, read from its capability in the same
scope. Names are compared shaped, in NFC, with a curly apostrophe read as straight, and in any
case. Longer names are placed first.

A nomination that fails any check is dropped without a word. If a check cannot be read, the answer
loses its links and is still spoken. A cancellation still ends the question.

**The prose never shows an id.** `answer-record-ids.ts` removes every id some capability holds.
A saved key or token that is no record's id stays speakable. The scan:

- reads hex digits through case, separators of any length, invisible and default-ignorable
  characters, NFKC forms (fullwidth, ligatures) and the common lookalikes (Cyrillic and Greek
  letters, ℮, o for 0, l for 1);
- cuts one id a pass and rescans, so an id hidden inside another is caught too.

`answer-id-cut.ts` closes the sentence up at the cut only. It removes:

- a bracket, quote or emphasis the id stood alone inside;
- a lead-in mark that pointed at it;
- a path it ended, from the path's first slash or scheme (a word before the slash stays);
- a Markdown link's address, keeping the link's name.

It then leaves one space, or none against a stop, an opener or a line's edge, and never glues
two words together. It never touches a word or a list marker. A 40,000-answer fuzz of random prose
and held ids left no id and lost no letter.

**The fragment carries links.** `renderAnswerWindowSaying(saying, links)` writes escaped text runs
and `<a data-answer-record href="/capability/:id/:record">` around each escaped name. The address
comes from `recordAddress`, and a link that is out of order or out of range is skipped. Only the
`answered` arm of `QuestionLoopResult` has `links`, so the four platform endings, and
could-not-finish, cannot carry one. The client still reads `textContent` until 7.5/05.

**Along the way:**

- Steps carry the capability ids they read (`capabilities`, beside `collections`).
- `shaped` makes the answer well-formed and NFC.
- `shaped` drops every bidi control, so nothing shows characters in an order other than the one
  they were checked in. It keeps the two joiners, which an emoji or a Persian word needs.
- The answer body is `unicode-bidi: plaintext; text-align: start` (`public/css/shell.css`). Each
  line reads in its own direction, so an Arabic answer reads right to left.

## Findings

- **Spec and standards review (Opus), 17 items.** All addressed:
  - stripping only real record ids;
  - tidy-up at the cut only;
  - a test pinning copy;
  - dead `AN_ADDRESSABLE_ID`;
  - shared `SAYS_SOMETHING` and `shaped`;
  - `says` trimmed and well-formed;
  - a failed check read keeps the answer;
  - prompt wording ("name" meaning two things, `id AS id` against the naming rule);
  - `answered` given its own result arm;
  - test nits.
- **Adversarial round 1 (Opus), 12 findings, all fixed:**
  - removing one id rebuilt another;
  - invisible characters between digits;
  - tidy-up rebuilding an id;
  - fullwidth digits;
  - non-record UUIDs cut from prose;
  - whole-answer tidy rewriting unrelated text;
  - bare 32-digit ids;
  - a link opening a record other than the one its words name;
  - lone surrogates in `says`;
  - about 430 ms of main-thread work with about 1,800 ids, now about 1 ms;
  - a read failure losing the answer;
  - the renderer trusting link order.
- **Adversarial round 2 (Opus), 6 findings, all fixed:**
  - a quadratic id scan on an oversized `says`;
  - a join linking "Milk" to "Milk run";
  - lookalike letters and RLO-reversed digits;
  - dangling punctuation after a cut;
  - the id list bound once per capability;
  - locale-dependent lower-casing.
- **Adversarial round 3 (Opus), 13 findings, all fixed:**
  - stale spans after a path cut deleting prose (HIGH);
  - straight quotes pairing across names;
  - list markers eaten;
  - a word before a slash taken as a path;
  - a short name taking the start of a longer one;
  - joiners stripped from answers;
  - CJK and Markdown pair marks left behind;
  - a space left before a closing quote or apostrophe;
  - combining marks at a link's edge;
  - NFD and apostrophe mismatches;
  - a shortened han name refused;
  - RTL answers drawn left to right;
  - lone surrogates fusing across a cut.
- **Adversarial round 4 (Opus), 7 findings, all fixed.** A 40,000-answer fuzz then found no id left
  and no letter lost:
  - a slash cut gluing words;
  - the path walk eating a name before the path;
  - a removed bracket or quote pair gluing words;
  - Markdown link brackets left behind;
  - `dir="auto"` turning every line of a mixed answer (replaced by per-line `plaintext`);
  - kept bidi marks showing digits in an order the scan never checked;
  - a combining mark left after an id.
- **Choices recorded.** No document names the number, so the cap is 20 ("a small cap"). The
  platform's own name-to-record check goes beyond ADR-0010's four checks, and it only ever drops
  links. A han, kana or Thai name may link a part of itself, because those scripts set no spaces
  to mark a word.

## Verification

- `bun run test`: 4864 tests, all green. One earlier run had a single failure under load that did
  not reproduce on the next run. `bun run typecheck` and `bun run lint` are clean.
- Each new guard was mutated by hand: removed or weakened, one at a time. Each mutant failed at
  least one test:
  - the four checks;
  - the record tie;
  - longest-first placement;
  - the unspaced-script exemption;
  - combining marks;
  - name folding;
  - `toWellFormed`;
  - the single-pass id check (a 1,500-layer onion of a held id);
  - the comma lead-in rule;
  - the onward cut;
  - the word-glue rule;
  - the path's first slash;
  - the Markdown unwrap;
  - an id's trailing marks.
- No test calls the real provider. Every run is scripted: `scriptedProviderSaying`, or
  `makeQuestionProvider` over the real prompt path.
- **Live on `:3030`.** Two real questions on the Tea tasting journal (22 records):
  - "which teas did I rate four or five?", before the review rounds. The answer listed all seven
    teas, with no id in the text. The last `fragment` wrapped each name in
    `<a data-answer-record href="/capability/tea_tasting_journal/<id>">`.
  - "which teas from Fujian did I rate three or more?", on the final code. Four teas came back,
    each linked, and every id matched that tea's record in the database.
  - Neither job's `intent_resolution_metrics` row holds a record id.

