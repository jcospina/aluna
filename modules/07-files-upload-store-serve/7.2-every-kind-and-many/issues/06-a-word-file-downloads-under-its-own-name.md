# A Word file downloads under its own name

Status: done — signed off by the owner on 2026-10-02

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN decisions 1, 2, 3, 6 and 27; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

The `document` family gains DOC, DOCX, Markdown and plain text. Anything that isn't media
or a PDF downloads under its original name. This issue completes the signature table, and
it records the full allowlist, every extension of every family, as the plan asks of 7.2.

**DOCX is checked after the write.** A DOCX is a zip whose `[Content_Types].xml`
declares the WordprocessingML main document. The zip's central directory sits at the end
of the file and the entry is deflated, so this check runs after the staged write, before
the ledger row, and inflates under a size cap. DOCM, DOTX and XLSX fail it. A
password-protected `.docx` is an OLE2 file rather than a zip, and its refusal says so in
the field.

**DOC is OLE2.** XLS, PPT and MSG share the OLE2 container, so the check confirms the
family and not the application. A DOC downloads, so a spreadsheet saved as `.doc` harms
nothing.

**Text is read to the end.** Markdown and plain text are admitted when they are UTF-8,
with or without a BOM, UTF-16 with a BOM, or 8-bit text with no zero bytes, such as the
Windows-1252 that Excel writes for Spanish text. The check streams over the whole file
and records the encoding it found in the ledger's encoding column, where Module 9 starts
reading plain text.

**No declaration is not a contradiction.** Operating systems routinely send nothing for
`.md`, and nothing for `.docx` on a machine without Office. A blank or
`application/octet-stream` declared type is no claim, and the bytes decide.

**Download under the original name.** Everything outside media and PDF is served as an
attachment, with `filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded>`. The
control's filled document state shows the download link. The picker's `accept` lists
every document extension.

## Acceptance criteria

- [x] A DOCX is admitted after the write by its content types, with inflation capped;
      DOCM, DOTX and XLSX renamed `.docx` are refused
- [x] A password-protected `.docx` is refused with a sentence that names the reason
- [x] A DOC is admitted as OLE2
- [x] Markdown and text in UTF-8 (with and without a BOM), UTF-16 with a BOM, and
      Windows-1252 are admitted with their encoding recorded; a file with zero bytes and
      no UTF-16 BOM is refused
- [x] A `.md` and a `.docx` sent with no declared type are admitted
- [x] Documents other than PDF download as attachments under their original name, and
      `Presupuesto año.docx` arrives under that name
- [x] The issue lists every admitted extension of every family
- [x] Each new document type gets its own design-lint probe for free (7.2/05's
      `familyProbes` probes every type admission records a document as); a test proves a
      card that labels a Word file "PDF" or draws it is caught, and PDF stays the first
      document row so scratch documents keep a PDF's type and `.pdf` name
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

In the manuals capability from 7.2/05 on the Aluna running on `:3030`, upload
`Presupuesto año.docx` and download it from the record. It saves under that exact name.
Upload a `.md` file, which is admitted. An `.xlsx` renamed `.docx` and a
password-protected `.docx` are each refused, with their own sentences.

## Blocked by

- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/05-a-pdf-opens-in-the-browser.md

## Every admitted extension

Admission's table in `src/platform/files/admission/admission.ts` is the allowlist, and this is
all of it. Extensions are compared case-insensitively.

