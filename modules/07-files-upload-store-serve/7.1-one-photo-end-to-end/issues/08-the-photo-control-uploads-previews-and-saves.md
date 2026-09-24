# The photo control uploads, previews and saves

Status: ready-for-agent

Type: HITL — this issue closes the epic's done-when test, and the control is new
furniture drawn in 7.1/02. A human runs the whole photo round trip and confirms the
control matches the drawing.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.1 — One photo, end to end
(PLAN decisions 1, 8, 16, 19 and 24; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

The form's stand-in becomes the platform upload control drawn in 7.1/02, in create and
in edit. A photo is sent the moment it is picked, shows a progress line while it streams,
previews from its own address, and is claimed when the record saves.

**Sending.** Picking a photo sends it at once through 7.1/07's upload route with
`XMLHttpRequest`, whose `upload.onprogress` drives the progress line. `fetch` with a
`File` body reports no progress. The picker's `accept` lists the image family and leaves
out `image/heic`, so an iPhone converts to JPEG as it uploads.

**The preview proves the round trip.** The filled state draws `<img src="/files/<key>">`
from the pending key. That is the same address the saved card uses, not a local copy.

**A refusal reaches the form mid-stream.** When admission aborts in the first 64 KB, the
field shows the platform sentence drawn in 7.1/02, and this is proven in the browser, not
only in tests. A file over the cap is refused the same way.

**The form cannot be saved while any upload is in flight.**

**Replacing and clearing.** Picking another photo while one is uploading aborts that
request, and the server deletes the staged file. Replacing a filled field posts the new
reference. Clearing posts 7.1/05's explicit clear. An edit that doesn't touch the field
keeps the photo. A finished upload the form displaced or abandoned stays `pending` until
7.3/02 builds the pending-only route. Nothing is lost by that: `bun run reset` clears it,
and 7.3 sweeps it.

**The card shows the photo.** Photos' item renderer from 7.1/06 draws the saved photo
through the projection's `url`.

**The required rule lifts here.** 7.1/03 refuses `required: true` on a file field
(`validateFileFields` in `src/registry/fields/file.ts`), because its stand-in
(`src/presentation/controls/file-control.ts`) has nothing to fill. The drawn control can
fill one, so this issue removes the refusal and proves that a required photo refuses a save
without one. The stand-in carries `data-file-stand-in`, not the drawn control's
`data-file-field` mount hook.

## Acceptance criteria

- [ ] The control shows the empty, filled, progress and refusal states drawn in 7.1/02,
      in create and in edit
- [ ] Picking a photo uploads it with `XMLHttpRequest`, and the progress line moves with
      `upload.onprogress`
- [ ] The preview's source is the pending key's `/files/` address
- [ ] A non-image renamed `.jpg` is refused mid-stream, and the sentence appears in the
      field in a real browser
- [ ] The picker's `accept` covers the image family and leaves out `image/heic`
- [ ] Save is disabled while any upload is in flight
- [ ] Picking another photo mid-upload aborts the first request, and no staged file
      remains
- [ ] Save claims the photo (`owned`), an edit that doesn't touch the field keeps it,
      replacing enqueues the old key, and clearing empties the field
- [ ] **Sign-off gate:** the human has run the done-when steps below and confirmed the
      control matches `design/controls.html`
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

This is the epic's done-when test. Run `bun run reset` and use the Aluna running on
`:3030`.

1. Type "keep track of my photos" and let Photos build.
2. Open the create panel and pick a large photo. Watch the progress line move, then the
   preview appear.
3. Save. The card shows the photo, and its ledger row says `owned`.
4. Edit the record's title and save. The photo is still there.
5. Replace the photo and save. The old key's row says `cleanup_enqueued`.
6. Pick a text file renamed `.jpg`. The field shows the refusal before the upload
   finishes.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/02-the-photo-control-is-drawn.md
- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/07-a-photo-travels-in-and-comes-back.md
