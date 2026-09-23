# A Word file downloads under its own name

Status: ready-for-agent

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
and records the encoding it found in the ledger's encoding column, where Module 8 starts
reading plain text.

**No declaration is not a contradiction.** Operating systems routinely send nothing for
`.md`, and nothing for `.docx` on a machine without Office. A blank or
`application/octet-stream` declared type is no claim, and the bytes decide.

**Download under the original name.** Everything outside media and PDF is served as an
attachment, with `filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded>`. The
control's filled document state shows the download link. The picker's `accept` lists
every document extension.

## Acceptance criteria

- [ ] A DOCX is admitted after the write by its content types, with inflation capped;
      DOCM, DOTX and XLSX renamed `.docx` are refused
- [ ] A password-protected `.docx` is refused with a sentence that names the reason
- [ ] A DOC is admitted as OLE2
- [ ] Markdown and text in UTF-8 (with and without a BOM), UTF-16 with a BOM, and
      Windows-1252 are admitted with their encoding recorded; a file with zero bytes and
      no UTF-16 BOM is refused
- [ ] A `.md` and a `.docx` sent with no declared type are admitted
- [ ] Documents other than PDF download as attachments under their original name, and
      `Presupuesto año.docx` arrives under that name
- [ ] The issue lists every admitted extension of every family
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

In the manuals capability from 7.2/04 on the Aluna running on `:3030`, upload
`Presupuesto año.docx` and download it from the record. It saves under that exact name.
Upload a `.md` file, which is admitted. An `.xlsx` renamed `.docx` and a
password-protected `.docx` are each refused, with their own sentences.

## Blocked by

- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/04-a-pdf-opens-in-the-browser.md
