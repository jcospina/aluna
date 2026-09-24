# "Keep track of my photos" builds Photos

Status: done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decisions 28, 36, 38 and 39, and the epic's builder bullet; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

The builder learns to declare a photo field, and the Gate learns to test one. After this
issue, "keep track of my photos" typed into the prompt bar builds a capability with a
`file` field that accepts `image`. The form keeps 7.1/03's stand-in until 7.1/08 brings
the picker, so a record saves with its photo empty in the meantime. The form looks
unfinished until then, and the Living demo below says so.

**Generation offers `file`.** Spec and candidate generation may declare a `file` field
with `accepts: ["image"]` when a capability holds pictures. The generator prompt says
when to choose one, and that a file field is not searchable: a capability that wants to
find its photos by words also gets a title field. 7.1/03's refusal of generated `file`
fields is lifted here.

**The photo example becomes a real file field.** The `photo_grid_tile` few-shot example
declares an `image_url` string today. It becomes a `file` field, and its template reads
the projection's `url` and draws a no-photo state when the field is `null`. `.media-frame`
then frames a real field type.

**The Gate uses scratch references and never bytes.** The Gate mints references in its
scratch database's own ledger, for a field with a file and a field with none. Their names
contain markup, a bidirectional override, emoji and exactly 255 bytes. The empty field is
the case a generated template most often forgets. Admission, storage and serving are
platform code with their own tests, as routing is.

**A behavioral test names a file by token.** The model cannot mint a pending reference,
so a file input in a behavioral test is a closed token: `image`, or `null` for none. The
shape is required-nullable. A `discriminatedUnion` is not allowed, because it emits a
`oneOf` that OpenAI's strict mode rejects. The harness turns each token into a scratch
reference. Rows compare by `kind` and `name` and never by key. The behavioral input
digest covers the new shape.

**The smoke rung enforces "not searchable".** Its non-text exclusions gain a file case,
so a generated search that reads a file field fails the Gate.

**The HTML filter adds the image attributes.** An `<img>` whose source is a `/files/`
address gets `loading="lazy"` and `decoding="async"` from the platform filter, so a
generated template cannot forget them.

**What 7.1/03 left here.** Every Gate-side sample, fixture and probe gives a file field
`null`. `formSubmitsField` in `builder/gate/gate-internal.ts` keeps the field out of what the
smoke and the behavioral rung submit, as the stand-in does. With only `null` in hand,
several checks cannot bite on a file field yet:

- the search exclusion in `gate-smoke-search.ts`
- the merge-preservation check for a hidden file field in `gate-smoke.ts`
- the hostile design-lint probes, and the contrast probe design lint skips for a shown
  file field, because `null` against `null` cannot move
- `fieldValueMatches` in `gate-internal.ts`, which compares with `===`
- `gate-behavioral-input.ts`, which treats a file input as a scalar string

What 7.1/04 landed for this issue. The create port in `runtime/data/access/mutation.ts`
writes a file field only from a `FileSubmissionBinding`, the router-checked pending rows, and a
Handler may hand back just the projection it was given, or leave the field out. A port built
without a binding, as every Gate port is today, writes every file field empty and refuses a
projection. The Gate's scratch pair (`openScratchDatabasePair` in `builder/gate/gate-internal.ts`)
runs no platform migrations, so it has no `file_ledger`. The scratch ledger needs that table,
then `resolveSubmittedFiles` and a binding, as `runtime/router/dispatch/handler-invocation.ts`
does. `normalizeFieldValue` in `runtime/data/tool.ts` still refuses a file value outright, so a
behavioral setup row must go through the port. The contract a generated unit is compiled
against (`handlerContractDeclarations` in `builder/generated-code-check.ts`) and the Handler
prompt's input lines already carry the projection for a spec with an active file field, on
update as on create since 7.1/05. The update port writes a submitted file field only from a
binding too: an unbound port refuses one with `FileFieldWriteError`. A behavioral update case
carrying a file token therefore needs the scratch ledger, `resolveSubmittedFiles(fields, values,
"update", { ...scope, record: { table, id } })` and the port's sixth parameter, as
`handler-invocation.ts` passes them. Today no Gate run submits a file field on an edit
(`formSubmitsField`, and `gate.smoke-file.test.ts` pins it), so an update Handler that runs the
photo through the scalar extractor compiles, passes the Gate and fails every real edit of a
record with a photo. To lift the refusal of generated `file` fields, add `file` to
`GENERATION_FIELD_TYPES` in `registry/spec/spec.ts`, which also makes
`unofferedFieldTypeIssues` in `builder/spec/unoffered-field-types.ts` find nothing to refuse.
Then change the line both builder prompts carry, "every field sends accepts as null". A file
field cannot be `required` until 7.1/08, so the builder must not mark one required. No
evolution-matrix row adds a file field yet; the choice battery in
`evolution-matrix.choice.test.ts` is the model for one.

