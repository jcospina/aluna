# The photo control uploads, previews and saves

Status: ready-for-agent — built and verified; the sign-off gate is the only box left

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

What 7.1/05 landed for this issue. An edit posts the field's presence marker and one value:
the key the record holds, which keeps it, `""` when it holds none, a pending key, which
replaces it, or `FILE_CLEAR_VALUE` (`src/runtime/data/index.ts`), which clears it. An empty
value never clears. The browser script cannot import that constant, so the server-drawn
control should carry it in its markup (from `src/presentation/controls/file-control.ts`)
rather than have `public/` restate it. An edit whose value no longer matches what the record
holds, because another tab replaced, cleared or added a photo, is refused as
`record_changed` with a platform sentence, retargeted to the edit form's error region with
`data-error-fields` naming the field. A replace or a clear is not checked that way: one
posted from a stale form gives up whatever the record holds now (see 7.3/01's note).

**The card shows the photo.** Photos' item renderer from 7.1/06 draws the saved photo
through the projection's `url`.

**The required rule lifts here.** 7.1/03 refuses `required: true` on a file field
(`validateFileFields` in `src/registry/fields/file.ts`), because its stand-in
(`src/presentation/controls/file-control.ts`) has nothing to fill. The drawn control can
fill one, so this issue removes the refusal and proves that a required photo refuses a save
without one. The stand-in carries `data-file-stand-in`, not the drawn control's
`data-file-field` mount hook.

**What 7.1/07 landed for this issue.** The control posts the raw file to
`fileUploadPath(capabilityId, incarnationId, field)` (`src/server/files/upload-route.ts`), with
`encodeURIComponent(file.name)` in `X-File-Name` and the file's own type as `Content-Type` (blank
is fine). An admitted file answers 201 `{ key, url, name, kind, mime, size }`: the form posts `key`
as the field's value, and the preview draws `url`. A refused one answers 415 with
`{ refusal, message }`, where `refusal` names the stage (`extension`, `declared_type`,
`signature`, `not_accepted`) and `message` is the field's sentence from
`src/platform/files/refusal-copy.ts`. An upload whose bytes a sweep took first answers 409 with
`refusal: "gone"` and the add-it-again sentence. A 404 has no body: the capability, its
incarnation or the field is gone. Aborting the request deletes the staged file; an abort after
the row committed leaves the row `cleanup_enqueued`.

A file over the cap never gets the route's own 413. `XMLHttpRequest` declares the length, and Bun
refuses a declared length over `maxRequestBodySize` (the file cap) before the app runs, with an
empty 413, or a network error (status 0) when it closes the connection mid-send. The control
therefore compares `file.size` with the cap before sending, reading the cap from markup the
server draws (`resolveMaxFileBytes`), and shows `oversizeSentence(cap)` itself. It maps a bare 413,
or status 0 on a file over the cap, to the same sentence.

## Acceptance criteria

- [x] The control shows the empty, filled, progress and refusal states drawn in 7.1/02,
      in create and in edit
- [x] Picking a photo uploads it with `XMLHttpRequest`, and the progress line moves with
      `upload.onprogress`
- [x] The preview's source is the pending key's `/files/` address
- [x] A non-image renamed `.jpg` is refused mid-stream, and the sentence appears in the
      field in a real browser
- [x] The picker's `accept` covers the image family and leaves out `image/heic`
- [x] Save is disabled while any upload is in flight
- [x] Picking another photo mid-upload aborts the first request, and no staged file
      remains
- [x] Save claims the photo (`owned`), an edit that doesn't touch the field keeps it,
      replacing enqueues the old key, and clearing empties the field
- [ ] **Sign-off gate:** the human has run the done-when steps below and confirmed the
      control matches `design/controls.html`
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

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

## What landed

**The host the server draws.** `src/presentation/controls/file-control.ts` replaces the stand-in
with the drawn control's mount, `<div class="field file" data-file-field data-kind="image">`, in
create and in edit. It carries what the browser cannot know: the upload address
(`fileUploadPath`, now in the leaf `src/platform/files/upload-path.ts`), the types the picker
offers (`data-file-accept`, from `admittedTypes(kind)` in `admission.ts`, so the image family and
never HEIC or HEIF), the cap and its sentence (`resolveMaxFileBytes`, `oversizeSentence`), and on
an edit the file the record holds (`data-holds-name`, `-size`, `-src`, drawn only from a whole
projection). The field posts its presence marker and a hidden value that opens as the held key or
`""`, and carries `FILE_CLEAR_VALUE` and `data-file-required` for the browser to read.
`RenderableCapability` gains `incarnationId`, set by `renderableFromRow`. A spec rendered for the
Gate has none, so its control has nowhere to send a file. A form holding a file field gets a held
save (`data-held-save` and its label span, `src/presentation/controls/submit-button.ts`).