| Family | Extensions | Recorded as |
| --- | --- | --- |
| image | jpg, jpeg, jfif, pjpeg, pjp, png, gif, webp, avif | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/avif` |
| video | mp4, m4v, mov, webm, ogv, ogg | `video/mp4`, `video/quicktime`, `video/webm`, `video/ogg` |
| audio | mp3, m4a, aac, wav, ogg, oga, opus, webm, flac | `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/flac` |
| document | pdf, doc, docx, md, txt | `application/pdf`, `application/msword`, the WordprocessingML type, `text/markdown`, `text/plain` |

- A video's picker offers `.ogv` and not `.ogg`, since a browser declares any `.ogg` a sound. An
  `.ogg` sent with no claim is still admitted as either family its bytes hold.
- A document picker offers the five extensions alone, as `design/` draws it.
- `.markdown`, `.text`, `.rtf`, `.odt`, `.dotx` and `.docm` are refused at the extension.
  `design/` draws the document picker with `.md` and `.txt` only.

## What landed

**Admission.**
- Four rows join PDF in the `document` family, in this order after it: DOC, DOCX, Markdown and
  text. PDF stays the first document row, so a scratch document is still a PDF named `.pdf`.
- A document's extension alone picks its row. A `.md` that opens with `%PDF-` is recorded as
  Markdown and downloads, and a `.pdf` whose bytes are text is refused.
- DOC is an OLE2 file by its first eight bytes. XLS, PPT and MSG share the container, and PLAN
  decision 3 admits them under `.doc` because a DOC downloads.
- DOCX opens as a zip or an OLE2 file, and is settled after the staged write, before the ledger
  row (`documents/word-package.ts`):
  - A zip is a Word document when `_rels/.rels` names one office-document part and
    `[Content_Types].xml` declares that part the WordprocessingML main document, by its own
    override or its extension's default. DOCM, DOTX and XLSX fail it.
  - The zip reader (`documents/zip-entry.ts`) caps the central directory at 4 MB and each part
    at 1 MB, inflated under that cap, and checks the part's CRC. ZIP64, a split zip, an
    encrypted part, a local header that disagrees with the directory, and a name any reader
    would take for another are refused.
  - An OLE2 file named `.docx` is locked when its directory holds an `EncryptedPackage` stream
    (`documents/compound-file.ts`). Any other OLE2 file named `.docx` is not the Word document
    its name says.
- Markdown and text are read to the end by `documents/text-scan.ts`, and the encoding it finds
  goes in the ledger's `encoding` column as a label `TextDecoder` reads: `utf-8` (with or
  without a BOM), `utf-16le` or `utf-16be` (with a BOM), or `windows-1252` for 8-bit text with
  no zero byte. A zero byte refuses the file the moment it arrives.
- Blank and `application/octet-stream` are no claim, as before. New aliases: `text/x-markdown`
  and `application/x-msword`. A `.md` may be declared `text/plain`, and a `.docx`
  `application/zip`, since each names the container and no application.
- `SignatureCheck` takes the file's name first, and the ledger row can only be built from
  `admitWritten`'s answer, a `WrittenAdmission`, so no caller can record a DOCX unchecked.

**Refusals.** Two sentences join the upload's, word for word from `design/controls.html`:
- A locked Word document: "That Word document has a password on it, so I can’t keep it. Mind
  saving a copy without one?" The refusal code is `locked`.
- A document whose bytes aren't what its name says: "That isn’t the Word document its name says
  it is. Mind picking a different one?", naming a PDF, a Markdown file or a text file as the
  design bench's `NAMED_AS` does. A PDF with the wrong bytes now gets "That isn’t the PDF its
  name says it is." where 7.2/05 gave the generic document sentence.

**Serving.** A PDF still opens in a tab. Every other document is served as an attachment,
`attachment; filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded>`, under
`default-src 'none'; sandbox`, with `nosniff` from the app. `contentDisposition` replaces
`inlineContentDisposition`.

**Store.** `StagedObject.read` reads staged bytes through one descriptor, opened at the first
read and closed by `place` or `discard`, and never reads past the file's end.

**The control.** Nothing changed in the product path. `file-parts.js` already downloads any
document that isn't a PDF, under its own name. The picker's `accept` is now `design/`'s
`.pdf,.doc,.docx,.md,.txt`, and a test pins it to `KINDS.document.accept`.

**Design lint.** `familyProbes` now probes the DOC, DOCX, Markdown and text types with no
change of its own. A new check, `mislabelledDocument`, fails a card that says "PDF" (in any case,
plural, or entity-encoded) for a document of another type:
- what the card adds for the file, over the same card with the field empty, must say "PDF";
- and it must say "PDF" as often as it does for the same file recorded as a PDF.
A card that hints "PDF or Word" beside a right label passes, and a card that says "No PDF yet"
when empty and "PDF" for a Word file fails. It reads a field that holds several files too, for
7.2/07.

**Fixtures.** `documents/samples/` holds a DOCX and a DOC saved by macOS `textutil`.
`office-samples.test-support.ts` builds zips, OOXML packages and OLE2 files byte by byte. No
tool on this machine writes a real password-protected DOCX, so the locked one is built with the
streams Office writes around an encrypted package.

## Findings from adversarial review, all fixed

Two reviewers ran first, one on the byte-level readers and admission and one on serving, design
lint, copy and the criteria. Five more rounds reviewed the fixes; the last found one note,
fixed below, and confirmed every earlier fix.

**The Word check.**
1. *A crafted XLSX or DOCM passed as Word (medium).* The content types were scanned for any
   `ContentType`, in comments and inside other attributes' values. The check now follows
   `_rels/.rels` to the one main part and reads its own override or its extension's default.
2. *An unclosed comment made the first fix quadratic (high, second round).* An 800-byte upload
   could hold the server for minutes. Both parts are now read by a hand tokenizer in one pass,
   and a timed test reads a megabyte of unclosed comments.
3. *The reader still read some parts unlike an XML or OPC reader would (medium, second round).*
   It now refuses comments, processing instructions, CDATA, DOCTYPE, prefixed names, text
   between tags, a root outside the OPC namespace, an override named twice, and a relationship
   target with an escape, a backslash, a query, a fragment, a scheme, an empty segment or a
   `..` above the root. Each case is a test.
4. *Spec-conformant packages were refused (low).* UTF-16 parts, references in values and an
   uppercase type now read as a Word document.
5. *Three more ways a DOCM read as Word (high and medium, third round).* A child could declare a
   namespace of its own and pass as an `Override`; a declaration naming UTF-7 could hide one in a
   comment only a real parser sees; and a Kelvin sign folded to `k` matched an override a real
   reader keeps apart. The reader now refuses `xmlns` on a child, any declared encoding but the
   part's own, a name outside OPC's characters or ending in a dot, ASCII case aside, whitespace
   XML doesn't count as such, an undefined or bare reference or a control character, a
   relationship type that isn't one of OOXML's two, and a relationship `Id` missing or repeated.
   `TargetMode="Internal"` is read as the default it is. Each case is a test.
6. *Default and Override were told apart by their attributes (high, fourth round).* A `Default`
   carrying a `PartName` passed as the main part's override, so a DOCM read as Word again. Each
   element is now told by its name and must carry exactly its own attributes. The fourth round
   also found, each now refused and tested: an extension taken across a `/`, or from a segment
   with no dot; a colon in a target, which a URI reader takes for a scheme; invalid UTF-8, an
   odd UTF-16 byte, a second BOM, references to surrogates, and a declaration with no version or
   pseudo-attributes out of order; an `Id` holding a space; and a zip entry named with a leading
   or inner backslash, which a Windows reader takes for the real part. A package whose other
   parts escape a non-ASCII name, as OPC asks, now reads. The fifth round found a default's
   extension could hold a Kelvin sign, which one reader folds to `k`; an extension now holds
   OPC's characters alone.

**The zip and OLE2 readers.**
7. *No test held the compressed-size cap (medium).* A test counts the reader's reads and fails
   without the cap.
8. *The local header was never compared with the directory (low).* Its name, method and
   encryption bit must now agree, and a name another reader would take for the wanted one (cut at
   a NUL, or with a leading slash) counts as a second copy.
9. *Readers could find another directory than this one (medium, fifth round).* An end record
   hidden in a comment, a count short of the directory, a gap before the end record, and a ZIP64
   locator in an entry's name each let Python's zip reader find a DOCM where this one read Word.
   Only the end record nearest the file's end counts, and it must end the file; the directory
   must run right up to it; the count must use the directory up; and a ZIP64 locator refuses
   the zip. Each layout is a test. The sixth round found the nearest end record was looked for
   only 22 bytes from the end, so a signature in a comment's last bytes was passed over where
   Python's reader stops on it; it is now looked for to the last four bytes.
10. *A crafted OLE2 file cost a read per FAT entry (low).* The FAT is now found lazily, one cached
   sector at a time, and the header's DIFAT count must match the FAT's size. A test counts four
   reads for a directory past the DIFAT.

**Text.**
11. *UTF-16 was checked a byte at a time in JavaScript (low).* It now goes through a fatal
   streaming `TextDecoder`, about 100 ms for 90 MB.

**The route and the store.**
12. *Nothing forced the name or the check after the write (low).* `SignatureCheck` takes the
   name first, and the ledger row takes only a `WrittenAdmission`.
13. *A second `check.finish()` sat where a throw would leave the staged file (low).* The first
    result is kept.
14. *`StagedObject.read` could allocate what it was asked for (low).* Reads are clamped to the
    file, share one descriptor, and are refused once `place` or `discard` begins. The second round
    found a read during closing reopened a descriptor; tests now cover both.

**Design lint.**
15. *A card whose empty state said "No PDF yet" passed while calling a Word file "PDF", and
    "pdf", "PDFs" and `&#80;DF` passed too (medium).* The check now compares the card's text runs
    with the empty card's by their longest common sequence, and counts "PDF" in any case, plural,
    entity-encoded, split by inline formatting, or broken by a soft hyphen, in text and in an
    element's name alike.
