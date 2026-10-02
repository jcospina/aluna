# A field holds many files

Status: ready-for-agent — built and verified; waiting on the owner's sign-off

Superseded in part by 7.3/01: a removed entry's bytes and row now go once the save commits, and
a list keeping a file it was drawn with that it no longer holds answers `record_changed`. Since
7.3/02, an unsaved file a list drops goes to the pending-only route at once instead of staying
`pending`. The text below records this issue as it landed.

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

**What 7.1/08 left for a required list.** A file field may be required since 7.1/08. The
mutation interface refuses a save that would leave a required `file` empty
(`assertRequiredFilesHeld` and `resultingFileKeys` in `src/runtime/data/access/mutation.ts`),
but both handle one key or none. A required `file[]` must refuse `[]` the same way, and the
browser's own check (`holdsNothing` in `public/fields/field-errors.js`) must count an empty list.

**A list that takes a sound records too.** 7.2/04 gave every single file field that takes
audio a Record beside its well (`design/scripts/files/file-recorder.js`). A list's add well gets
the same peer, and a recording it keeps is added as one more entry; `design/controls.html`
draws it beside the list and its tests drive it with the recorder's stand-in microphone
(`src/presentation/controls/recorder/file-recorder.test-support.ts`).

## Acceptance criteria

- [x] `file[]` is in `FILE_FIELD_TYPES`, is not searchable, and every `isListFieldType`
      caller is re-audited with the result recorded here
- [x] A `file[]` stores an ordered array, projects `[]` for empty and for `NULL`, and
      round-trips through create and update
- [x] A list with a key twice, a foreign key, or more entries than the cap is refused
      with a typed code and a sentence
- [x] A value from generated code with an entry dropped, added or reordered is refused
      before anything is written
- [x] Removing an entry enqueues its key at commit; deleting the record enqueues every
      entry
- [x] The control uploads each entry on its own request, holds the save while any is in
      flight, and aborts a removed in-flight entry
- [x] A list whose `accepts` holds `audio` offers Record beside its add well, and a
      recording it keeps is added as an entry
- [x] The list's held entries carry the reference's verified `mime` where
      `design/scripts/files/file-list.js` `heldFrom` reads `type`, so a PDF in a list
      opens in a tab with `rel="noopener"` rather than downloading, with a test
- [x] The Gate's scratch ledger covers a several-file list and an evolution-added `NULL`
      column; behavioral inputs take arrays of family tokens, and the digest covers them
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, type "keep track of my trips with their photos". The
trip's field holds many files. Upload three photos to one trip, remove one before saving,
and save. The card shows two photos in order, and the removed one's row is enqueued.

Once 7.2/02 to 7.2/06 have landed, this also runs the epic's done-when test. Build Notes
with a many-file field that accepts documents and video. One note should hold a PDF that
opens in the browser, a DOCX that downloads under its own accented name, and a video that
plays and seeks.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/09-alunas-questions-never-see-a-photos-key.md
- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/01-every-kind-is-drawn.md

## The `isListFieldType` audit

`file[]` joins `FILE_FIELD_TYPES` and stays out of `LIST_FIELD_TYPES`. Seven callers read
`isListFieldType`, and none admits `file[]`:

- `registry/spec/spec.ts` `isSearchableTextType`: a `file[]` is never searchable.
- `registry/spec/spec.ts` `validateListInputs` and `validateListInputEntry`: a `file[]` never
  takes a list-input mode. An entry naming one is refused as "must be a list field".
- `builder/evolution/diff/diff-keys.ts` `listInputModesByField`: makes no `list_input_mode`
  fact for a `file[]`.
- `presentation/fields/field-renderer.ts` `renderCreateField` and `renderEditField`: the list
  branch runs first and passes a `file[]` by, so the file branch draws it.
- `runtime/router/wire/wire-protocol.ts` `normalizeRepeatedValue`: a `file[]` has its own
  branch. Its values are kept as posted, with no blank dropping and no comma split.
- `runtime/router/wire/wire-protocol.ts` `addSubmittedEmptyValues`: a marked `file[]` with no
  values becomes `[]`, which says the list holds nothing. It never empties one.

The sites that compare against the literal `"string[]"` were read as well:
- `mutation.ts` `submittedUpdateValue` is never reached by a file field.
- `gate-internal.ts` compares lists through `sameFiles`.
- `gate-behavioral-input.ts` gives `file[]` its own branch.
- The smoke fixtures give `file[]` its own case.

