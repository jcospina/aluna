# A field holds many files

Status: ready-for-agent

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN decisions 7, 16, 17, 18, 19, 38 and 39; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A `file[]` field holds an ordered list of files. It is a file type, not a list type,
and it follows every rule a single file follows, applied to each entry.

**`file[]` joins `FILE_FIELD_TYPES`.** It never joins `LIST_FIELD_TYPES`, which would
make it searchable, demand a list-input mode, comma-split its values and let an empty
submission clear it. Every caller of `isListFieldType` is audited again for the new
member. The column stores a JSON array of references. An empty field is `[]`, and a
`NULL`, which older rows hold when evolution adds the column, projects as `[]`.

**The router checks the list.** A `file[]` is an ordered list with no key twice. Each
entry is a pending reference minted for this incarnation and field, or a key this
record's field holds now. The list's count is capped by configuration, and a list over
the cap is refused with the sentence drawn in 7.2/01. The written-value rule applies to
the whole list: a value from generated code with a file dropped, added or reordered is
refused before anything is written.

**Displacement works per entry.** An entry the control removes is displaced and moves to
`cleanup_enqueued` when the save commits, by 7.1/05's rule. Deleting the record enqueues
every entry.

**The control holds a list.** The `file[]` list drawn in 7.2/01 sends each file as its
own upload request. The form cannot be saved while any of them is in flight, and removing
an entry mid-upload aborts its request.

**The Gate covers lists.** The scratch ledger mints a `file[]` with several files, and a
`file[]` an evolution added and left `NULL` in older rows, which the projection turns
into `[]`. A behavioral input for a `file[]` is an array of family tokens in the same
required-nullable shape, and the input digest covers it. The builder may declare a
`file[]` when a record holds several files, and the item-renderer guidance covers drawing
a list.

## Acceptance criteria

- [ ] `file[]` is in `FILE_FIELD_TYPES`, is not searchable, and every `isListFieldType`
      caller is re-audited with the result recorded here
- [ ] A `file[]` stores an ordered array, projects `[]` for empty and for `NULL`, and
      round-trips through create and update
- [ ] A list with a key twice, a foreign key, or more entries than the cap is refused
      with a typed code and a sentence
- [ ] A value from generated code with an entry dropped, added or reordered is refused
      before anything is written
- [ ] Removing an entry enqueues its key at commit; deleting the record enqueues every
      entry
- [ ] The control uploads each entry on its own request, holds the save while any is in
      flight, and aborts a removed in-flight entry
- [ ] The Gate's scratch ledger covers a several-file list and an evolution-added `NULL`
      column; behavioral inputs take arrays of family tokens, and the digest covers them
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, type "keep track of my trips with their photos". The
trip's field holds many files. Upload three photos to one trip, remove one before saving,
and save. The card shows two photos in order, and the removed one's row is enqueued.

Once 7.2/02 to 7.2/05 have landed, this also runs the epic's done-when test. Build Notes
with a many-file field that accepts documents and video. One note should hold a PDF that
opens in the browser, a DOCX that downloads under its own accented name, and a video that
plays and seeks.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/09-alunas-questions-never-see-a-photos-key.md
- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/01-every-kind-is-drawn.md