16. *A card hinting "PDF or Word" beside a right label failed (low), and so did static "PDF" text
    between two file-dependent parts (second round).* The third round found the rule still missed
    a "PDF" chip shown for every file, and skipped a card that throws without one, as a required
    field's may. A label now counts when the card shows it for the file whether it is a PDF or
    not, and not without a file; a run that names another type too, as "PDF or Word" does, is a
    hint; and a render that throws says nothing. The common sequence is weighted so a tie keeps
    "PDF" runs shared, checked against brute force on 200,000 cases, and a card of more than a
    million run pairs is matched as a multiset, so a looping card can't exhaust memory. The
    fourth round found a card with two required document fields, one a PDF, flagged though
    right, and a list of a PDF and a Word file flagged the same way. Every other PDF the record
    holds is now retyped before the comparison, and within a list only the files of another type
    are retyped or removed. The fifth round found that retyping hid a card whose label for one
    field reads another field's type, so the card is read both as it is and with the other PDFs
    retyped, the first only when it doesn't throw with the field empty.
17. *A field holding several files was skipped (info, for 7.2/07).* It is read too.

**Copy, picker and conventions.**
18. *A PDF with the wrong bytes changed sentence (medium, needs the owner).* 7.2/05 gave the
    generic document sentence. `design/controls.html` gives any document whose contents aren't
    what its name says a sentence of its own, and the bench's `NAMED_AS` names a PDF. The change
    stands with a test that ties every noun to the bench, and is raised for the owner's sign-off.