## Acceptance criteria

- [x] Spec and candidate generation can declare a `file` field with `accepts: ["image"]`,
      and generated candidates carrying one are no longer refused
- [x] `photo_grid_tile` declares a `file` field, reads the projection's `url`, and draws
      a no-photo state for `null`
- [x] The Gate's scratch ledger mints a reference for a field with a file and leaves one
      empty, with names carrying markup, a bidirectional override, emoji and 255 bytes
- [x] Behavioral inputs for a file field are `image` or `null` in a required-nullable
      shape with no `oneOf`; the harness turns them into scratch references; rows compare
      by `kind` and `name`
- [x] The behavioral input digest changes when a file token changes
- [x] The smoke rung's non-text exclusions include a file field
- [x] The smoke rung's update samples submit each active file field as 7.1/08's form will:
      the held key, a fresh scratch reference, `FILE_CLEAR_VALUE`, and `""` for an empty
      field, through a scratch-ledger binding, so an update Handler that mangles the photo
      fails the Gate
- [x] The HTML filter sets `loading="lazy"` and `decoding="async"` on an `<img>` with a
      `/files/` source, and enforcing its output a second time leaves it unchanged
- [x] No test calls the real provider
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Run `bun run reset` and use the Aluna running on `:3030` (ask for it to be started if it
is down). Type "keep track of my photos" into the prompt bar. A Photos capability builds
without a Gate rejection, and its spec declares a `file` field that accepts `image`. Add
a record with only a title. The card draws its no-photo state, and the form shows the
stand-in, with no picker yet, until 7.1/08.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/05-keeping-replacing-and-clearing-a-photo-and-deleting-its-record.md

## What landed

**Generation offers `file`.** `GENERATION_FIELD_TYPES` in `registry/spec/spec.ts` is the whole
pantry now, so the provider schema offers `file` and `unofferedFieldTypeIssues` finds nothing to
refuse. Both builder prompts carry the same three lines from `builder/spec/file-field-guidance.ts`:
declare a file field with `accepts: ["image"]` when the capability holds pictures because the person
asked to keep them and never add one unasked, never mark one required, and give a capability a title
or caption when it wants its pictures found by words, since search never reads a file. The old "every field sends accepts as null ... the type list above offers none" line is gone.
The item renderer's prompt gains `ITEM_FILE_FIELD_RULE` when its card shows a file field: the value
is `{ url, name, kind, mime, size }` or `null`, the picture comes from `url`, a `null` draws the
empty frame with a short note, the picture takes `alt=""` when the card shows the field that
describes it, and the file name is not a description. The create prompt says a file field the form
left out is not in `input.values` at all.

**The photo exemplar.** `photo_grid_tile` declares `photo: file` accepting `image`. Its renderer
reads the projection's `url`, gives the picture `alt=""` because the title beside it names the
card, and draws the tinted frame with "No photo yet" when the field is `null`. It leaves `loading` and `decoding` to the platform. Its two previews
are one record with a photo and one without, and a test renders both through the renderer and the
enforcer and compares them with the previews.

**The HTML filter.** `enforceItemMarkup` is now two passes: `neutralizeItemMarkup`, the old
enforcer, then a pass that sets `loading="lazy"` and `decoding="async"` on an `<img>` whose `src` or
`srcset` names a `/files/` address, or that sits in a `<picture>` whose `<source>` does. It sets
only a value that differs, so a second enforcement changes nothing. Design lint diffs a renderer
against `neutralizeItemMarkup`, so an attribute the platform supplies is never a violation. URL
attribute checks moved to `presentation/safety/attribute-urls.ts`, which reads a value as a browser
does (character references, backslashes, `srcset` lists), and the first-wins collapse of a repeated
attribute moved to `repeated-attributes.ts`, shared with the Handler scrub (details under the
findings).

**The scratch ledger.** `openScratchDatabasePair` builds a `file_ledger` in every scratch database
with `createFileLedgerSchema`, which migration `0016_file_ledger` now calls too.
`builder/gate/gate-scratch-files.ts` mints pending or owned rows for a scratch incarnation, builds the projection a
probe needs, and `scratchSubmission` checks a save with `resolveSubmittedFiles` and binds it exactly
as `handler-invocation.ts` does, through `withFileProjections`, now in
`runtime/data/access/file-claims.ts`. Every scratch file name
comes from `gate-scratch-names.ts`, a leaf: markup, a right-to-left override and an emoji, padded to
exactly 255 bytes.

