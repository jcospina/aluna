# A cold prompt picks the right file field

Status: done

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

- [x] The few-shot gallery covers each kind in more than one layout
- [x] Cold builds for an image, a video, an audio and a document capability each declare
      a file field with sensible families and pass the Gate
- [x] Repeated builds of one prompt don't all produce the same layout
- [x] No test calls the real provider
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

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

## What landed

- **The layout of a file card is drawn, not left to the model.** Measured first: 20 spec-stage
  probes of the four verify prompts collapsed to one layout per prompt (dishes grid 5/5, memos and
  contracts feed 5/5, lectures feed 4/5). `src/builder/spec/layout-draw.ts` draws `feed` or `grid`
  from the capability's incarnation id (`seedFrom`, ~50/50 over `randomUUID` ids) whenever
  `ui_intent.item.shows` names a file field; a card with no file keeps the model's layout.
  `generateSpec` applies it and takes a required `incarnationId`, threaded from `build-run.ts`.
  The spec prompt names the drawn layout so `item.direction` is written for it, and the build
  sends one last `spec-preview` with the spec that builds. Evolution never redraws.
- **Family guidance.** `FILE_FIELD_PROMPT_LINES` says to name only the families the person's files
  come in, with worked cases on subjects other than the verify prompts (garden journal → image,
  dance log → video, podcast archive → audio + document), more than one only when one file may truly
  be either, and never every family because it seems safe. A birth-only `FILE_FIELD_CARD_LINE` puts
  a kept file on the card; the evolution candidate prompt never carries it.
- **Few-shot gallery.** An exemplar's reach is derived from its own file field (`fewShotExamplesFor`):
  offered when its families cover a shown field's, it takes a picture exactly when the field does,
  and it holds a list exactly when the field does. The hand-set `onlyFor` / `notForOnly` flags are
  gone. New exemplars: a video grid tile (`few-shot-clips.ts`), a `file[]` strip as a feed card and
  as a grid tile (`few-shot-strips.ts`), sound-and-document lists as a feed card and a counting tile
  (`few-shot-lists.ts`), single files of any kind and of sound-or-document as feed cards and tiles
  (`few-shot-mixed.ts`), and a text grid tile. Every set of families a field may take, alone or
  as a list, now has exemplars in both layouts. Optional values in every exemplar are tested for
  `null` and left out, never invented.
- **Gate.** Design lint now probes a list holding one file of each family and each document type,
  and lists of every shorter length, so a card that draws short lists and names long ones is read
  drawing. Probe labels name the field.
- Contrast audit covers the new exemplar files and `few-shot-documents.ts`, whose chip had hidden
  behind an interpolated constant.

## Findings from adversarial review, all fixed

Four rounds (Opus). Round 1:
1. The strip taught an empty frame to sound/document-only lists: reach now derived from picture parity.
2. No grid example for a file list: grid list tiles added; test requires a `file[]` exemplar per layout.
3. Worked family cases replayed the verify prompts: replaced with other subjects.
4. The card line reached evolution prompts: split into the birth-only `FILE_FIELD_CARD_LINE`.
5. `item.direction` written for the model's layout, then overridden: the prompt names the drawn one.
6. The photo tile reached video-only cards: fixed by the derived reach.
7. Incarnation threading untested: `build-run.test.ts` (mutation-checked).
8. Developer panel showed the raw layout: a final `spec-preview` carries the drawn spec.
9. Circular tests: text exemplars derived from schema; weak strip test removed.
10. (User's own edit to this file: the sign-off gate was removed deliberately.)
11. Empty `<time datetime="">` on null dates: every exemplar null-guards dates.
12. `few-shot-documents.ts` escaped the contrast audit: literal tags, registered and claimed.

Round 2:
1. A field taking several families had no correct grid exemplar: derived reach plus the
   any-kind and sound-or-document pairs; Gate test narrows every family set × list.
2. The meeting tile counted non-sounds as documents: counts each kind.
3. The Gate does not check kind words: the cause here (exemplars offered to kinds they mislabel)
   is removed by the derived reach. A language-dependent Gate rule is a design decision, raised
   to the user as its own task.
4. Meeting feed note overclaimed: reworded.
5. Text-exemplar selection was still circular: derived from the schema.
6. Prompt growth: an all-four list card's injection fell from 30.3k to 20.0k characters.
7. Invented placeholders in research note, photo tile and walk feed: null-guarded.
8. No type check over exemplars: every exemplar passes `checkGeneratedUnit` in a test.
9. Sign-off gate: the user's edit.
10. Strip tile: >6 files named in words, empty state without a count, video captioned.

Round 3:
1. The Gate never probed short lists: probes of every length 1–6, with regression tests.
2. Saved-link invented topic and priority: null-guarded, null sample added.
3. Single-file exemplars reached list-only cards: list parity is exact.
4. Strip tile video lacked its word: captioned under the frame.
5. Truthiness checks on optional strings: `=== null`, sample `model: null`.
6. No multi-field test: union test added.

Round 4:
1. One-file lists probed only with the first family: one-file probes for every family and every
   non-PDF document type, with regression tests (mutation-checked).
2. Probe labels collided and said "mixed" of one family: labels name the field and what it holds.

## Verification

- `bun run lint` clean, `bun run typecheck` clean, `bun run test` 4651 passed, 0 failed.
- Mutation checks: removing the incarnation threading, the picture-parity rule, the photo tile
  narrowing, the short-list probes and the one-file probes each turns a test red.
- No test calls the real provider; the spec-stage probes ran as scratch scripts.
- Spec-stage probe after the change, 5 builds × 4 verify prompts: every prompt produced both
  layouts, 20/20 put the file on the card, families sensible (dishes image, memos audio,
  contracts document, lectures audio or video + audio, and document).
- Live cold builds on :3030, all activated through the Gate: bird sightings (image, feed), daughter’s
  football matches (video, grid), phone songs (audio, feed), contracts (document, feed), conference
  talks (video + document, grid), holiday moments (one field of image or video, grid), band gig
  recordings (`file[]` of video and audio, feed), trip albums (`file[]` of image and video). Earlier
  builds of the verify prompts' subjects (cooked dishes, lecture archive, band rehearsal voice notes)
  also activated. Re-running today's design lint over all eight committed renderers passes.
- In the browser, a photo added to Holiday moments draws as a grid tile and one added to Bird
  sightings as a full-width feed card.
