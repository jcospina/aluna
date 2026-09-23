# Every kind is drawn

Status: ready-for-agent

Type: HITL — `design/` is the product requirement. A human signs off the drawn states
before 7.2's issues build them.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN §"Design work this module owes", decisions 3, 27 and 29; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

7.1/02 drew the control for an image. This issue draws the remaining states in
`design/controls.html`, so that each 7.2 issue builds against a drawing rather than a
guess.

**The filled state for each kind, inside the open record.** A card is a `<button>`, and
the item vocabulary bans `controls`, `<a>` and `href`. The open record is therefore where
a file plays, opens or downloads. Draw these:

- a video with its player, which plays and seeks
- an audio file with its player
- a PDF with an open link
- any other document with its name, size and a download link

Draw the codec fallback too: the download link that stands where the player would be when
the browser refuses a video's codec. A video has no poster, and some browsers draw no
first frame (decision 28), so the video state cannot rely on one.

**The `file[]` list.** A field that holds many files shows them as an ordered list.
Draw adding, removing and the in-flight row. The list-of-strings field's drawn rows are
the precedent.

**Refusals.** Draw the refusal of a family the field doesn't accept and the refusal of a
list at its count cap, in the voice 7.1/02 settled.

Shape follows 7.1/02's control, the token layer and the drawn line, and
`form-controls.css` stays within its ceiling.

## Acceptance criteria

- [ ] Video, audio, PDF and other-document filled states are drawn inside the open record
- [ ] The codec fallback's download link is drawn where the player would be
- [ ] The `file[]` list is drawn with add, remove and an in-flight row
- [ ] The wrong-family and count-cap refusals are drawn in the field
- [ ] Nothing adds boundary styling outside the token layer, and `form-controls.css`
      stays within its ceiling
- [ ] **Sign-off gate:** the human has seen every state and approved the shapes and the
      sentences
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open `design/controls.html` in a browser. Beside 7.1/02's image states are the video,
audio, PDF, document and list states, the codec fallback and the two refusals.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/02-the-photo-control-is-drawn.md