## What landed

**The type and its column.**
- `file[]` is a file type (`isFileListFieldType`). Its column is TEXT, `NULL` or a JSON array of
  `{key, kind, mime, size, name}`.
- Generated code sees the array as projections, in order. An empty list is `[]`, and so is
  `NULL`, which older rows hold when evolution adds the column. That holds in
  `normalizeStoredRow`, in the query port's record reads and in the question views.
- A stored list that isn't one, or names a key twice, fails closed.

**The router's rule (`runtime/data/access/file-claims.ts`).**
- A `file[]` posts its marker and one value per key, in order.
- On an edit, each file it removes is posted as `__aluna_remove:<key>`. A file the record holds
  that the edit neither keeps nor removes answers `record_changed` before generated code runs, so
  an edit never removes a file another window added after its form was drawn. An empty post
  against a list that holds files answers the same way.
- Each kept key must be one the record holds now. Each new key must be pending, minted for this
  incarnation and field, and of a family the field accepts.
- A key twice, a key both kept and removed, a removal on a create, and the single field's clear
  value are refused as `invalid_file_reference`.
- A list that grows past the count is refused with the new platform-owned code
  `too_many_files` and the sentence `design/controls.html` settles for the save: "This field
  takes up to 20 files, and it has 21. Mind removing one?" Past one, it asks for "a few".
- A list that a lowered count already passes can still be edited, as long as it doesn't grow.
- Refusals rank the same way within one list as across fields: the record changing first, then
  the count, then a reference.
- The check runs before the Handler, again inside the save's transaction, and a third time in
  the mutation port.

**The count.** `OMNI_MAX_LIST_FILES`, twenty by default. It is checked at boot as
`OMNI_MAX_FILE_BYTES` is, and documented in the README and `.env.example`. Twenty is this issue's
choice and waits on the owner's sign-off. PLAN decision 7 and the design page say so.

**Writes (`runtime/data/access/mutation.ts`).**
- A file field now writes a list of keys. Required checks, the written-value rule and
  displacement are one rule for `file` and `file[]`.
- A Handler may hand back the same projections in the same order, or leave the field out.
  Anything else, a dropped, added or reordered entry, `null`, or one file in place of the list,
  is `FileFieldWriteError` before anything is written.
- An update enqueues every key the list held and no longer holds, in its savepoint. Deleting the
  record enqueues every entry, by the existing ledger query.

**Questions.**
- The worker's views show a `file[]` as a JSON array of key-free references, `[]` for `NULL`.
  Names that may hold an address are withheld.
- The second-layer scrub reads stored lists the same way.
- The catalog describes the column as an array, never null.

**The control.**
- The server draws a list host (`src/presentation/controls/file/file-control.ts`) with
  `data-file-list`, its families, `data-holds` with each file's verified `mime` as `type`, the
  count on the new `data-file-count` hook (the design list read the byte cap's
  `data-file-cap` before), the upload attributes, and a `[data-file-keys]` holder of hidden
  inputs.
- `public/controls/file-field.js` mounts lists and keeps the holder in step. It posts each file's
  key, plus a removal for each file the list was saved holding and holds no longer.
- `field-errors.js` counts a required list as empty with no key. It reaches a list that posts
  nothing, and forgets an error on `file-list:change`.
- `record-mutations.js` freezes lists while a save is out.
- `file-list.js` gives a list that takes sound Record beside its add well, through
  `file-recording.js`. A recording it keeps joins the end of the list. One whose upload fails or
  is stopped waits, with Upload again and Throw away.
- `design/controls.html` draws a recording list ("Field notes"). It notes the count and moves
  its list to the new hook.

**The Gate.**
- `scratchStoredFile` stores three files for a `file[]`. The smoke creates a list of two, then
  edits it five ways: keep, drop one as the rest move up and one joins, remove all, post none, and
  add.
- Search fixtures hold a list on every other row and `NULL` on the rest, as evolution leaves
  them. A renderer that throws on a non-array passes the smoke.
- Behavioral inputs give a `file[]` one entry per family token, or a lone `null`, and rows give
  it an array of families. The harness mints a scratch file per token and names every held file
  as removed on an update. Rows compare file by file, in order.
- The contract refuses an unaccepted family, a `null` beside a file in an input or a row, and a
  list past the count.
