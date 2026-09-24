# A capability can declare a photo field

Status: done

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decisions 5, 18, 20 and 36; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

The field vocabulary gains a `file` type, and a spec can declare one whose `accepts`
holds `image`. This issue carries the type through every total contract the field-type
union forces. The Module 5 choice type (5.10/01) followed the same path. The reference a
save writes into the field is 7.1/04's; here the field exists and stays empty.

**The stored shape is fixed now.** A file field's column holds a reference as JSON in
TEXT, `{key, kind, mime, size, name}`, the way `string[]` already stores its array, and
the DDL mapper gives it `TEXT`. Rendering joins nothing, and the question loop can group
by `kind` without mapping types in SQL.

**`accepts` names the families a field takes.** Four families exist: `image`, `video`,
`audio` and `document`. In this epic the family enum holds `image` alone, and 7.2/02,
7.2/03 and 7.2/04 each add their own. `accepts` is required-nullable in the provider
schema, because OpenAI's strict structured outputs need every property in `required`. It
is non-null only on a file field and never empty. It is stored in canonical order, so
reordering it is no change.

**A file field is its own kind of type.** It gets `FILE_FIELD_TYPES`, separate from
`LIST_FIELD_TYPES`. Joining the list types would make it searchable, demand a list-input
mode, comma-split its values and let an empty submission clear it. `file[]` becomes the
second member in 7.2/06. Every caller of `isListFieldType` is audited, and the audit is
recorded in this issue. A file field is not searchable: its only text is a filename such
as `IMG_4821.JPG`, and a match the card cannot show is worse than no match.

**Evolution and validation learn the type.** Candidate validation enforces the `accepts`
rules. The Diff Engine and candidate canonicalization treat adding a file field as an
additive change, a nullable TEXT column, so no admitted fact reaches the unmapped
fallback. Changing a committed field's type is already refused upstream in candidate
validation; the `file` ↔ `file[]` test is 7.4/01's.

**The builder does not offer `file` yet.** The Gate cannot mint scratch references or
behavioral tokens for a file field until 7.1/06. Until then the generation-facing type
list leaves `file` out, and a generated candidate that carries one is refused. Gate-side
contracts that switch on field type get a `file` case whose only value is `null`, and
7.1/06 fills them in.

**The form's file branch is a stand-in.** Both field-renderer switches need a `file`
case. This one shows the field's label and submits nothing, so a create stores `NULL`
and an edit leaves the stored value alone under the merge-patch rule. 7.1/08 replaces it
with the drawn control.

## Acceptance criteria

- [x] A spec with a `file` field whose `accepts` is `["image"]` round-trips through
      registry parsing, the DDL mapper (TEXT) and both field-renderer switches
- [x] `accepts` on a non-file field, a file field with `null` or empty `accepts`, and a
      family outside the enum all fail closed
- [x] `accepts` is stored in canonical order, and a candidate that only reorders it
      produces no Diff change
- [x] The provider schema lists `accepts` in `required` as nullable, and its JSON schema
      contains no `oneOf`
- [x] `FILE_FIELD_TYPES` exists apart from `LIST_FIELD_TYPES`; every `isListFieldType`
      caller is audited and the audit is recorded here
- [x] A file field is not searchable, and search normalization never reads it
- [x] Adding a file field is an additive Diff fact, and no file fact reaches the
      unmapped fallback
- [x] The builder does not offer `file`, and a generated candidate carrying one is
      refused until 7.1/06
- [x] The stand-in form branch submits nothing: a create stores `NULL`, and editing
      another field leaves the file column untouched
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. Nothing on the desk can declare a file field until 7.1/06 teaches the builder
to emit one, so the proof is the round trip in tests. The first visible photo field
appears when 7.1/06 lands.

## Blocked by

None - can start immediately.

## What landed

**The type.** `src/registry/fields/file.ts` holds the contract: `FILE_FIELD_TYPES` (`file`),
`FILE_FAMILIES` (`image`), `acceptsSchema` and `validateFileFields`. `fieldTypeSchema` spreads
`FILE_FIELD_TYPES` after the scalar and list types, so every exhaustive consumer failed to
compile until it had a `file` case. `accepts` is optional on the domain field and
required-nullable on the provider's, and `null` turns into absence on the way in.
`familiesSchema(order)` refuses an empty or repeated list and returns the families in
`order`, whatever order they were authored in. `acceptsSchema` is that rule over
`FILE_FAMILIES`. A file field cannot be `required` yet, by the decision recorded below.

