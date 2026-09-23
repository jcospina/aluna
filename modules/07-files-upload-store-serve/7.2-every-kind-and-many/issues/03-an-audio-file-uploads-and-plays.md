# An audio file uploads and plays

Status: ready-for-agent

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

**The control and the card.** The control's filled audio state from 7.2/01 plays and
seeks in the open record, and shows the download link when the browser refuses the codec.
Audio is served inline under the media policy and plays when opened in a tab of its own.
An audio few-shot example and item-renderer guidance land here. Behavioral tokens gain
`audio`, and the picker's `accept` includes the audio family.

## Acceptance criteria

- [ ] `accepts` can hold `audio`
- [ ] An MP3 with an ID3v2 tag larger than 64 KB is admitted; an MP3 with no frame sync
      after its tag is refused
- [ ] An `.m4a` is admitted as audio by extension and container; the aliases
      `audio/x-m4a` and `audio/x-wav` are not contradictions
- [ ] The control plays and seeks audio in the open record and falls back to a download
      link for a refused codec
- [ ] An audio few-shot example and item-renderer guidance exist; behavioral tokens
      accept `audio`
- [ ] **Sign-off gate:** the human has played an audio file in its own tab in Chrome,
      Safari and Firefox and seeked it inside the record
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

On the Aluna running on `:3030`, type "keep my voice memos". Upload an `.m4a` recorded
on an iPhone and an MP3 with embedded cover art. Both are admitted. Open each record,
play and seek, then open each file in a tab of its own in Chrome, Safari and Firefox.

## Blocked by

- modules/07-files-upload-store-serve/7.2-every-kind-and-many/issues/02-a-video-uploads-plays-and-seeks.md
