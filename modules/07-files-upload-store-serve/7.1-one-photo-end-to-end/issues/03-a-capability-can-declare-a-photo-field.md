# A capability can declare a photo field

Status: ready-for-agent

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

- [ ] A spec with a `file` field whose `accepts` is `["image"]` round-trips through
      registry parsing, the DDL mapper (TEXT) and both field-renderer switches
- [ ] `accepts` on a non-file field, a file field with `null` or empty `accepts`, and a
      family outside the enum all fail closed
- [ ] `accepts` is stored in canonical order, and a candidate that only reorders it
      produces no Diff change
- [ ] The provider schema lists `accepts` in `required` as nullable, and its JSON schema
      contains no `oneOf`
- [ ] `FILE_FIELD_TYPES` exists apart from `LIST_FIELD_TYPES`; every `isListFieldType`
      caller is audited and the audit is recorded here
- [ ] A file field is not searchable, and search normalization never reads it
- [ ] Adding a file field is an additive Diff fact, and no file fact reaches the
      unmapped fallback
- [ ] The builder does not offer `file`, and a generated candidate carrying one is
      refused until 7.1/06
- [ ] The stand-in form branch submits nothing: a create stores `NULL`, and editing
      another field leaves the file column untouched
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Headless. Nothing on the desk can declare a file field until 7.1/06 teaches the builder
to emit one, so the proof is the round trip in tests. The first visible photo field
appears when 7.1/06 lands.

## Blocked by

None - can start immediately.
