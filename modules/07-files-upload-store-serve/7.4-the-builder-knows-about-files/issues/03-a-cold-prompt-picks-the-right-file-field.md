# A cold prompt picks the right file field

Status: ready-for-agent

Type: HITL — this issue closes Module 7. A human runs cold builds across the four kinds
and the module's whole verify script.

## Epic

Module 7 — Files: Upload, Store & Serve · Epic 7.4 — The builder knows about files
(PLAN decision 5 and the 7.4 epic; ADR-0009: `modules/07-files-upload-store-serve/PLAN.md`)

## What to build

A capability built from a cold prompt chooses a file field when its records hold files,
declares families that make sense, and renders all four kinds without a Gate rejection.

**Few-shot variety across kinds and layouts.** 7.1/06 and 7.2 added one example per kind.
This issue adds variety across layouts: a photo grid, a video card, an audio row, a
document list, and a strip of many files. Worked examples bias the model, and a model
choosing from a closed set collapses to one mode. Balanced examples are needed but are
not enough. Where builds still collapse to one layout, variety comes from a seeded draw
rather than from prompt wording.

**Sensible families.** A recipe box that keeps photos of dishes accepts `image`. A
lecture archive accepts `video` and `document`. A voice-memo list accepts `audio`. The
generator prompt says how to choose, and never asks for every family by default.

## Acceptance criteria

- [ ] The few-shot gallery covers each kind in more than one layout
- [ ] Cold builds for an image, a video, an audio and a document capability each declare
      a file field with sensible families and pass the Gate
- [ ] Repeated builds of one prompt don't all produce the same layout
- [ ] No test calls the real provider
- [ ] **Sign-off gate:** the human has run the cold builds and the full verify script
      below and confirmed Module 7's exit bar
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

This is Module 7's full verify script from `docs/modules.md`. Run `bun run reset` and use
the Aluna running on `:3030`.

1. Build from cold prompts: "keep photos of dishes I cook", "keep my lecture recordings
   and slides", "keep my voice memos", "keep my contracts". Each builds with a file field
   and renders its kind.
2. Build Photos, upload a photo, edit the title, and confirm the photo stays. Replace
   one file, delete another, and force one post-commit failure. Committed bytes render,
   and every abandoned or replaced byte is recovered.
3. Leave a record whose form holds an upload and confirm the warning. Kill the app
   mid-upload, and again mid-form; the next desk load sweeps what each left. Hold an
   upload in one tab, load the desk in a second, and confirm the first tab's save is
   refused with a sentence.
4. Evolve Notes to add a `file` and a `file[]` field, then hide one. Delete Notes
   through its logo menu. Its active and inactive owned keys and its version artifacts
   disappear, and deleting again changes nothing.

## Blocked by

- modules/07-files-upload-store-serve/7.4-the-builder-knows-about-files/issues/01-evolution-adds-widens-and-hides-file-fields.md
- modules/07-files-upload-store-serve/7.4-the-builder-knows-about-files/issues/02-aluna-counts-and-groups-files-by-kind.md