**The smoke rung.** A create posts a fresh pending file for each active file field and submits every
field. Each file field then takes five edits, each starting where the last left it: keep the held
key, replace it, `FILE_CLEAR_VALUE`, `""` on the now-empty field, and a new file onto the empty
field. The binding is the router's, so an update Handler that runs the photo through the scalar
extractor fails with `FileFieldWriteError`. After the delete, one more create posts no file field at
all, as today's stand-in form does. A hidden file field holds a real owned reference, so the
merge-preservation check can see it move. Search fixture rows hold a minted file on every other
row, and the non-text exclusions gain `file exclusion`: the excluded row's file is named "fileonly",
so a search that reads a file column fails the Gate. A `file kind exclusion` per family catches a
search that reads a file's stored kind or type, and the three tied rows hold no file. `fieldValueMatches` compares a file by `kind`
and `name`, never by key. `formSubmitsField` is gone.

**The behavioral rung.** A behavioral input's `value` is `string | null`: a file field's value is a
family token or `null`, and the provider schema still has no `oneOf`. The contract refuses anything
else in a file field, refuses `null` on any other field, refuses a file in a missing-record case,
and never counts a token as fragment evidence. The harness posts a token as a pending scratch file named `tokenFileName(family)`, `null`
as `""` on a create, and on an edit as the clear when the record holds a file. A create submits
every field. Setup rows go through the port with a binding, and the ledger's `record_id` follows the
deterministic id. Rows compare a file token by family and that name. A failed case records the
projection its Handler received. The row vocabulary carries each
file field's `accepts`, and the create and update digests already cover `type` and `accepts`, so a
changed token vocabulary regenerates exactly those suites.

**Design lint.** The baseline probe holds a file (one fixed key, so only the field under test ever
moves a probe), the contrast for a shown file field holds none, and each hostile probe's file is
named with its payload. A card that draws nothing for a record without a file is told so.

## Findings from adversarial review, all fixed

Two adversarial reviews (the Gate; the filter, prompts and exemplar), a standards review, then a
verification pass over the fixes. Each fix that changes behaviour has a test that fails with the
fix reverted, checked by reverting it.

- The scratch module imported the router's index, which closed a loop through the server, the
  deletion code and the builder. Nine unrelated test files crashed when run alone with "Cannot access
  … before initialization" (HIGH). `withFileProjections` now lives beside `submittedFileProjection`
  in `runtime/data/access/file-claims.ts`, and the Gate imports only router types. A test loads the
  router and the HTTP layer first in fresh processes.
- No Gate run created a record with the photo left out, the only create today's stand-in form sends,
  so a create Handler that assumed the photo always arrives passed (MEDIUM). The smoke now ends with
  that create, and the create prompt says a file field the form left out is not in `input.values`.
- A missing-record update that posted a file token was answered by the platform before the Handler
  ran, so the case proved nothing about the Handler (MEDIUM). The contract refuses a file in a
  missing-record case, and the test prompt says to leave file fields out of one.
- Backslash addresses (`\\host`, `/\host`, `&#92;&#92;host`) passed the enforcer's same-origin check,
  stopped only by the page's CSP (MEDIUM, older than this issue). URL attributes are read with `\` as
  `/`, in `presentation/safety/attribute-urls.ts`, where the URL checks now live.
- The Handler scrub judged a repeated attribute copy by copy, so `<a href="/ok" href="javascript:…">`
  lost the safe first copy and kept the live one (MEDIUM, older than this issue, CSP-contained). The
  enforcer's first-wins collapse is shared as `collapseRepeatedAttributes` and both use it.
- The prompt told the model to declare a photo field whenever the thing tracked "has a picture",
  wider than the issue, and at odds with the candidate prompt's "change only what the intent asks
  for" (MEDIUM). It now says to declare one when the capability holds pictures because the person
  asked to keep them, and never to add one nobody asked for.
- Character-reference decoding first removed any URL naming an unknown reference, which stripped
  legitimate values such as `&eacute;` in an inline SVG and `&AMP;`. It now decodes numeric
  references and the 46 named references that decode to ASCII, taken from the WHATWG table; every
  other reference decodes past ASCII, where no scheme or slash can be spelled, and stays as written.
- `src` was split on commas as if it were a `srcset`, which removed a legitimate `data:` image and
  completed `data:image/png,/files/x`. Only `srcset` splits now.
- The exemplar gave its picture the title as alt text inside a card whose accessible name is its
  text, so a screen reader read the title twice. The exemplar and the renderer rule use `alt=""`
  when the card shows the describing field.
- Relative addresses of a served file (`./files/…`, `files/…`, `\files\…`) and a `<picture>` whose
  `<source>` names one got no loading attributes. Candidates resolve as paths, and the enforcer
  completes the `<img>` a served `<source>` precedes.
