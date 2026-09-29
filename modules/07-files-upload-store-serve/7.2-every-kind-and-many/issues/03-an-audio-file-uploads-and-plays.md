# An audio file uploads and plays

Status: ready-for-agent — built and verified; the sign-off gate is the only box left

Type: HITL — whether a player plays depends on the browser. A human confirms an audio
file plays in its own tab in Chrome, Safari and Firefox.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.2 — Every kind, and many
(PLAN decisions 1, 2, 3, 5, 27 and 29; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A field can accept audio. An audio file is admitted by its container, and it plays and
seeks in the open record through the Range support 7.2/02 built.

**`accepts` gains `audio`.**

**Admission's audio rows.**

- An MP3 skips its ID3v2 tag, whose length is in its ten-byte header, and looks for a
  frame sync in the 64 KB after it. Embedded cover art often makes that tag larger than
  64 KB, so reading the first 64 KB alone would refuse a good file.
- An `.m4a` is ISO-BMFF with the same `isom` or `mp42` brand a video may carry, so the
  extension names the family and the `ftyp` box confirms the container.
- WebM and Ogg audio follow 7.2/02's rule: the extension names the family.
- The alias table absorbs `audio/x-m4a` and `audio/x-wav`.

The issue records the audio extensions it admits.

**The control and the card.** The control's filled audio state from 7.2/01 previews a
sound with play, pause and the time, and the record's render view 7.2/02 built plays and
seeks it, showing the download link where the player would be when the browser won't play
it.
Audio is served inline under the media policy and plays when opened in a tab of its own.
An audio few-shot example and item-renderer guidance land here. Behavioral tokens gain
`audio`, and the picker's `accept` includes the audio family.

## Acceptance criteria

- [x] `accepts` can hold `audio`
- [x] An MP3 with an ID3v2 tag larger than 64 KB is admitted; an MP3 with no frame sync
      after its tag is refused
- [x] An `.m4a` is admitted as audio by extension and container; the aliases
      `audio/x-m4a` and `audio/x-wav` are not contradictions
- [x] The render view plays and seeks audio, and falls back to a download link when the
      browser won't play it
- [x] An audio few-shot example and item-renderer guidance exist; behavioral tokens
      accept `audio`
- [ ] **Sign-off gate:** the human has played an audio file in its own tab in Chrome,
      Safari and Firefox and seeked it inside the record
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, type "keep my voice memos". Upload an `.m4a` recorded
on an iPhone and an MP3 with embedded cover art. Both are admitted. Open each record,
play and seek, then open each file in a tab of its own in Chrome, Safari and Firefox.

## Blocked by

- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/02-a-video-uploads-plays-and-seeks.md

## What landed

Waiting on the sign-off gate; everything else is done.

- **`audio` is a family.** `FILE_FAMILIES` is `["image", "video", "audio"]`. Widening, the Diff's
  `file_families` fact, candidate validation and the behavioral tokens all took it with no change
  of their own. A behavioral `audio` token posts a pending scratch sound of a type admission
  records.
- **The audio extensions admitted:** mp3, m4a, aac, wav, ogg, oga, opus, webm and flac, the ones
  `design/scripts/file-parts.js` names.
  - MP3 and ADTS AAC (`audio-frames.ts`) have no container. The scan skips every ID3v2 tag without
    holding it, then any zero padding, and there needs a frame whose next frame follows where its
    length says. A rip cut mid-frame may start up to 2 KB on, if four frames then run. At most four
    tags, claiming at most 16 MB between them, may come first. An MP3 behind 152 KB of cover art is
    admitted.
  - M4A: an `ftyp` of any brand but a still image's or QuickTime's, as a video's; the extension
    names the family. WAV: `RIFF`…`WAVE`. FLAC: `fLaC`. Ogg: `OggS`. WebM: the EBML DocType.
  - A FLAC, WAV or Ogg behind an ID3v2 tag is recognized too.
  - The alias table takes `audio/x-m4a`, `audio/x-wav` and the other names systems send for these
    types. An `.m4a` declared `audio/mpeg` is still refused: aliasing it would contradict MP3.
  - Containers are checked and codecs are not: Layer I and II MP3s are admitted, and a
    free-format MP3, which states no frame length, is not.
- **WebM and Ogg: the bytes say sound or picture.** A browser names a picked file's type from its
  extension alone, so every browser declares a `.webm` a video, even one that holds only sound. A
  field that takes one of the two names the family, failing that the declared type does. The
  WebM's Tracks, or the codecs its Ogg streams open with, then say which the file holds, and it is
  recorded as that family when the field takes it and refused when it doesn't. Only a `.webm` or
  `.ogg` name lets the bytes change the family. This replaces 7.2/02's rule that a declared
  `audio/` type on a `.webm` or `.ogg` names the family. PLAN decision 3 says so.
- **Serving.** Audio carries the player policy, `default-src 'none'; media-src 'self'; sandbox
  allow-same-origin`, like video, with the Range support 7.2/02 built.
- **The control and the render view** needed no product change: 7.2/01 drew the audio row and
  7.2/02 built the render view for either player. The server now draws `data-kind="audio"` and
  offers the audio types and extensions to the picker. The refusal copy says "an audio file", as
  `design/controls.html` does.
- **The builder.** The spec and candidate prompts may declare `audio` for sounds. The item renderer
  is told a card never draws a sound: it says "Audio" in words and draws no player and no frame,
  since a card is a button (PLAN decision 29, now saying so). Two exemplars teach it, a voice memo
  feed card and a voice memo tile, and exemplars now reach only cards that show a family they draw.
  Design lint refuses a card that draws a sound in any element, and a frame on a card that shows
  only sounds.

## Findings from adversarial review, all fixed

Three rounds. Round one reviewed the server and the builder and client separately.

**The server (round one).**
- **MEDIUM.** Two frames anywhere in the window admitted 456 of 677 dylibs, and icons, fonts, AIFFs
  and a PDF, as MP3. The frames must now start where the sound does.
- **MEDIUM.** Every browser declares a picked `.webm` a video, so an audio field refused every one
  though its picker offered it. The bytes now say sound or picture, as under What landed.
- More aliases; a FLAC, WAV or Ogg behind a tag; several tags in a row; tests that let four ID3
  guards be removed unnoticed; a polyglot served inert, now tested; the tag bound documented.

**The builder and the client (round one).**
- **MEDIUM.** Every probe file shared one address, so a card with two file fields turned the kind
  check off. Each field's probe key is now its own.
- **MEDIUM.** The item prompt told an audio card both to draw an empty frame and to draw none.
- Media exemplars reached families they don't draw; the voice memo exemplar said "Audio" for a
  record missing the field; the audio control and render view had no tests (a double now models
  `signal`); an entity-encoded address and a name ending in `.jpg` got past design lint; PLAN
  decision 29 didn't say what the rule cited it for; tests restated copy; comments were stale or
  wide.

**Round two.**
- **MEDIUM.** A body of chained empty ID3 tags cost 22 s of CPU at the size cap and was refused only
  at its end. At most four tags, claiming at most 16 MB, may come first.
- A TrackType was read as one byte; any file could switch family, not only a `.webm` or `.ogg`;
  Tracks past 16 KB and a Vorbis stream opening before Theora gave the wrong family; zero padding
  hid a FLAC behind a tag; an MP3 cut mid-frame was refused, now found up to 2 KB on if four frames
  run; a sound-only grid card was taught only the photo tile, which lint then refused; the frame
  check ran per card rather than per record; percent-encoding and case got past lint; the double
  removed a listener re-added after its signal's.

**Round three** swept 6,945 non-audio files and 1,703 real sounds, including Chrome and Firefox
recordings. None of the non-audio files was admitted, and every real sound was, except videos
correctly refused.
- **MEDIUM.** The behind-a-tag path took any container at any offset, and no tag was needed: a video
  WebM behind a tag reached a mixed field as a video. Only a FLAC, WAV or Ogg is now recognized, and
  only behind a tag it really has.
- A bad `%`, a tab, a backslash or a dot segment in an address got past lint; the 64 KB head was
  copied on every chunk; the tag loop went on after giving up; tests restated the scan's limits; a
  doc comment and the tile's sample records were stale.
- **Not changed, as intended.** A WebM video named `.mp3` in a field that takes video is refused as
  not accepted: only a `.webm` or `.ogg` name lets the bytes change the family, and every refusal
  reads the same sentence.

**Left to 7.2/04.** A recorder's WebM has no duration, so its player can't seek; 7.2/04 records it
as an owner decision.

## Verification

- `bun run typecheck`, `bun run lint` and `bun run test` (4001 tests) clean. A mutation run of
  `audio-frames.ts`, before rounds two and three changed it, killed or timed out 207 of 208
  mutants; the survivor is an unreachable fallback the type system requires.
- Admission over the files on this machine: 1,503 real MP3s, M4As and WAVs admitted, and none of 702
  dylibs, fonts, icons, PDFs, AIFFs and archives named `.mp3`. The Steam WebMs are recorded as video
  and refused by an audio-only field.
- Live on `:3030`, with a "Voice memos" capability built from the prompt bar ("keep my voice memos:
  each one is a thought I recorded, with a short title"). It declared a Recording field that takes
  audio, and its card reads the title and "Audio", with no player and no frame.
  - Uploaded through the control's picker: an MP3 behind 152 KB of cover art, an `.m4a` declared
    `audio/x-m4a`, a WebM Chrome's MediaRecorder recorded, declared `video/webm` as a picked file
    is, and a WAV the browser can't decode. All were admitted as their containers. A JPEG named
    `.mp3` was refused with "That isn’t an audio file I can play here. Mind picking a different
    one?".
  - The preview played. The render view played, seeked by its line to 2.2 s over 206 answers, and
    played on from a seek. Back returned to the form with the keyboard on Open.
  - The WAV showed "I can’t play this audio file here." and the download link in the player's
    place, and its preview dropped its toggle.
  - Each file answers inline as its recorded type under the player policy, with Range and
    `nosniff`; a script's fetch gets 404.
- Safari, Firefox and a sound opened in a tab of its own are the sign-off gate's. The Browser pane
  can't open a file in its own tab.
