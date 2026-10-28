# Doc claims to review

The code contradicts each statement below in `docs/architecture.md`. They were
found on 2026-10-26, when the claims the architecture deck had taken from the doc
were checked against `src/` and `public/`. Only those claims were checked, so the
rest of the doc has not been compared with the code. Line numbers refer to the
working-tree doc on that date.

Each entry quotes the doc, says what the code does, and suggests new wording. The
suggestions are drafts, and each needs a pass against `docs/prose-guidance.md`
before it goes in.

## Wrong about what the system does

### 1. Stored values do get rewritten (lines 688-691)

> No stored value is ever rewritten. ... bringing it back restores the values.

Each evolution's activation wakes the relations that hold again
(`src/builder/commit/commit.ts:112`, `133-145`;
`src/runtime/data/links/relation-diff/relation-diff.ts:138-165`, `225-227`). A
woken relation runs an UPDATE that writes its target's current text into the
linked field (`src/runtime/data/links/linked-text.ts:76-97`, `177-190`). While a
relation sleeps, edits to its target do not reach the field
(`linked-text.ts:159`). So a hidden linked field that comes back holds the
author's new name, not its old value, and an evolution of Authors can rewrite
values stored in Books.

Suggested wording: "An evolution writes no new values, except that a relation it
wakes rewrites its linked field to the target's current text."

### 2. Nothing changes a field's type (lines 691-692)

> To change a field's type, an evolution hides the field and adds a new one.

No code path does this. The evolution prompt forbids a type change
(`src/builder/evolution/candidate/candidate-spec-gen.ts:84`), the Resolver says
"Existing field types never change in place"
(`src/pipeline/intent/resolver.ts:162`), and validation refuses one. No prompt
tells the model to hide the field and add a new one, and a new field starts
empty.

Suggested wording: "A field's type never changes. A user can hide the field and
add a new one, which starts empty."

### 3. Linked read tokens are not all or none (line 919, and the list at 545-548)

> Each request takes a read token from every read gate it needs, all or none

A request's own token set is taken all or none
(`src/runtime/concurrency/read-gates.ts:210-236`). A request takes tokens on
linked capabilities one at a time, and skips any it cannot get. Three paths do
this:

- an edit's or a deletion's refresh
  (`src/runtime/router/admission/linking-tokens.ts:26-56`);
- a search that walks through links
  (`src/runtime/router/dispatch/search/link-walk.ts:1-4`, `158-171`);
- a record view's list of the records that link to it
  (`src/runtime/router/dispatch/address/records-linking-here.ts:145-166`).

The list at lines 545-548 names update, delete and search, and leaves out the
record view. No lead pointed at the record view; the check found it while
reading this section.

Suggested wording: "A request's own tokens are all or none. Tokens on linked
capabilities, taken by an edit, a deletion, a search or a record view, are taken
one at a time, and one that cannot be taken is skipped."

### 4. Linking fails open (line 123)

> When any step fails, nothing goes live and whatever was live stays.

The link step "Never rejects" (`src/pipeline/build/linking.ts:38`). A relation
wake or relation write that fails is logged and skipped, and the activation
commits anyway (`src/builder/link/link-relations.ts:45-58`). Units and Gate
rungs also get repairs before a failure counts.

Suggested wording: "When a step still fails after its repairs, nothing goes live
and whatever was live stays. Linking alone fails open."

## Broader than the code

### 5. Length limits and retired options select tests (line 686)

> capability label, nouns, input modes, hints, length limits, retired choice options | none: platform work only

A change to a length limit or a retired choice option selects the create and
update test suites (`src/builder/evolution/diff/diff-engine.ts:528-534`,
`545-550`, `605-608`). Both values feed those suites' digest
(`src/builder/gate/rungs/behavioral/freeze/behavioral-test-inputs.ts:44-49`), so
with the behavioral tier on the model regenerates them.

Suggested wording: keep "none" for the other rows. For length limits and retired
options, add "and, with the behavioral tier on, the create and update test
suites".

### 6. A Handler can read the record's id (line 559)

> A Handler never holds the id of the record it changes

`query.records` allows the `id` column
(`src/runtime/data/access/query-runtime.ts:55`), and its `values` carry any
declared alias (`78-82`), so a Handler can SELECT the id. The markup `present()`
returns also carries it (`src/presentation/records/adapter.ts:157`, `164-174`).
The true part: no input or port hands the Handler the id, and it cannot choose
the record it writes.

Suggested wording: "A Handler is never handed the id and cannot choose the record
it writes: update and delete get a mutation port already bound to that record."

### 7. Some later changes are controls (line 42)

> Every later change is typed the same way.

Renaming, linking from a form and deleting are controls with their own routes:
`/capability-rename/:id` (`src/lifecycle/rename/http.ts:24`),
`/capability-link/...` (`src/lifecycle/link/http.ts:64-67`) and
`/capability-deletion/:id/confirm` (`src/server/app.ts:550`). The doc's sections
on renaming, linking and deletion describe them as controls.

Suggested wording: "Most later changes are typed the same way. Renaming, linking
from a form and deleting are controls."

### 8. Some presentation requests are accepted (lines 67-68)

> How a capability looks is the platform's decision, and a request to restyle one is refused.

A `ui_change` covers feed or grid layout, card direction, and which fields a card
shows and in what order (`src/pipeline/intent/resolver.ts:163`). The Resolver
rejects colour, size, spacing, position, type and other art direction
(`resolver.ts:165`). Section 4.2 (line 235) gives the exact list.

Suggested wording: "A request about colour, size, spacing or typography is
refused. Layout, card fields and card direction are a `ui_change`."

