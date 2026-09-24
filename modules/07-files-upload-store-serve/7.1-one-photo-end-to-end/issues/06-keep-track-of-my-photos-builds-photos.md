# "Keep track of my photos" builds Photos

Status: ready-for-agent

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

- [ ] Spec and candidate generation can declare a `file` field with `accepts: ["image"]`,
      and generated candidates carrying one are no longer refused
- [ ] `photo_grid_tile` declares a `file` field, reads the projection's `url`, and draws
      a no-photo state for `null`
- [ ] The Gate's scratch ledger mints a reference for a field with a file and leaves one
      empty, with names carrying markup, a bidirectional override, emoji and 255 bytes
- [ ] Behavioral inputs for a file field are `image` or `null` in a required-nullable
      shape with no `oneOf`; the harness turns them into scratch references; rows compare
      by `kind` and `name`
- [ ] The behavioral input digest changes when a file token changes
- [ ] The smoke rung's non-text exclusions include a file field
- [ ] The smoke rung's update samples submit each active file field as 7.1/08's form will:
      the held key, a fresh scratch reference, `FILE_CLEAR_VALUE`, and `""` for an empty
      field, through a scratch-ledger binding, so an update Handler that mangles the photo
      fails the Gate
- [ ] The HTML filter sets `loading="lazy"` and `decoding="async"` on an `<img>` with a
      `/files/` source, and enforcing its output a second time leaves it unchanged
- [ ] No test calls the real provider
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Run `bun run reset` and use the Aluna running on `:3030` (ask for it to be started if it
is down). Type "keep track of my photos" into the prompt bar. A Photos capability builds
without a Gate rejection, and its spec declares a `file` field that accepts `image`. Add
a record with only a title. The card draws its no-photo state, and the form shows the
stand-in, with no picker yet, until 7.1/08.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/05-keeping-replacing-and-clearing-a-photo-and-deleting-its-record.md