**Storage.** The DDL mapper gives a file field `TEXT` with a CHECK that the value is `NULL` or
a JSON object. `JSON_SHAPE_BY_FIELD_TYPE` is total over the pantry, so `file[]` has to state
its own shape in 7.2/06. The data tool refuses a non-null file value from generated code
(`FileFieldWriteError`), and so does the update port for a submitted file field. The read
path fails closed on a non-null column, because nothing writes a reference before 7.1/04.
A Handler cannot declare a `file` query-result column. That list lives in
`runtime/data/query-result-types.ts`, a leaf that imports no module that opens the database.
The length check never measures a file field.

**The form.** `src/presentation/controls/file-control.ts` is the stand-in both renderer
switches call. It draws the label, the optional marker and the declared hint on the shared
field chrome. It emits no control and no presence marker, and it carries
`data-file-stand-in` rather than the drawn control's mount hook. The wire lets a create omit
a file field's marker and refuses any marker naming one. A create stores `NULL`, and an edit
leaves the column alone. `file-stand-in.test.ts` proves the edit half with a trigger that
aborts any UPDATE naming the column.

**Search.** `isSearchableTextType` is false for `file`. `unit-prompts.ts` had its own copy of
that rule, and now calls the registry's, so the search Handler, the behavioral search
inputs, the smoke fixture and the Diff Engine all read one answer.

**Evolution.** The Diff Engine needed no change. Adding a file field is a `new_active_field`
fact: `add_column` plus the form, the two writing Handlers and their suites, and no search.
The residual check keeps a committed field's `accepts`, so any change to it fails closed
until 7.2/02 maps a widening. A hide freezes `accepts` as it freezes `max_length`. The create
and update behavioral inputs carry `accepts`. That is validation shape, like `max_length`,
and it changes no existing digest.

**The builder.** `GENERATION_FIELD_TYPES` (scalar and list types) is the provider's `type`
enum and the type list both prompts print. Both prompts say every field sends
`accepts: null`. A lax provider's spec or candidate carrying `file` is refused by the stage.
`unofferedFieldTypeIssues` in `builder/spec/unoffered-field-types.ts` reads the output as it
arrived, before any parse. Spec generation names every such field. Candidate validation takes
the check as a `stageIssues` hook, so one rejection names it beside any contract violation,
a shape error included.

**The Gate.** The smoke samples, search fixtures and design-lint probes give a file field
`null`. `formSubmitsField` in `builder/gate/gate-internal.ts` keeps it out of what the smoke
and the behavioral rung submit, as the stand-in does. Design lint skips the contrast probe for
a shown file field, since `null` against `null` cannot move.

**Decisions taken with the user.** A file field may not be `required` until 7.1/08, because
the stand-in has nothing to fill and a required one would refuse every save. The stand-in
shows the label and hint and nothing more. A capability whose only field is a file field
stores an empty record on a blank Add, the same as any all-optional capability.

### The `isListFieldType` audit

- `registry/spec/spec.ts` `isSearchableTextType`: a file is not a list, so not searchable.
- `registry/spec/spec.ts` `validateListInputs`: a file field is never required in
  `list_inputs`.
- `registry/spec/spec.ts` `validateListInputEntry`: an entry naming a file field is refused
  (`file.test.ts`).
- `builder/evolution/diff/diff-engine.ts` `listInputModesByField`: a file field never makes a
  `list_input_mode` fact.
- `presentation/fields/field-renderer.ts` `renderCreateField` / `renderEditField`: a file
  field takes its own branch before the scalar path.
- `runtime/router/wire/wire-protocol.ts` `normalizeRepeatedValue`: unreachable for a file
  field, whose marker is refused first.
- `runtime/router/wire/wire-protocol.ts` `addSubmittedEmptyLists`: a file field is never
  given `[]`, so an empty submission cannot clear it.
- `builder/units/generation/unit-prompts.ts`: a private copy of the searchability rule was
  replaced by `isSearchableTextType`.

These checks compare a type to the `"string[]"` literal instead of calling
`isListFieldType`. A file field is handled at each one:

- `runtime/data/access/mutation.ts` `submittedUpdateValue` is unreachable, because the port
  refuses a submitted file field.
- `gate-smoke.ts` and `gate-smoke-search.ts` exclude it as non-text.
- `gate-internal.ts` `fieldValueMatches` and `gate-behavioral-input.ts` are fine while the
  value is `null`; 7.1/06 owns both.