- The input digest moves with the field's type.
- Scratch saves use the default count whatever the operator configured.
- Design lint probes a list of three files, an empty list, hostile names, and mixed lists: the
  families in turn, and a PDF either side of a Word file.
- It fails a card that draws only some of a list's photos or videos, a list's video drawn as a
  photo, and a Word file in a list called "PDF", including by a card that tests the list by its
  truth.

**The builder.**
- The spec prompts say when to declare `file[]`.
- The Handler prompt says a list arrives whole and goes back whole.
- The card prompt says to draw every file in order and say so when the list is empty.
- The generated-code contract adds `readonly CapabilityFileProjection[]` only for a spec with a
  list, so code checked before lists checks the same. Gaining or losing a list regenerates every
  Handler.
- Evolution adds a `file[]` as a nullable array column, and refuses `file` ↔ `file[]` both ways.

## Findings from adversarial review, all fixed

Three reviewers ran first, on the server and data path, the browser half, and the Gate and
builder. A fourth round reviewed the fixes.

**Server and data.**
1. *A stale empty list reached generated code (medium).* It was refused only inside the
   mutation port, so a Handler that caught the error could answer 200. The router now refuses it
   before any Handler loads.
2. *Removing a file from an older form destroyed a file another window had added (medium).* Lists
   now name each file they remove, and a held file left unnamed answers `record_changed`.
3. *A lowered count locked every edit of a longer list (low).* Only a list that grows is refused
   now.
4. *Within one list, entry order decided which refusal won (low).* The order is now ranked.
5. *The count sentence's comment claimed one field only; the scope's count option was unused;
   `OMNI_MAX_LIST_FILES` was missing from the README, `.env.example` and the boot comment; three
   comments ran past 100 columns; list tests were missing for the create path, the
   in-transaction recheck and the stale list (info).* All fixed and tested.

**Browser.**
6. *A held Enter on Remove removed one file after another (high).* The list now drops key
   repeats, as a single field does.
7. *A double click on Remove removed two files (medium).* Every removal now pauses the next
   press.
8. *Focus fell to the page when Record, the unsent row or a refusal replaced the add well
   (medium).* Focus now falls back to whatever stands at the foot, and a row's Play keeps it
   across redraws.
9. *A kept recording blocked every other pick while it uploaded, with a wrong sentence, and
   Record did nothing (medium).* A travelling recording no longer blocks picks, and Record isn't
   drawn until it lands.
10. *The recorder's note on why a recording stopped was erased (medium); a "wait" notice
    outlived the recording (low); the list never turned red again after a refused microphone
    (low); Record showed on a full list (low).* All fixed.
11. *The posted baseline never moved after a kept save; a refusal couldn't find an empty list;
    the DOM double admitted unquoted colons; the script's header was stale (info).* All fixed.

**Gate and builder.**
12. *No probe held a list of mixed families or document types (medium).* Mixed probes now run.
13. *A valid `OMNI_MAX_LIST_FILES=1` failed every list capability in the Gate (low).* Scratch
    saves use the default count, and the behavioral contract and prompt state it.
14. *The PDF-label check missed a card that tests a list by its truth (low).* A list holding
    only other documents is now read against `null` as well as `[]`.
15. *A row could give a list `null` beside tokens (low).* Refused in rows as in inputs. A single
    `file` is held to nothing new, so a suite frozen before lists still passes (info).
16. *The `NULL` path had only a unit test (info).* The smoke now runs a renderer that throws on a
    non-array. Also: the prompt sentences for a single file now say `` `file` ``; a card drawing
    only the first of a list's pictures now fails, while one that counts them passes; a test name
    was corrected; PLAN decision 39 now states the token shape as built.

**The second round** confirmed every fix above. Its probes showed a removal can't reach another
record's files, another field's, or a pending file: displacement is scoped to the record, the
field and owned keys. It found these, all fixed:

17. *Within a list, a bad removal, a count or a key twice could answer before "record changed"
    (low).* Every key is now read once before the count, and a removal naming no key is ranked
    with the other references.
18. *The card prompt said to draw every file while the Gate's repair sentence allowed words
    alone (low).* Both now say: draw every file in order, or name the list in words alone, such
    as a count, naming no file's type. This also settles a single summary label over a mixed
    list (info).
19. *A card that drew the first three files passed, since every probe list held three (low).*
    Probe lists now hold seven, and a card that previews the first few and counts the rest
    fails.
20. *The repeat guard stopped a held Tab inside a list (low).* Both controls now hold back only
    a repeated Enter or Space.
