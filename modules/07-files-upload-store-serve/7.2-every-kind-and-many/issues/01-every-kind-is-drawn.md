# Every kind is drawn

Status: done

Type: HITL — `design/` is the product requirement. A human signs off the drawn states
before 7.2's issues build them.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN §"Design work this module owes", decisions 3, 27 and 29; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

7.1/02 drew the control for an image, and with it the control's shape for every kind: a
frame that previews a video with play, pause and the time, and a row for a document or a
sound, with play and pause for a sound (`design/controls.html`, Files). This issue draws the
remaining states there, so that each 7.2 issue builds against a drawing rather than a
guess.

**The filled state for each kind, inside the open record.** A card is a `<button>`, and
the item vocabulary bans `controls`, `<a>` and `href`. The open record is therefore where
a file plays, opens or downloads. Draw these:

- a video with its full player, which plays and seeks, in the record's render view
  (decision 29: the form's control only previews it)
- an audio file with its full player, in the same view
- a PDF with an open link
- any other document with its name, size and a download link

Draw the codec fallback too: the download link that stands where the player would be when
the browser refuses a video's codec. A video has no poster, and some browsers draw no
first frame (decision 28), so the video state cannot rely on one.

**The `file[]` list.** A field that holds many files shows them as an ordered list.
Draw adding, removing and the in-flight row. The list-of-strings field's drawn rows are
the precedent.

**Refusals.** Draw the refusal of a family the field doesn't accept and the refusal of a
list at its count cap, in the voice 7.1/02 settled. 7.1/02 drafted the wrong-kind sentence
for a video, a sound and a document on the page; settle them here.

Shape follows 7.1/02's control, the token layer and the drawn line, and
`form-controls.css` stays within its ceiling.

## Acceptance criteria

- [x] Video, audio, PDF and other-document filled states are drawn inside the open record
- [x] The codec fallback's download link is drawn where the player would be
- [x] The `file[]` list is drawn with add, remove and an in-flight row
- [x] The wrong-family and count-cap refusals are drawn in the field
- [x] Nothing adds boundary styling outside the token layer, and `form-controls.css`
      stays within its ceiling
- [x] **Sign-off gate:** the human has seen every state and approved the shapes and the
      sentences
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Open `design/controls.html` in a browser. Beside 7.1/02's image states are the video,
audio, PDF, document and list states, the codec fallback and the two refusals.

## What landed

Waiting on the sign-off gate; everything else is done.

- **The open record.** The Files section of `design/controls.html` draws four file cards (a
  video with and without a first frame, a sound, a PDF) and the record's render view: the
  form's Open takes the window to it without leaving the record, and its full player plays
  and seeks (`design/scripts/files/file-player.js`). A file the browser won't play shows its
  download link where the player would be, in a drawn region the player's size. From a row,
  a PDF opens in a tab of its own (`rel="noopener"`, chosen by verified type) and any other
  document downloads under its own name (`Presupuesto año.docx`).
- **The `file[]` list** (`design/scripts/files/file-list.js`): rows in pick order, an add well,
  in-flight rows with Stop, Remove, a held save, sound rows that keep playing across
  redraws, positions in every label, and the count cap refused whole before anything
  travels.
- **A field that takes several families** is a frame only when every family fills one
  (C20); `data-kind` takes a list.
- **The refusals**, settled on the page: one wrong-family sentence per family and one for
  several, the renamed-file and password sentences 7.2/06 needs, the list's named
  refusals, the pick-time and save-time count-cap sentences, and "I can’t play … here."
- **Decisions** C18, C19 and C20; one open question: how many files a list holds by
  default (the page uses six).
- The shared markup moved to a leaf, `design/scripts/files/file-parts.js`, because
  `file-field.js` (also the shipped control) was at its line ceiling. Sample files were
  added under `design/assets/media/` and recorded in its README.
- PLAN decision 3 and issues 7.2/02–04 were aligned with the drawing: 7.2/02 builds the
  render view, and the player and the fallback live there rather than in the form's control.

## Adversarial review

Four rounds, every finding fixed. Round one covered code and
design separately. It found a list that kept only its last refusal, stale media listeners
writing into a new player, a stuck seek flag, a ruled seek square, and no drawn cards. It
also found that a single field couldn't take several families, 7.2/06's sentences were
missing, and 7.2/02–03 contradicted the drawing. Round two caught focus loss, the refusal
order, the type-before-extension rule, and a CTA escaping its well at phone width. Round
three found that a reachability probe can't work against the product's `/files` route,
which 404s every page fetch by design. The probe was removed, and the fallback now says one
sentence that claims no cause. It also found WebM/Ogg kinds that ignored the field's
families, refusals re-announced on every redraw, and phone-width overflow. Round four
confirmed those fixes. It found a hint clipped on a field that takes all four families,
which is now hidden by how many families a field names, and one stray failure sentence,
which now matches the rest.

## Verification

`bun run lint`, `bun run typecheck` and `bun run test` (3858/3858) clean;
`form-controls.css` untouched at 500/500. Every state was driven live on `:3030` at
desktop, 375px and 320px: play, seek by pointer and keys, the codec fallback in the
player and the preview, the list's add, remove, stop, cap and refusals, cancel and save,
Back's focus, and the several-families field.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/02-the-photo-control-is-drawn.md