### 9. Only some named books are linked (lines 43-44)

> with each book the answer names linked to its record

The answer keeps only the first 20 nominations, and a name past them shows
unlinked (`src/runtime/query/endings/question-answer.ts:201-205`, `219`). A
nomination that fails a check is dropped silently
(`src/runtime/query/records/answer-records.ts:1-4`).

Suggested wording: "with up to 20 of the books it names linked to their records,
when the checks hold".

### 10. Card styles are not limited to tokens (lines 617-619)

> The design contract lets card markup style itself only with the shared design tokens, on three axes (colour, type size and spacing)

On those three axes a value may also be a structural zero or a keyword such as
`auto`, `inherit` or `transparent`. A property outside them, such as width, is
free once it clears the bans
(`src/presentation/safety/enforcer/style-discipline.ts:220-227`, `305-311`).

Suggested wording: "On colour, type size and spacing a value must be a token,
zero or a keyword. Other properties, such as width, are free unless banned."

### 11. The enforcer does not remove everything off the contract (line 607, and line 372)

> Enforcer removes anything outside the contract

The enforcer drops what is off its allow-lists. A named colour inside a mixed
shorthand gets past it
(`src/builder/gate/rungs/design-lint/inline-style-scan.ts:13-14`), and the
file-kind and document-label rules exist only in design lint
(`src/builder/gate/rungs/design-lint/gate-design-lint.ts:313-314`). The table at
line 372 makes the same claim with "markup outside the design contract".

Suggested wording: "Enforcer removes what is off its allow-lists" in the
flowchart, and "most off-contract markup" in the table.

### 12. A question keeps a metrics row (line 798, and line 197)

> A `data_query` builds nothing and keeps nothing.

A question writes one `intent_resolution_metrics` row
(`src/pipeline/query/question-pipeline.ts:125-129`;
`src/platform/metrics/intent-resolution-store.ts:76-91`). Line 864 of the doc
says so, and line 197 of the flowchart says "nothing stored".

Suggested wording: "builds nothing and keeps nothing of what it read or said,
only one metrics row".

## Small precision errors

### 13. `fragment` also places the build's tile (line 172, and lines 483-486)

> `fragment` (HTML for the window or the prompt bar)

An admitted build stands a provisional tile on the desk through `fragment`
before the build runs (`src/pipeline/build/prompt-pipeline.ts:228-229`). The
tile takes its name once the spec exists (`src/pipeline/build/build-run.ts:255`),
and the desk takes it down when the stream ends
(`public/desk/logos/desk-logos.js:3-6`). The `commit` event then stands the
capability's own tile, which lines 483-486 describe.

Suggested wording: add "or the desk's provisional tile" to the `fragment` gloss,
and say in lines 483-486 that a provisional tile stands while the build runs.

### 14. A create can answer 500 or 404 (line 537)

> 200, or 422 with the message for the field

A Handler error rolls back and answers 500 with a general message, and a missing
record answers 404 (`src/runtime/router/wire/failure-responses.ts:331-334`,
`341-348`).

Suggested wording: "200; 422 with the field's message for a refusal; 500 with a
general message for an error".

### 15. The deflection match is looser than exact (lines 222-223)

> when what remains is exactly the id or label of one existing capability

The match ignores word order, folds plurals so that "book" matches Books, and
also matches a renamed label
(`src/pipeline/build/admission/deflection.ts:70-91`;
`src/pipeline/build/admission/word-forms.ts:10-16`).

Suggested wording: "when what remains is the same words, singular or plural, as
one capability's id, label or new name".

### 16. File contents need only match the extension's family (line 373)

> contents that do not match the extension

The extension names a family, and the bytes may pick any row of it, so "a PNG
called `.jpg` is recorded as the PNG it is"
(`src/platform/files/admission/admission.ts:1-2`).

Suggested wording: "contents that do not match the extension's family".

### 17. A page load schedules a retry instead of running one (lines 985-986)

> A failed cleanup retries after 1, 5 and 30 seconds, and again on the next page load or boot.

A page load calls `forceRetry` (`src/server/app.ts:391`), which schedules the
pass after the delay for the attempts so far. For a deletion past its three
retries, that is 30 seconds after the load
(`src/lifecycle/deletion/destruction/cleanup-supervisor.ts:142-156`). Boot runs
one at once.

Suggested wording: "a page load schedules another retry, and boot runs one at
once".

### 18. The UUID is minted before the savepoint (lines 560-563)

> ...mints the record's UUID, claims uploaded files and writes link rows, all inside a savepoint.

On a create, the field filter, normalization, required check and UUID minting run
before the savepoint opens. Only the file claims, link rows and INSERT run inside
it (`src/runtime/data/access/mutation.ts:130-140`). Nothing is written outside
the savepoint, so behaviour is unaffected.

Suggested wording: "...normalizes each value, checks required fields and mints
the record's UUID, then claims uploaded files, writes link rows and inserts the
record inside a savepoint."

## Leads dropped after checking the code

- "reporting every violation of the second kind at once" (line 643): each field
  reports only its first dropped choice value, but any violation ends the run, so
  no behaviour depends on the count.
- "never chooses a field type" (line 62): no surface asks the user to choose one.
  Whether a typed request steers the model's choice is untested.
- The router's "reads and writes" edge (line 106) points at a node that merges
  the registry and the data tables. The router writes the data tables and only
  reads the registry, so the edge holds for the merged node.
- "every model call a structured-output call" (line 158): every language-model
  call goes through `streamObject`, and Recraft has its own row.
