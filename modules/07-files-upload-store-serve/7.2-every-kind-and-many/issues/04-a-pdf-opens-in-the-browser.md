# A PDF opens in the browser

Status: ready-for-agent

Type: HITL — the app's security headers can blank a browser's PDF viewer, and only a
real browser shows that. A human opens a PDF in Chrome, Safari and Firefox.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN decisions 1, 3, 5, 27 and 29; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A field can accept documents, and a PDF opens in the browser from the open record. The
other document formats download, which is 7.2/05's work.

**`accepts` gains `document`.** Admission gets its PDF row, and the issue records the
extension it admits.

**A PDF carries a policy of its own.** The app-wide `object-src 'none'` is reported to
blank Chrome's PDF viewer, so `/files/:key` serves a PDF inline under a policy that lets
the viewer draw and still runs no script from our origin. This issue proves the policy
through the app's full header middleware, not the route alone, because a header added
later in the chain is what blanks the viewer. Every response still carries `nosniff`.

**The control and the card.** The control's filled document state from 7.2/01 opens a PDF
from the open record through a link carrying `rel="noopener"`. A document few-shot example
and item-renderer guidance land here, and 7.2/05 reuses them. Behavioral tokens gain
`document`, and the picker's `accept` includes `.pdf`.

## Acceptance criteria

- [ ] `accepts` can hold `document`, and a PDF is admitted by its signature
- [ ] A file renamed `.pdf` that isn't a PDF is refused mid-stream
- [ ] A PDF is served inline under its own policy, with `nosniff`, and a test reads the
      headers after the full middleware chain has run
- [ ] The open link in the record carries `rel="noopener"`
- [ ] A document few-shot example and item-renderer guidance exist; behavioral tokens
      accept `document`
- [ ] **Sign-off gate:** the human has opened a PDF from a record in Chrome, Safari and
      Firefox, and each viewer drew the document
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, type "keep my appliance manuals". Upload a PDF, open the
record, and follow its open link. The PDF draws in the browser's viewer in Chrome, Safari
and Firefox.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/09-alunas-questions-never-see-a-photos-key.md
- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/01-every-kind-is-drawn.md
