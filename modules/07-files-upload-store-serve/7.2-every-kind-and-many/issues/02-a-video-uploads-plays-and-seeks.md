# A video uploads, plays and seeks

Status: done — signed off by the owner on 2026-10-02

Type: HITL — whether a player plays depends on the browser. A human confirms a video
plays in its own tab in Chrome, Safari and Firefox, and that the video card holds up on
iOS Safari.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN decisions 1, 3, 5, 23, 25, 27, 28 and 29; ADR-0009:
`modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A field can accept video. A video is admitted by its container, and it plays and seeks
inside the open record. The Range support this needs lands here, and the audio issue
reuses it.

**`accepts` gains `video`, and a family can't be taken away.** The family enum grows by
`video`. Widening `accepts` is ordinary evolution. Narrowing is refused in candidate
validation, next to `choiceOptionIssues`, because stored files would fall outside the
field. Regenerating the renderer when `accepts` widens is 7.4/01's.

**Admission's video rows.**

- An `ftyp` box confirms ISO-BMFF, and the extension names the family. Many `.m4a` files
  carry the same `isom` or `mp42` brand as a video, so the brand alone can't decide.
- A `.mov` may carry no `ftyp`, and is recognized by its first atom.
- WebM and Ogg hold audio or video alike. The extension names the family and the
  container confirms it.
- A HEIC or HEIF brand is still refused whatever the extension.
- The declared-type alias table grows for video.
- Containers are checked and codecs are not.

The issue records the video extensions it admits.

**Range requests are built by hand.** Bun 1.3.12 answers every Range request on a
`Bun.file` response with a 200 and the whole body. Without Range, `<video>` cannot seek,
and Safari won't play at all.

- `/files/:key` sends `Accept-Ranges: bytes`.
- A single, open-ended or suffix range gets a 206 with `Content-Range`. That header's end
  is inclusive, and `Bun.file().slice()`'s end is exclusive.
- An unsatisfiable range gets a `no-store` 416 with `bytes */size`.
- A multi-range request falls back to a 200.
- `If-Range` is checked against a strong ETag, which can be the key itself.
- `HEAD` gets the same headers.
- A 206 carries the same immutable caching as a 200.

**The serve route proves open-then-stream.** It opens the file while holding its read
token and releases the token before the body streams. An open file keeps streaming after
it is unlinked. Bun 1.3.12 opens a `Bun.file(path)` body only at send time, so this issue
proves the path against a concurrent unlink. A long video must keep streaming after its
bytes are unlinked partway through a response.

**Video plays inline, and plays in the record.** A video is served inline under
`default-src 'none'; sandbox`, and it plays when opened in a tab of its own. This issue
builds the record's render view drawn in 7.2/01 (`design/controls.html`, Files, "Inside
the open record"; C18): the control's filled video state previews it, its Open takes the
window to the render view without leaving the record, and the full player there
(`design/scripts/files/file-player.js`) plays and seeks. When the browser won't play the file,
the download link stands where the player would be, and the form's preview drops its play
control and says why. A WebM or Ogg file's declared `video/` or `audio/` type names its
family; failing that, a field that takes only one of the two does, and failing both, the
extension's usual family does (`.webm` video, `.ogg` audio).

**The HTML filter and the card.** The platform filter puts `preload="metadata"` on a
player and strips `autoplay`, so no generated template can forget them. Module 7 makes
no posters and no derivatives, so the video card is written not to depend on a first
frame. The item-renderer guidance and a video few-shot example teach this. The builder
may declare `video`, behavioral tokens gain `video`, and the picker's `accept` includes
the video family.

**What 7.1/03 left for widening.** Until this issue maps a widening, the Diff's residual
check keeps a committed field's `accepts`, so any change to it fails closed as an unmapped
difference. Candidate validation already freezes `accepts` on a hide, as it freezes
`max_length`, but nothing could test that with one family; prove it here once `video`
exists. The create and update behavioral inputs carry `accepts`, so a widening moves those
suites' digests. `familiesSchema` in `src/registry/fields/file.ts` puts `accepts` in the
enum's order, and `file.test.ts` proves that over four families.

**What 7.1/07 landed for this issue.** The serve route already opens the file under its read
token and releases the token before the body streams, and `HEAD` already answers with the
headers and `Content-Length`. `ObjectStore.get` (`src/platform/files/store/object-store.ts`) opens its
own descriptor, and "keeps streaming an object opened before it was deleted" in
`object-store.test.ts` proves open-then-stream against an unlink. What is left for Range:
`OpenedObject` reads from byte 0, so `get` needs a start and a length, read from that descriptor
rather than from `Bun.file().slice()`. Bun sends a stream body chunked whatever `Content-Length`
the route states, so a 206 must be checked on a real socket, as the 200 is. Bun also drops a
response whose client has already gone without cancelling its body, so the route closes the file
on the request's abort itself, and a 206 must keep doing so. And a body that errors partway still
ends cleanly on the wire, so a range whose read fails arrives looking whole: the size the route
checks before it answers is the only guard.

## Acceptance criteria

- [x] `accepts` can hold `video`, and a candidate that drops a committed family is
      refused in candidate validation
- [x] MP4, MOV (with and without `ftyp`) and WebM/Ogg video are admitted by container
      and extension; a `.m4a` renamed `.mp4` is judged by its extension's family; a HEIC
      brand is refused
- [x] Single, open-ended and suffix ranges answer 206 with a correct inclusive
      `Content-Range`; unsatisfiable answers a `no-store` 416; multi-range answers 200;
      `If-Range` and `HEAD` behave as specified
- [x] A test unlinks a file partway through a response and the response completes
- [x] The filter sets `preload="metadata"` and strips `autoplay` on players, and
      enforcing twice changes nothing
- [x] The record's render view plays and seeks a video, and shows the download link where
      the player would be when the browser won't play it
- [x] A video few-shot example and item-renderer guidance exist, and the card doesn't
      depend on a first frame
- [x] Behavioral tokens accept `video`, and the digest covers it
- [x] **Sign-off gate:** the human has played a video in its own tab in Chrome, Safari
      and Firefox, seeked it inside the record, and seen the video card on iOS Safari
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, type "keep my home videos". Upload an MP4 and watch the
progress line. Open the record, play the video and drag past the middle; it seeks. Open
the file in a tab of its own in Chrome, Safari and Firefox. Load the desk on an iPhone
and check the video card without a first frame.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/09-alunas-questions-never-see-a-photos-key.md
- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/01-every-kind-is-drawn.md

## What landed

Signed off by the owner on 2026-10-02.

- **`video` is a family.** `FILE_FAMILIES` is `["image", "video"]`. Candidate validation refuses a
  candidate that drops a committed family, whatever the lifecycle (`fileFamilyIssues`, beside
  `choiceOptionIssues`), and a hide still freezes `accepts`. The Diff maps a widening to a
  `file_families` fact: platform work `file_admitted_families` and the create and update suites,
  whose inputs carry `accepts`. No Handler regenerates, because the families never reach a
  Handler's prompt. The renderer's regeneration is still 7.4/01's. `diff-engine.ts` bought its room
  by moving three key helpers to `diff-keys.ts`.
- **Admission's video rows** (`admission.ts`, byte tests in `container-signatures.ts`). The video
  extensions admitted are mp4, m4v, mov, webm, ogv and ogg.
  - MP4 and M4V: an `ftyp` box of any brand but a still image's (HEIF, AVIF, JPEG XL and their kin)
    or QuickTime's. A renamed `.m4a` is admitted as `video/mp4`, by its extension.
  - MOV: the `qt  ` brand, or a first atom a movie opens with, whose size an atom can have and
    which fits the bytes that arrived.
  - WebM: the EBML header walked to a DocType of `webm`.
  - Ogg: `OggS`.
  - A declared `audio/` type on a `.webm` or `.ogg` names the audio family and is refused. A bare
    `application/ogg` names none. The alias table takes `video/x-m4v` and `video/x-quicktime`.
  - A field of several families refuses with the sentence that names them all, and keeps.
- **Range, by hand** (`byte-range.ts`, `serve-route.ts`).
  - Every answer sends `Accept-Ranges: bytes` and the key as a strong ETag.
  - A single, open-ended or suffix range answers 206 with an inclusive `Content-Range`, capped at
    4 MiB and read whole from the descriptor opened under the read token. Bun then sends its length,
    and a failed read answers 404 instead of arriving short.
  - An unsatisfiable range answers a `no-store` 416, but only once the file has opened at its
    recorded size. A list of ranges, a range this grammar can't read, and a stale `If-Range`
    answer 200.
  - `HEAD` ignores Range.
  - `ObjectStore.get` takes a span.
  - The whole-file 200 still streams from the opened descriptor, and a test unlinks a 40 MB file
    partway through that response.
- **Serving a video in a tab of its own.** Chrome opens a video in a tab as a page of its own that
  fetches the file again in cors mode, as a video, so the issue's `default-src 'none'; sandbox`
  could not play there. Video carries `default-src 'none'; media-src 'self'; sandbox
  allow-same-origin`, and the route lets a cors-mode request through when its destination is a
  player. PLAN decisions 25 and 27 say so.
- **The HTML filter.** Every `<video>` and `<audio>` gets `preload="metadata"`. `autoplay` and
  `poster` left the card vocabulary, so neutralizing strips them and design lint flags them. A
  caption track that names a served file loses its `src`.
- **The record's render view** (`public/records/file-render-view.js`, C18). A held video's Open puts the
  form out of sight (`[data-file-viewing]`), pauses its preview, and mounts
  `design/scripts/files/file-player.js` under a way back that names the record: its title, drawn by the
  server as `data-record-title`, or "New" and its noun on a create. Back restores the form as it
  was and returns the keyboard to the Open. A file the browser won't play shows the download link
  where the player would be. In a short window the picture gives up height, so the controls stay
  in reach.
- **The drawn control in the product.** The server draws every family in `data-kind`, the picker
  offers each family's types and extensions, and an edit carries the held file's verified type. An
  upload's answer hands the control the verified kind and type. `.btn--outline` in
  `public/css/components.css` honours the design's `--btn-fill` hook, so the preview's play
  control is paper-filled as drawn (it rendered unfilled until then).
- **The builder.** The spec and candidate prompts may declare `video` and say when to take both.
  The item renderer is told how to draw each family a shown field takes: a video as a
  `<video muted playsinline>`, no controls, autoplay or poster, with a word saying it is a video,
  because some browsers draw no first frame. A photo-or-video feed exemplar (`few-shot-media.ts`)
  reaches only cards that show a file. Design lint reviews every family a shown field takes, and
  refuses a card that draws a video with `<img>` or a photo with `<video>`.

## Findings from adversarial review, all fixed

Three rounds. Round one reviewed the server and the client separately.

**The server (round one).**
- A `.ogg` from Chrome declares `audio/ogg`, and Linux declares `application/ogg`; both were
  refused as a contradiction. A bare Ogg type is now no claim. A declared `audio/` type names the
  audio family, as the issue says, so Chrome's `.ogg` is refused for a field that takes only
  video. The picker offers `.ogv` rather than `.ogg` (round three).
- No 206 carried a length, not even Safari's 2-byte probe. Spans are now capped and read whole.
- `HEAD` honoured Range.
- More HEIF-family brands, then Canon's `crx `, were admitted as video named `.mp4`.
- The QuickTime first-atom test admitted `<!--free…` HTML named `.mov`.
- The WebM test was a byte scan: a decoy passed a Matroska, and a two-byte DocType size was
  refused.
- A 416 answered without the read token.

**The client, the filter and the prompts (round one).**
- Design lint passed a card that draws a video with `<img>`.
- A preview left playing kept playing under the render view.
- The title and render-view code had no tests.
- The render view's Back fell back to the same label as the collection's Back.
- `poster`, `autoplay` and a served-file caption `<track>` passed design lint.
- The new exemplar reached text-only cards.
- Titles were clipped inside an emoji.
- The render view hid nothing, because the form's `display: flex` beat `hidden`. The live check
  found this too.

**The live check.**
- The preview's play control rendered unfilled, because the product's `.btn--outline` flattened
  the design's `--btn-fill`.
- A video opened in its own tab could not play in Chrome, for the reason under What landed.

**Round two.**
- **HIGH.** Letting a player's cors-mode load through, while the answer still varied only on the
  mode, let a Handler's `<video crossorigin>` cache a polyglot that a later htmx request was then
  served from the cache. Alpine ran it. Every answer now varies on `sec-fetch-mode, sec-fetch-dest`,
  and the Handler scrub removes `crossorigin`.
- **INFO.** The fill-hook setters are now pinned by policy. Zero-padded DocTypes are admitted.
  Refusal reasons are consistent. A suffix longer than the cap keeps its end. The noun's capital
  is locale-free. Why the photo exemplar stays unmarked is written down.

**Round three** re-ran round two's repro against the fixes in headless Chrome and Firefox. The HIGH
is closed, and restoring the old `Vary` leaks again in both, so the harness catches it.
- A video field's picker offered `.ogg`, which Chrome declares a sound. It now offers `.ogv`.
- A test now pins that a script's conditional request is refused before anything could answer
  304 with a player's copy.
- The fill-hook policy also reads scripts and pages.
- Four comments ran past 100 columns.
- **Put to the human, not changed here.** Aluna answers any Host name. A page on a plain-http name
  pointed at 127.0.0.1 sends no `Sec-Fetch-*` headers, and both this route and the writing-route
  guard serve a request without them, which is a documented choice. A Host allowlist is offered as
  a separate task.

**Open for the human, not fixed.** A `qt  ` QuickTime is recorded and served as
`video/quicktime`. Chrome shows nothing for that type in a tab of its own, and Firefox may refuse
it in a player; serving it as `video/mp4` is a product call. The design's card reads "Video · 0:18",
but the projection carries no length, so the card guidance teaches "Video" alone.

## Verification

- `bun run typecheck`, `bun run lint` and `bun run test` clean.
- Live on `:3030` with a "Family moments" capability built from the prompt bar. Its field accepts
  `["image","video"]`, and its generated card draws a muted `playsinline` video with a "Video" chip.
  - Uploaded, through the control's own picker, an MP4, a real QuickTime `.mov`, a Chrome-recorded
    WebM, a photo, and the design's unplayable `.mov`. Every one was admitted as its container.
    A JPEG renamed `.mp4` and a `.mkv` were refused with "That isn’t a photo or a video I can keep
    here. Mind picking a different one?"
  - Opened the render view from a create ("New moment") and from an edit ("Her first steps").
    Played, dragged the line to 0:11, and stepped by keys. Back returned focus to Open, with an
    unsaved title edit intact.
  - The unplayable file showed "I can’t play this video here." and the download link in the
    player's place. Its preview dropped its play control.
  - The cards read by their well and the "Video" chip where no first frame is drawn, at 1200px
    and at 375px.
  - A 2-byte probe answers `Content-Length: 2` on the wire.
- Headless Chrome, with a throwaway profile, played and seeked the MP4 opened in a tab of its own
  through `:3030` (18.4 s, 960 px, a frame drawn after the seek). The Browser pane can't show this:
  it blocks a sandboxed page's media request. Chrome shows nothing for `video/quicktime` in its own
  tab, though its `<video>` plays the same bytes. Safari, Firefox and iOS are the sign-off gate's.