- A card that shows only the photo and draws nothing without one got a message about the field not
  reaching the composition. It now names the empty state.
- The three tied search fixture rows each minted their own file, so a search ranking matches by the
  file column tied at random. The tied rows hold none.
- A failed behavioral case recorded the token, not the projection its Handler received. It records
  what the Handler got.
- The search exclusion caught a search reading a file's name, not one reading its stored kind or
  type. The fixture adds a "file kind exclusion" per family.
- Standards: a `flatMap(… ?? [])` that filtered a scalar is now a named helper, and a test
  assertion the loop above it already covered is gone. `unofferedFieldTypeIssues` stays, as the
  issue expects: with the pantry offered whole it finds nothing, and a type that joins the pantry
  before the Gate can test it would be refused there.
- Two stray invisible right-to-left characters that the tool layer wrote into source were replaced
  with escapes.

The verification pass confirmed every fix above and found four problems in the first `<picture>`
fix, all fixed:

- Enforcing twice changed `<picture><source srcset="/files/a"><a></picture><img src="/x.png">`,
  because unwrapping the `<a>` also dropped the `</picture>` the first pass had seen (MEDIUM). Image
  completion is now its own pass over the neutralized markup, so both enforcements see one structure.
- `<svg><picture/></svg>` made the enforcer throw "No end tag", which would take down the view it
  renders (MEDIUM). The picture stack registers an end-tag handler only on an element that can have
  one.
- A `<source>` in a `<video>` completed an unrelated `<img>` after it, and a nested picture reset the
  outer one. A source counts only inside an open picture, on a stack of frames.
- `srcset` split on JavaScript's `\s`, wider than the ASCII whitespace a browser splits at, and a
  comment still claimed `java\tscript:` could not pass there. It splits on ASCII whitespace, and the
  comment says what a `srcset` does.
- Older than this issue: unwrapping an element dropped the end tag lol-html matched to it when that
  tag implicitly closed a kept ancestor, so `<div><a></div><p>x</p>` came out as `<div><p>x</p>`.
  The unwrapped element now marks the kept element the tag closes, and that element's own handler,
  which lol-html runs last, writes the tag back once. A 50,000-case structural fuzz found no throw,
  no second pass that changed anything, and no end tag the input did not have.

A final verification of that rework (about a million fuzzed inputs, with a traced end-tag oracle
and mutants it had to catch) confirmed it, and found one more, older than this issue:

- After a self-closed `<svg/>` or `<math/>`, lol-html still believes it is in foreign content and
  passes a `<![CDATA[…]]>` section through as text, while a browser reads a bogus comment that ends at
  the first `>`, so markup hidden after it went live (HIGH, older than this issue). The page's CSP
  allows `unsafe-eval` for Alpine, so a hidden `x-init` would have run. Both the enforcer and the
  Handler scrub now escape every CDATA opener before parsing (`presentation/safety/cdata.ts`), so both
  parsers read text. A `<source>` in a `<video>` inside a `<picture>` no longer counts toward the
  picture either: players get frames of their own.

Found in passing and filed as its own task rather than folded in here: an end tag that matches no
open element, such as a bare `</button>`, passes through the enforcer unchanged, and in a browser it
would close the item's wrapper early. lol-html has no handler for such a tag, so the fix needs a
design of its own. It is older than this issue, and design lint already refuses a template that
writes record values unescaped.

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 3383 tests, 0 failed. New
suites: `builder/gate/gate-scratch-files.test.ts` and
`builder/gate/rungs/behavioral/gate-behavioral-file.test.ts`. Rewritten or extended: `gate.smoke-file.test.ts`, `gate-design-lint-file.test.ts`,
`spec-gen.file.test.ts`, `candidate-spec-gen.file.test.ts`, `registry/fields/file.test.ts`,
`behavioral-test-inputs.test.ts`, `gate-behavioral-input.test.ts`, `file-contract.test.ts`,
`enforcer.test.ts`, `fragment-safety.test.ts` and `vocabulary.test.ts`. A 50,000-case structural fuzz
of the enforcer, CDATA sections included, found no throw, no second pass that changed anything, no
invented end tag and no surviving directive. The nine files the import cycle crashed pass alone.

Live on :3030, against the real provider. "keep track of my photos" built Personal photos with no
Gate rejection: `photo` is a `file` field accepting `image`, beside a required `title`. The model's
frozen behavioral tests named the photo by token (`image` and `null`) and passed. A record with only
a title drew the card's "No photo yet" frame, and the form showed the photo stand-in. After the review
fixes, "keep track of my travel photos" built Travel photos the same way, its card giving the picture
`alt=""`. A record posted as the stand-in posts it, with no file field at all, saved, and its card
read "No photo yet" with no file address.