**The browser half.** `public/file-field.js` mounts `design/scripts/file-field.js` on every host
that arrives and hands it an `XMLHttpRequest` transfer. The transfer refuses a file over the cap
before a byte leaves. It sends the raw file with `X-File-Name` (`FILE_NAME_HEADER`, now shared
through `public/shell-dom.js`) and the file's own type, drives the progress line from
`upload.onprogress`, and settles 201 into the held file, 415 and 409 into their sentences, and a
bare 413, or a severed send of a file over the cap, into the size sentence. A field leaving the
page aborts its upload through the region release. The design control now says each change of state
with `file-field:change`. The browser writes the posted value from that event: the key an upload
answered with, the drawn key while the field still holds it, the clear once an edited field holds
nothing, and `""` on a create. A create that is saved or cancelled puts the field back. A
submission is refused while a file travels, and the person is moved to the save that says what it
waits on.

**The rest of the page.** `public/record-mutations.js` writes the busy label into the held save's
label span, freezes file fields (`inert`) while a save is out, and thaws them as soon as a
refusal arrives. `public/field-errors.js` refuses an empty or cleared required photo before the request,
and shares the photo's guidance slot with the control: it restores only what it took and forgets
its verdict when the control re-renders. A refusal naming the photo focuses the photo's own button.
`FIRST_FIELD_SELECTOR` skips hidden inputs and reaches the control, and a record view focuses after
the control mounts. `public/css/fields.css` no longer stretches the 4:3 frame past the design's
22rem.

**The design control.** It now finds its form's save in a `<form>`, hides an empty guidance slot,
takes its picker's types from the host, passes the host to the transfer, describes Replace, Clear
and Stop by the guidance slot, and treats an aborted upload as a Stop.

**A required photo.** `validateFileFields` no longer refuses `required: true`, and the builder's
"never required" line is gone. The mutation interface refuses a create or an edit that would leave
a required file field empty, naming every empty required field in schema order
(`assertRequiredFilesHeld` in `mutation.ts`). It first checks that the create's values are an
object with known keys. The Gate follows. The smoke's second create leaves only optional file
fields out and gives a required one a file of its own. A required field takes only the keep and
replace edits. Behavioral setup rows and saved cases must fill a required photo, the fixture
vocabulary says which fields are required, and a missing-required update posts a photo as `null`.
The Handler prompts say how a required photo goes missing. Dependency rows the Gate seeds get their
required files. The question prompt no longer calls a required column always set.

**Out of this issue's files.** A Handler's fragment loses Alpine directives (`x-*`, `@*`, `:*`),
which the page's Alpine would otherwise run (`fragment-safety.ts`). 7.2/06 and 7.4/01 carry notes
on a required `file[]` and on making a file field required by evolution.

## Findings from adversarial review, all fixed

Two adversarial reviews (the browser side; the server, the Gate and the tests), then a
verification pass over the fixes, which confirmed each and found the seven listed last.

- The smoke's second create reused a key the first cycle had already claimed for a required photo,
  so a capability with a required and an optional file field failed the Gate unrepaired (HIGH). The
  second create mints a file of its own, and a mixed spec passes the smoke.
- A behavioral setup row could seed a required photo empty, which the save refuses before any
  Handler runs (HIGH). The vocabulary carries `required`, the prompt says a setup row fills it, and
  the contract refuses such a row, also on a carried suite.
- The prompt told a missing-required update to post an empty string, which a file field refuses
  (HIGH). It says `null` for a file field.
- A case expecting its save to succeed could leave a required photo empty (MEDIUM). The contract
  refuses it and the prompt says so.
- The create Handler was never told how a required photo goes missing (MEDIUM). Its prompt says:
  `null` or absent, never through the scalar extractor.
- The contract change had no test (MEDIUM). `gate-behavioral-file.test.ts` covers it.
- The required-file check ran before the create's values were validated, so a malformed create
  threw a `TypeError` or asked for a photo (MEDIUM). Validation runs first.
