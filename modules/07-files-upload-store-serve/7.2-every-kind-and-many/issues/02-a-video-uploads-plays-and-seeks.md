# A video uploads, plays and seeks

Status: ready-for-agent

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
`default-src 'none'; sandbox`, and it plays when opened in a tab of its own. The
control's filled video state from 7.2/01 plays and seeks inside the open record. When the
browser refuses the codec, the control's download link stands where the player would be.

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
headers and `Content-Length`. `ObjectStore.get` (`src/platform/files/object-store.ts`) opens its
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

- [ ] `accepts` can hold `video`, and a candidate that drops a committed family is
      refused in candidate validation
- [ ] MP4, MOV (with and without `ftyp`) and WebM/Ogg video are admitted by container
      and extension; a `.m4a` renamed `.mp4` is judged by its extension's family; a HEIC
      brand is refused
- [ ] Single, open-ended and suffix ranges answer 206 with a correct inclusive
      `Content-Range`; unsatisfiable answers a `no-store` 416; multi-range answers 200;
      `If-Range` and `HEAD` behave as specified
- [ ] A test unlinks a file partway through a response and the response completes
- [ ] The filter sets `preload="metadata"` and strips `autoplay` on players, and
      enforcing twice changes nothing
- [ ] The control plays and seeks a video inside the open record, and shows the download
      link when the codec is refused
- [ ] A video few-shot example and item-renderer guidance exist, and the card doesn't
      depend on a first frame
- [ ] Behavioral tokens accept `video`, and the digest covers it
- [ ] **Sign-off gate:** the human has played a video in its own tab in Chrome, Safari
      and Firefox, seeked it inside the record, and seen the video card on iOS Safari
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, type "keep my home videos". Upload an MP4 and watch the
progress line. Open the record, play the video and drag past the middle; it seeks. Open
the file in a tab of its own in Chrome, Safari and Firefox. Load the desk on an iPhone
and check the video card without a first frame.

## Blocked by

- modules/07-files-upload-store-serve/7.1-one-photo-end-to-end/issues/09-alunas-questions-never-see-a-photos-key.md
- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/01-every-kind-is-drawn.md
