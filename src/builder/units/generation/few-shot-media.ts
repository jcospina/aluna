// The few-shot gallery's media exemplars: a photo grid tile, and a feed card whose one file may be a
// photo or a video (Module 7 PLAN decisions 28 and 29). Split from `few-shot-gallery.ts`, which
// injects them with the rest.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.

import { fileUrl } from "../../../platform/files/file-url.ts";
import type { FewShotDesignExample } from "./few-shot-gallery.ts";
import { ESCAPE_HELPER_SOURCE, fields } from "./few-shot-parts.ts";

/** The key the photo exemplar's preview names, served at `/files/<key>` like any stored photo. */
const PREVIEW_PHOTO_KEY = "3f6c1a2e-8b4d-4e7a-9c1f-5d2b7a9e0c41";
/** The keys the walk exemplar's previews name: a video, then a photo. */
const PREVIEW_VIDEO_KEY = "9a1d4c7e-2f5b-4b8a-8e3d-6c0f1b7a2d95";
const PREVIEW_WALK_PHOTO_KEY = "5e2b8f1c-7a3d-4c9e-b6f0-2d8a4e1c7b36";

export const PHOTO_GRID_TILE: FewShotDesignExample = {
  id: "photo_grid_tile",
  title: "Media-forward grid tile",
  layout: "grid",
  suitedFor: "Visual records where the picture should carry the scan pattern.",
  composition:
    "Large square media frame, bold caption, and vivid metadata chips. The picture owns the tile while the text still scans in a responsive grid, and a record without one keeps its frame.",
  notes: [
    "Uses the media-frame primitive, whose own tinted fill gives the box presence without a boundary — the platform draws every line, and nothing inside a window casts a shadow.",
    "Draws the picture from its url with empty alt text, because the title beside it already names the card.",
    "Draws the empty frame with a short note when the photo is null, so a record saved before its picture was added still reads as a tile.",
    "Leaves loading and decoding out: the platform sets both on every picture it serves.",
  ],
  capability: {
    id: "photo_roll",
    noun: "photo",
    label: "Photo roll",
    schema: {
      fields: fields([
        ["photo", "file", false, ["image"]],
        ["title", "string", true],
        ["place", "string", false],
        ["taken_on", "date", false],
      ]),
    },
    form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  },
  previewSamples: [
    {
      record: {
        id: "photo-1",
        photo: {
          url: fileUrl(PREVIEW_PHOTO_KEY),
          name: "IMG_4821.JPG",
          kind: "image",
          mime: "image/jpeg",
          size: 48213,
        },
        title: "Morning market colors",
        place: "Valledupar",
        taken_on: "2026-07-08",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem;">',
        `<img src="${fileUrl(PREVIEW_PHOTO_KEY)}" alt="" loading="lazy" decoding="async">`,
        "</figure>",
        '<span class="text-xl text-bold line-clamp-2">Morning market colors</span>',
        '<div class="cluster gap-1 text-xs">',
        '<span class="text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Valledupar</span>',
        '<time class="text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);" datetime="2026-07-08">2026-07-08</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
    {
      record: {
        id: "photo-2",
        photo: null,
        title: "Workshop wall before launch",
        place: "Bogota",
        taken_on: "2026-07-09",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem;">',
        '<div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">No photo yet</span></div>',
        "</figure>",
        '<span class="text-xl text-bold line-clamp-2">Workshop wall before launch</span>',
        '<div class="cluster gap-1 text-xs">',
        '<span class="text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Bogota</span>',
        '<time class="text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);" datetime="2026-07-09">2026-07-09</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const photo = record.photo as { url: string } | null;",
    "  const title = escapeHtml(record.title);",
    '  const place = escapeHtml(record.place ?? "Unplaced");',
    '  const takenOn = escapeHtml(record.taken_on ?? "");',
    "  const media = photo",
    '    ? `<img src="${escapeHtml(photo.url)}" alt="">`',
    '    : \'<div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">No photo yet</span></div>\';',
    "",
    '  return `<div class="stack gap-2">',
    '    <figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem;">${media}</figure>',
    '    <span class="text-xl text-bold line-clamp-2">${title}</span>',
    '    <div class="cluster gap-1 text-xs">',
    '      <span class="text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${place}</span>',
    '      <time class="text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);" datetime="${takenOn}">${takenOn}</time>',
    "    </div>",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};

export const WALK_MEDIA_FEED: FewShotDesignExample = {
  onlyForFiles: true,
  id: "walk_media_feed",
  title: "Photo-or-video feed card",
  layout: "feed",
  suitedFor:
    "Records whose one file may be a photo or a video, where the file leads and a few words follow.",
  composition:
    "Wide media frame first, then a chip saying what the file is beside the date, then the title and the place. The frame draws a photo or a video by the file's kind, and the chip says which, so the card reads the same whether or not a first frame is drawn.",
  notes: [
    "Draws the file by its kind: an img for a photo and a muted, playsinline video for a video.",
    "Gives the video no controls, autoplay or poster. The card shows the file and the open record plays it, and the platform decides how much of it loads.",
    "Says Video in words, because some browsers, iOS Safari among them, draw no first frame and leave the frame as its tinted well.",
    "Draws the empty frame with a short note when the file is null, so a walk saved without one still reads as a card.",
  ],
  capability: {
    id: "walk_log",
    noun: "walk",
    label: "Walk log",
    schema: {
      fields: fields([
        ["moment", "file", false, ["image", "video"]],
        ["title", "string", true],
        ["trail", "string", false],
        ["walked_on", "date", false],
      ]),
    },
    form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  },
  previewSamples: [
    {
      record: {
        id: "walk-1",
        moment: {
          url: fileUrl(PREVIEW_VIDEO_KEY),
          name: "VID_0213.MOV",
          kind: "video",
          mime: "video/quicktime",
          size: 38_797_312,
        },
        title: "Fog lifting off the ridge",
        trail: "Chicaque",
        walked_on: "2026-08-02",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<figure class="media-frame media-frame--wide w-full" style="margin: 0;">',
        `<video src="${fileUrl(PREVIEW_VIDEO_KEY)}" muted playsinline preload="metadata"></video>`,
        "</figure>",
        '<div class="cluster gap-1 text-xs">',
        '<span class="text-bold" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Video</span>',
        '<time class="text-muted" datetime="2026-08-02">2026-08-02</time>',
        "</div>",
        '<span class="text-xl text-bold line-clamp-2">Fog lifting off the ridge</span>',
        '<span class="text-sm text-muted truncate">Chicaque</span>',
        "</div>",
      ].join(""),
    },
    {
      record: {
        id: "walk-2",
        moment: {
          url: fileUrl(PREVIEW_WALK_PHOTO_KEY),
          name: "IMG_5530.JPG",
          kind: "image",
          mime: "image/jpeg",
          size: 2_411_870,
        },
        title: "Orchids by the second bridge",
        trail: "Quebrada La Vieja",
        walked_on: "2026-08-09",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<figure class="media-frame media-frame--wide w-full" style="margin: 0;">',
        `<img src="${fileUrl(PREVIEW_WALK_PHOTO_KEY)}" alt="" loading="lazy" decoding="async">`,
        "</figure>",
        '<div class="cluster gap-1 text-xs">',
        '<span class="text-bold" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Photo</span>',
        '<time class="text-muted" datetime="2026-08-09">2026-08-09</time>',
        "</div>",
        '<span class="text-xl text-bold line-clamp-2">Orchids by the second bridge</span>',
        '<span class="text-sm text-muted truncate">Quebrada La Vieja</span>',
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const moment = record.moment as { url: string; kind: string } | null;",
    "  const title = escapeHtml(record.title);",
    '  const trail = escapeHtml(record.trail ?? "Off trail");',
    '  const walkedOn = escapeHtml(record.walked_on ?? "");',
    '  const video = moment?.kind === "video";',
    '  const url = moment ? escapeHtml(moment.url) : "";',
    "  const frame = !moment",
    '    ? \'<div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">Nothing added yet</span></div>\'',
    "    : video",
    '      ? `<video src="${url}" muted playsinline></video>`',
    '      : `<img src="${url}" alt="">`;',
    '  const what = !moment ? "No file yet" : video ? "Video" : "Photo";',
    "",
    '  return `<div class="stack gap-2">',
    '    <figure class="media-frame media-frame--wide w-full" style="margin: 0;">${frame}</figure>',
    '    <div class="cluster gap-1 text-xs">',
    '      <span class="text-bold" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${what}</span>',
    '      <time class="text-muted" datetime="${walkedOn}">${walkedOn}</time>',
    "    </div>",
    '    <span class="text-xl text-bold line-clamp-2">${title}</span>',
    '    <span class="text-sm text-muted truncate">${trail}</span>',
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};