- A server refusal naming the photo could not focus it, because the field was still `inert` when
  htmx swapped the refusal in (MEDIUM). The fields thaw on `htmx:beforeSwap`.
- Replace, Clear and Stop were not described by the guidance slot, so a relocated refusal went
  unread (MEDIUM). They are.
- The control's own `is-invalid` looked like a field-errors verdict: a refused pick lost its
  sentence to any later answer and took focus from a missing required field (MEDIUM).
  `field-errors.js` owns only what it stashed.
- A large non-image might lose its 415 to a reset connection (hypothesis, MEDIUM). Checked live: a
  20 MB and a 50 MB text file named `.jpg` were refused at 0% with the photo sentence.
- A held file's size and name were drawn unchecked from the presented record (LOW). Only a whole
  projection is drawn, escaped.
- The form's cap and the route's could differ in an app built with its own `maxFileBytes` (LOW).
  The form draws the environment's cap, the one Bun enforces, and says so.
- No test sent a file where the stored capability's form says (LOW). One does, then saves by the key
  that came back.
- A refused save's other pending file was untested (LOW). It stays pending.
- An aborted upload showed the failure sentence (LOW). It is a Stop.
- The submit guard refused silently (LOW). It focuses the held save.
- Stale comments, a re-export through the route, a restated accept list, restated ids and
  attributes in tests, an unsafe record lookup in a test, a caps test missing `file`, an unescaped
  button label, a dependency seeded without its required files, a file name with a lone surrogate,
  a field drawn without its cap, `aria-invalid` on buttons, the question prompt's "always set", and
  the untested browser wiring (INFO). All fixed; the wiring is tested in `file-upload.test.ts` and
  `field-errors.file.test.ts`.
- `postedValue` depended on the design's `saved` (INFO). It depends on what the field holds now.
- A Handler's fragment carried Alpine directives through (INFO, outside this change). They are
  stripped.
- A required photo is not marked `aria-required` (hypothesis). A button and a group cannot carry
  it. The field's label says "optional" when the photo is optional and nothing when it is required,
  and every photo button is labelled by it. The verification pass agreed.
- The new prompt line said a required photo takes a token "in every case", against the rule that a
  missing-record case posts no file and that an update may leave it out (MEDIUM). It says a save
  expected to go through never posts it `null`.
- The thaw also ran on a successful create, so a pick made while the collection refreshed was
  thrown away (LOW). The fields thaw only on a refusal.
- A refused edit scrolled its fields back to the top after focus had moved to the photo, leaving
  the sentence and focus off screen (LOW, older than this issue). The fields stay where focus is.
- Every declared error case was exempt from the required-photo check, not only
  `missing_required_fields` (LOW). Only that one is.
- An empty stored name drew a held photo the control read as none, so an untouched edit would post
  the clear (INFO, unreachable). The server draws such a field empty.
- The setup-row check did not read a row as seeding does (INFO). It uses `fieldValuesToRecord` and
  the save's own `isMissingRequiredValue`.
- An empty accept list would have let the picker offer every file (INFO, for 7.2). The server draws
  no accept list then, and the control falls back to its kind's.

## Verification

- `bun run test`: 3527 passed, 0 failed. `bun run typecheck` and `bun run lint` clean.
- Live on `:3030`, against Personal photos. A picked JPEG uploaded, previewed from
  `/files/<pending key>` and saved `owned`. The card showed it. A title-only edit kept it,
  a replacement moved the old key to `cleanup_enqueued`, and a clear emptied the card. A 490 MB
  pick moved the progress line through 0, 27, 67 and 100 while the save read "I'm waiting on the
  photo…". A 400 MB upload replaced mid-stream left no staged file and no ledger row. A 501 MB pick
  was refused before any request with the 500 MB sentence. A 50 MB text file named `.jpg` was
  refused about 40 ms in, with the sentence under the alert frame. An edit whose photo another
  request had replaced was refused `record_changed`, and focus landed on Replace, described by that
  sentence, with both still in view.
- A real build from the prompt bar, "keep a gallery of my sketches, each one a photo with a title",
  made the photo required and passed every Gate rung. Add without a photo was refused in the
  browser with no request, and focus went to the photo. With a photo it saved. Clearing it on an
  edit was refused the same way, and the route itself answered 422 `missing_required_fields` to a
  clear posted directly. An earlier build, "keep a scrapbook of the pressed flowers I collect",
  failed its behavioral rung on how dated and undated flowers sort, which no file touches.