19. *The picker offered types, which a picker widens to `.log` or `.markdown` (low).* A document
    picker offers extensions only, as `design/` draws it, pinned by a test.
20. *A test comment named a header pair Chrome doesn't send (low).* Chrome's `<a download>` is
    `navigate`/`empty`; Firefox's and a plain link's are `navigate`/`document`. Both are tested.
21. *Smaller notes (info).* `DOWNLOAD_POLICY` is `INERT_IMAGE_POLICY`; a test no longer restates the
    extension list; PLAN tags follow the text they mark; stale and overlong comments are rewrapped;
    an un-awaited `.resolves` is awaited; the fixture comment no longer calls design/'s DOCX a
    word processor's, and `samples/` holds two that are.

**Recorded, by PLAN.**
- `.doc` admits any OLE2 file, macros and MSG included, since a DOC downloads (PLAN decision 3).
- An encrypted XLSX named `.docx` gets the locked Word sentence: an encrypted package can't be
  opened to tell.
- An empty `.md` or `.txt` is admitted as `utf-8`.
- Shift-JIS, GBK and other non-Latin 8-bit text is labelled `windows-1252`. Module 9 reads the
  label and may meet it.
- `.markdown` is refused; `design/` draws `.md` only.
- A document's extension alone picks its row, which PLAN decision 3 now says.
- A real password-protected DOCX was not available; the locked file is built with Office's
  stream names.
- A package with prefixed namespaces, or a part name with a percent escape, is refused. Office
  and textutil write neither; a tool that rewrites a package through a generic XML library may.
- A "PDF" chip a card shows with or without a file is not flagged: it says nothing of the file.
- "No PDF preview" shown for every file is flagged; the Gate's sentence tells the model to say
  "PDF" only of a PDF.

## Verification

**Checks.**
- `bun run typecheck` and `bun run lint` are clean.
- `bun run test` passes 4209 of 4209.
- New tests: `documents/text-scan.test.ts`, `zip-entry.test.ts`, `compound-file.test.ts`,
  `word-package.test.ts`, `admission.office.test.ts`, `upload-route.word.test.ts` (headers read
  after `createApp`'s full chain), staged reads in `object-store.test.ts`, the Word control state
  and the picker in `file-control.document.test.ts`, the design bench's nouns in
  `refusal-copy.test.ts`, and the real-type probes and every reviewed card in
  `gate-design-lint-file.test.ts`.
- The weighted common-sequence walk matched brute force on 200,000 random cases. The reviewers'
  zip, XML and text fuzzing is recorded in their findings above.

**Live, on `:3030`, in `appliance_manuals`.**
- The picker offers `.pdf,.doc,.docx,.md,.txt`.
- `Presupuesto año.docx`, sent with no type, was admitted. The control shows "Presupuesto
  año.docx", "DOCX · 1 KB" and a download link with `download="Presupuesto año.docx"`, and no
  tab-open link. The record saved, and its card says "Manual document" where the kettle's says
  "PDF manual".
- `/files/<key>` answered 200 with `attachment; filename="Presupuesto a_o.docx";
  filename*=UTF-8''Presupuesto%20a%C3%B1o.docx`, `default-src 'none'; sandbox` and `nosniff`,
  and the bytes matched the upload. The kettle's PDF still opens inline.
- `notas del hervidor.md`, sent with no type, was admitted, and its ledger row reads
  `text/markdown` with `encoding = utf-8`.
- An XLSX named `cuentas.docx` was refused with "That isn’t the Word document its name says it
  is." A locked `acta de la junta.docx` was refused with "That Word document has a password on
  it, so I can’t keep it." A word processor's DOCX was admitted.
- The browser pane cannot save a download, so that the saved file is named `Presupuesto
  año.docx` was confirmed by a reviewer in headless Chrome and Firefox, and is the owner's to
  confirm in the sign-off.

