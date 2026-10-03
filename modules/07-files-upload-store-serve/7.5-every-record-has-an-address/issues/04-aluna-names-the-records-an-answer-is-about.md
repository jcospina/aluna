# Aluna names the records an answer is about

Status: ready-for-agent

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

- [ ] Scripted providers show a listing question selecting `id`, and a counting question
      not selecting it
- [ ] The answer schema is strict-mode safe, pinned by the existing schema test
- [ ] Nominations with an id no step returned, an id in two capabilities, an id in a
      capability without `update`, a `says` missing from the answer, and a `says` inside
      another link are each dropped, and the answer is still spoken
- [ ] No answer fragment contains a record id outside an `href`
- [ ] A model answer containing `<a href=...>` reaches the client escaped
- [ ] `intent_resolution_metrics` records no record id
- [ ] No test calls the real provider
- [ ] An adversarial pass on forged ids, prompt injection through row text, and ids hidden
      in prose is clean
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On `:3030`, with a capability holding several records, ask "which ones did I rate five?".
The answer reads the same as before, with no id in it. The network panel's last
`fragment` event shows each named record wrapped in a `data-answer-record` link.

## Blocked by

- modules/07-files-upload-store-serve/7.5-every-record-has-an-address/issues/01-the-record-address-is-decided-and-drawn.md
