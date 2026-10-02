# A PDF opens in the browser

Status: done — signed off by the owner on 2026-10-02

Type: HITL — the app's security headers can blank a browser's PDF viewer, and only a
real browser shows that. A human opens a PDF in Chrome, Safari and Firefox.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN decisions 1, 3, 5, 27 and 29; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A field can accept documents, and a PDF opens in the browser from the open record. The
other document formats download, which is 7.2/06's work.

**`accepts` gains `document`.** Admission gets its PDF row, and the issue records the
extension it admits.

**A PDF carries a policy of its own.** The app-wide `object-src 'none'` is reported to
blank Chrome's PDF viewer, so `/files/:key` serves a PDF inline under a policy that lets
the viewer draw and still runs no script from our origin. This issue proves the policy
through the app's full header middleware, not the route alone, because a header added
later in the chain is what blanks the viewer. Every response still carries `nosniff`.

**The control and the card.** The control's filled document state from 7.2/01 opens a PDF
from the open record through a link carrying `rel="noopener"`, chosen by the reference's
verified type rather than the file's name (decision 4): `file-control.ts` writes the
reference's type as `data-holds-type`, and a document without it downloads. A document few-shot example
and item-renderer guidance land here, and 7.2/06 reuses them. Behavioral tokens gain
`document`, and the picker's `accept` includes `.pdf`.

## Acceptance criteria

- [x] `accepts` can hold `document`, and a PDF is admitted by its signature
- [x] A file renamed `.pdf` that isn't a PDF is refused mid-stream
- [x] A PDF is served inline under its own policy, with `nosniff`, and a test reads the
      headers after the full middleware chain has run
- [x] The open link in the record carries `rel="noopener"`
- [x] A document few-shot example and item-renderer guidance exist; behavioral tokens
      accept `document`
- [x] **Sign-off gate:** the human has opened a PDF from a record in Chrome, Safari and
      Firefox, and each viewer drew the document
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, type "keep my appliance manuals". Upload a PDF, open the
record, and follow its open link. The PDF draws in the browser's viewer in Chrome, Safari
and Firefox.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/09-alunas-questions-never-see-a-photos-key.md
- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/01-every-kind-is-drawn.md
- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/04-a-voice-note-records-in-the-field.md

## What landed

**The extension admitted.** A document is `pdf` only, for now: `.pdf` in any case, admitted
when `%PDF-` is its first five bytes. The header must open the file. A reader tolerates up to
1 KB of anything before it, and admission refuses that, since what sits there could be
anything (PLAN decision 3, amended). Aliases `application/x-pdf`, `application/acrobat` and
`text/pdf` read as `application/pdf`. 7.2/06 adds DOC, DOCX, Markdown and text to the same
family.

**Admission.**
- `FILE_FAMILIES` gained `document`. `acceptsSchema`, the generated-code contract, stored
  references and behavioral tokens follow it with no change of their own.
- The PDF row sits last in `admission.ts`'s table and first among documents.
- The refusal is "That isn’t a document I can keep here. Mind picking a different one?", and
  "a document" in the several-family sentence, both as `design/controls.html` draws them.
- A mismatch is refused at the fifth byte, mid-stream.

**Serving.**
- A PDF is served inline under `PDF_POLICY`: `default-src 'none'; sandbox allow-downloads allow-modals`.
  The policy is chosen by the verified type, so 7.2/06's downloads are an addition, not a
  rewrite.
- The measured facts behind it are in PLAN decision 27 (amended):
  - Chrome 154, Firefox 157 and Safari 26 draw a PDF under it, and under the app-wide
    `object-src 'none'` as well. The blanking once reported is not what current viewers do.
  - The sandbox keeps the viewer's page off our origin.
  - `allow-downloads` and `allow-modals` keep the viewer's own Save and Print. Chrome's Save
    re-fetches as `navigate`/`empty`, which the route serves.
- The route now refuses any load that would run a file as code, whatever its kind:
  `script`, `style`, the workers and worklets, `manifest`, `json` and `xslt`.
- A player's cors-mode load is answered only for a sound or a video.

**The control.** Nothing changed in the product path. `file-control.ts` already wrote
`data-holds-type`, and `design/scripts/files/file-parts.js` already opened a held
`application/pdf` in a new tab with `rel="noopener"` and downloaded any other document.
- A test now proves both through the server-drawn edit form.
- It also proves the picker offers `application/pdf,.pdf`.
- `kindOf` now reads a document's kind from an `application/` or `text/` verified type.

**Builder.**
- The spec pantry line names documents.
- `ITEM_DOCUMENT_RULE` says a card:
  - never draws a document, and draws no `<a>`, `<img>`, `<embed>` or frame;
  - says "PDF" for `application/pdf` and "Document" for any other type;
  - says a short note when the value is null.
- `ITEM_FAMILIES_RULE` names documents. `ITEM_FILE_FIELD_RULE`'s empty frame is scoped to a
  field that may hold a photo or a video.
- New `few-shot-documents.ts` has an appliance-manual feed card and tile (`onlyFor: ["document"]`).
  `notForOnly` became a list, so the photo tile is kept from any card that holds only sounds
  and documents.