21. *A mixed probe over four families never held a document (info).* It now holds as many files
    as the field has families.
22. *Under a lowered count, the browser refused a swap the server would take (info).* The list
    now refuses only a pick that grows it past both the count and what it was saved holding.
23. *The server drew a held file the browser could refuse to hold (info).* The server now draws
    an entry only when `heldFrom` would hold it: a name, an address, and a size of zero or more.

## Verification

**Checks.**
- `bun run typecheck` and `bun run lint` are clean.
- `bun run test` passes 4339 of 4339. An earlier run under heavy machine load (610 s against
  the usual 90 s) failed 3 of 4338 on time. Their names were lost, and a rerun passed all of them.
- New suites:
  - `router.file-list.test.ts`: saves, edits, removals, a concurrent addition, the stale list,
    the in-transaction recheck, ranking, the count, written values on create and update, and a
    double save.
  - `file-column.test.ts` additions: the column, `NULL` as `[]`, fail-closed reads, keyless
    questions.
  - `query-worker.test.ts`: the view of a list.
  - `file-list.test.ts`: server markup, a PDF opening in a tab with `rel="noopener"`, posted
    keys and removals, travelling files, required lists, a kept save, refusal placement and key
    repeats.
  - `file-recorder.list.test.ts`: Record beside the add well, a kept recording joining the list,
    unsent recordings, focus, notes, and the full list.
  - `gate.smoke-file-list.test.ts`, `gate-behavioral-file-list.test.ts`,
    `gate-design-lint-file-list.test.ts`, `file-list-contract.test.ts`, and the additions to
    `file-evolution.test.ts`, `file.test.ts`, `file-cap.test.ts`, `serve-options.test.ts` and
    `refusal-copy.test.ts`.

**Live, on `:3030`, in `appliance_manuals`.**
- From the prompt bar: "In my appliance manuals, let each appliance hold more than one
  document, since some appliances come with several manuals". Aluna evolved the capability to
  version 2. It added `manual_documents` ("Additional manuals", `file[]`, accepts `document`) as
  a nullable array column. Both older records hold `NULL`, and their cards say "No additional
  manuals".
- On the Electric kettle, three files dropped on the list:
  - `Kettle quick start.pdf`, `Garantía del hervidor.docx` and `Descaling notes.txt`, each
    admitted on its own upload.
  - The PDF's row opens it in a new tab with `rel="noopener"`, and the other two download under
    their own names.
- I removed the Word file before saving and saved:
  - The card shows "Additional manuals: PDF, Document", in order, and the column holds the PDF
    then the text file.
  - The removed Word file stays `pending`, because a file never saved belongs to 7.3/02's
    pending-only route and the desk-load sweep.
- An edit then removed the PDF:
  - The form posted the text file's key and `__aluna_remove:<the PDF's key>`.
  - The save left the column holding the text file alone, and the PDF's ledger row is
    `cleanup_enqueued`.

## Follow-up: a document is shown by its name

After the live check, the owner noticed the kettle's card said "PDF" for its manual and "PDF
PDF" for its additional manuals, which tells a person nothing about which document is which.
Nothing enforced that. The card prompt and both document examples taught it, and `design/`
drew it.

- `ITEM_DOCUMENT_RULE` now tells a card to show a document by its `name`, escaped, with a final
  extension of up to five letters or digits dropped. "Kettle manual.pdf" reads "Kettle manual".
  It never labels a document by its type alone. A type word that does appear is "PDF" only for
  a PDF, which design lint still checks.
- `ITEM_FILE_FIELD_RULE` keeps "describes nothing" for photos and videos only.
- Both document examples (`few-shot-documents.ts`) name the manual.
- `design/controls.html` says so, and its document card's detail reads "repotting-guide ·
  180 KB".
- A sound's card is unchanged, still "Audio".
- A test runs both examples over an accented Word file, a name with no extension, a name that
  is only an extension, and markup in a name. No test checks the rule's wording.

Cards that are already generated keep their old wording until their renderer is regenerated.

Tests check behaviour, never wording. None checks a prompt rule's phrasing, a sentence, or a
Gate or repair message:
- The prompts are checked by which rule reaches which prompt.
- The generated-code contract is checked by compiling Handlers.
- The Gate's checks are checked by a failing card and its passing twin.
- The recorder's sentences are checked by matching what a single field says.
- The count sentence is derived from `tooManyFilesSentence`, never spelled out.