## Findings from adversarial review, all fixed

Three reviewers (contract, runtime, quality/spec), then a verification pass over the fixes.
Every finding below was fixed. Each fix that changes behaviour has a test that fails with the
fix reverted, checked by reverting it. The one exception is the hide freeze on `accepts`:
with one family, no two values exist to compare. 7.2/02 is asked to prove it.

- A required file field made every save fail (HIGH). The spec check now refuses one until
  7.1/08, by the user's decision.
- The update port accepted a submitted file field, and would have cleared the column. It
  now refuses one. The Gate smoke no longer submits a file field on create or update.
- Design lint failed every renderer that showed a file field, because `null` against `null`
  cannot make a contrast. The contrast probe skips it.
- The length check measured a file field and blamed the person for its length. It now skips
  file fields.
- The stand-in dropped a declared hint and lacked the guidance slot every field carries. It
  now uses the shared field chrome.
- The stand-in used a class the design does not define, and the drawn control's mount hook.
  It now uses `class="field"` and `data-file-stand-in`.
- The canonical-order tests could not fail with one family. `familiesSchema` is now proven
  over four.
- Candidate generation dropped the unoffered-type issue when another issue was present. The
  two now share one rejection.
- A hide did not freeze `accepts`. It does now.
- `file` became a query-result type that generated code could declare. It is excluded until
  7.1/04. The list lives in a leaf module, so the generated-code checker does not import the
  database.
- The DDL's object CHECK and the design-lint probes keyed on the whole file family. The CHECK
  is now a total map, and the probes derive from each field's benign value.
- Quality findings, all fixed:
  - a misplaced JSDoc and alias name in the renderer
  - a dead probe branch
  - unused registry exports
  - the searchability doc's stage count
  - duplicated refusal messages and a duplicated `orderings` helper
  - hard-coded indices and literals in tests
  - a misnamed, over-promising form-submission helper
  - test file names off the sibling pattern
  - a time-bound wire message
  - several comment rewordings
- Verification pass:
  - The first query-result leaf still imported the registry index, which opens the database.
    It now imports the registry's spec and file modules, and a test walks the checker's
    import graph.
  - The behavioral rung's create cases submitted the file field. They now use
    `formSubmitsField`.
  - A shape error hid the unoffered-type refusal. The check now reads the raw output.
  - Three fixes had no test that would catch their revert. Each has one now.
  - The exhaustive renderer probe drew a required file field. It is optional now.
  - A comment was repeated five times. It lives once, on `formSubmitsField`.
  - Two handoff notes were vague. Both now name their files.
- The Gate's null-only checks, the question loop's raw rows and the widening path belong to
  later issues. Each is written into the issue that owns it: 06 (the Gate), 08 (lifting the
  required rule), 7.2/02 (widening), and 09 (scrubbing, already in its scope).

## Verification

`bun run typecheck` and `bun run lint` are clean. `bun run test` passes: 3210 tests, 0 failed.
New suites:

- `registry/fields/file.test.ts`
- `runtime/data/schema/file-column.test.ts`
- `runtime/data/query-result-types.test.ts`
- `presentation/controls/file-control.test.ts`
- `runtime/router/wire/file-stand-in.test.ts`
- `builder/evolution/diff/file-evolution.test.ts`
- `builder/spec/spec-gen.file.test.ts`
- `builder/evolution/candidate/candidate-spec-gen.file.test.ts`
- `builder/units/generation/file-prompt.test.ts`
- `builder/gate/rungs/smoke/gate.smoke-file.test.ts`
- `builder/gate/rungs/design-lint/gate-design-lint-file.test.ts`

`gate-behavioral-input.test.ts` also gained a case.

Live, on `:3030`:

- The desk loaded every pre-existing capability with no console error.
- A Bike rides record was created and edited through the changed wire rule.
- "Keep track of my garden photos, with a picture and a short caption for each" was built
  twice from the prompt bar. Both times, spec generation passed on gpt-5.6-terra with
  `accepts: null` on every field, and the photo came back as a `string`, because the builder
  does not offer `file` yet.
- The first build failed at unit generation: the model left an unused `escapeHtml` in its
  search Handler. The search, create and update Handler prompts hash identically on `HEAD`
  and on this change, so the flake is not this issue's.
- The second build passed every Gate rung and opened Garden photos. Its registry row holds
  two string fields and no `accepts` key.