- In the Gate:
  - `gate-file-kinds.ts` names a document.
  - The media-frame check is now per field. A frame with no picture fails unless a shown
    photo or video field is missing in that probe, and it names the kind that has no picture.
  - Design lint probes every further type admission records a document as, which is none
    until 06.
  - Scratch names take their extension from admission's row for the scratch type, so a
    token's name and type can't drift.

**Living demo.** The `appliance_manuals` capability on `:3030` was built from "keep my
appliance manuals", with a required `manual` file field taking `document`. It stays for
7.2/06.

## Findings from adversarial review, all fixed

Two reviewers ran, one on serving and admission and one on the builder and client.

**Serving and admission.**
1. *No sandbox (low).* The PDF policy now carries
   `sandbox allow-downloads allow-modals`, measured drawing in all three engines. A hostile
   PDF's JavaScript still runs inside the viewer under any policy, sandbox included. It made
   no request, and it is the viewer's to confine.
2. *Every destination was served (low, older than this issue).* Code destinations are now
   refused for every kind, with tests for a photo and a PDF.
3. *Wording (info).* The policy comment, test titles and PLAN decision 27 now state measured
   facts.
4. *Player exemption not tied to kind (info).* A cors-mode `video`/`audio` load is answered
   only for a sound or a video.
5. *A test restated the policy directive by directive (info).* Removed. The full-chain test
   compares the header to `PDF_POLICY`.
6. *A literal U+FEFF in a test (info).* Escaped.
7. *Offset-0 strictness unrecorded (info).* It is recorded in PLAN decision 3 and above.
8. *Header chain (info).* Verified clean. No change needed.
9. *Content-Length and viewer range requests (info).* The whole file streams with no
   Content-Length, so neither viewer asked for a range in any lab run, a slow 4.8 MB stream
   included. `serve-route.ts`'s header comment already records why no length is sent.
10. *`typedKind` maps `text/html` to a document (info).* A document that isn't
    `application/pdf` downloads, so an unknown type falls to the safe side. The server never
    admits HTML.

**Builder and client.**
1. *Only a PDF is ever probed (medium, bites in 06).* Design lint now probes every further
   document type automatically. A test fakes a second type and catches a card that draws it.
   06's criteria now require its own proof.
2. *The scratch name and type could drift (low).* The name's extension is derived from the
   type's admission row, with a test for every family.
3. *The frame check worked per card, not per field (low, older than this issue).* It is now per
   field, with a test for a document framed beside a photo field.
4. *Weak assertions (low).* The frame tests assert the message, and the few-shot test checks
   every family in a combination.
5. *Widening to `document` doesn't regenerate the card (info, 7.4/01's).* 7.4/01's criterion
   now names that widening.
6. *The frame message named both kinds (info).* It names the kind the probe holds.
7. *Stale comments (info).* Fixed, and the Gate's noun table `satisfies Record<FileFamily, string>`.
8. *Comment lines over 100 columns (info).* Reflowed.
9. *Wording for 06's downloads (info).* It is now "opens or downloads it", and the pantry
   line no longer says "as a PDF".
10. *The frame and null-note rules overlapped (info).* The frame rule is scoped to fields that
    may hold a photo or a video.
11. *The manual tile emitted an empty span (info).* It is guarded now.
12. *`kindOf` and `file-list.js` (info).* `kindOf` reads a document's type. 7.2/07's criteria
    now require list entries to carry the verified `mime`.
13. *A substring test on the rule (info).* Trimmed to the elements the rule must forbid.
14. *Prompt length (info).* A card whose field takes all four families grows from 14.7k to
    18.1k characters. Only that mix pays it, and each exemplar is what keeps a document or a
    sound from being drawn as a picture.

## Verification

**Checks.**
- `bun run typecheck` and `bun run lint` are clean.
- `bun run test` passes 4120 of 4120.
- New tests:
  - `upload-route.document.test.ts` reads a PDF's headers after `createApp`'s full chain, with
    the policy, `nosniff`, `x-frame-options` and `referrer-policy`.
  - `admission.document.test.ts`, `file-control.document.test.ts`, and document cases in the
    Gate, prompt and spec suites.

**Lab.** A scratch server mimicked the headers, with headless Chrome 154, a private headless
Firefox 157 and a WKWebView (Safari 26.6.2's WebKit). A 3-page and a 40-page 4.8 MB PDF drew
under:
- the chosen policy;
- the app-wide `object-src 'none'`;
- `default-src 'none'; sandbox`.

Every viewer request was one `navigate`/`document` load.

**Live, on `:3030`.**
- "keep my appliance manuals" built `appliance_manuals` with `manual: file, accepts ["document"]`.
- A 3-page PDF uploaded through the control:
  - The picker offered `application/pdf,.pdf`.
  - The open link read `target="_blank" rel="noopener"`.
- The record saved, and its card says "PDF manual" in words.
- Reopened, the edit form holds `data-holds-type="application/pdf"` and the same link.
- `/files/<key>` answered 200 with the PDF policy, `nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`. A `script` load and an htmx-style fetch answered 404.
- Headless Chrome, headless Firefox and WKWebView each drew all three pages from `:3030`.
- A text file renamed `.pdf` was refused with the document sentence, and the held manual stayed.
- The card prints "null" for empty optional text. That is a generation fault, not a document
  one, and is spun off as its own task.
