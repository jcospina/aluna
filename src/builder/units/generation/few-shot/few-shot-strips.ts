// The few-shot gallery's strips of many files: one `file[]` of any kind drawn entry by entry, in
// order, each by its kind, as a feed card and as a grid tile (7.4/03).
// Split from `few-shot-gallery.ts`, which injects them.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.

import { fileUrl } from "../../../../platform/files/file-url.ts";
import { FILE_FAMILIES } from "../../../../registry/index.ts";
import type { FewShotDesignExample } from "./few-shot-gallery.ts";
import { ESCAPE_HELPER_SOURCE, fields } from "./few-shot-parts.ts";

const PHOTO_KEY = "6a1e3c8d-5f2b-4d7a-9e4c-0b8f2d6a3c15";
const VIDEO_KEY = "e3b9c2f7-8d1a-4f6e-a5c0-7d2e9b4f1a83";
const NOTE_KEY = "1f8d5a3c-9e2b-4c7f-b0a6-4e9c1d7b5f32";
const REPORT_KEY = "b7c4e1a9-3d6f-4b2e-8f5a-2c0d9e6b4a17";

const THUMB = 'class="media-frame media-frame--square" style="margin: 0; width: var(--space-8);"';

export const FILE_STRIP_FEED: FewShotDesignExample = {
  id: "site_visit_strip",
  title: "Strip of many files",
  layout: "feed",
  suitedFor:
    "Records that keep several files of their own, such as the photos, clips, voice notes and reports of one visit.",
  composition:
    "The visit leads with its site beneath it, then a wrapping strip of every file in the order it was added, then how many files the visit holds beside the date. A photo or a video is a small square frame, a video says Video under its frame, a sound says Audio, and a document is named in a chip.",
  notes: [
    "Draws every entry in order, by its kind: a strip that drew the photos and dropped the rest would tell the reader the visit held less than it does.",
    "Names a document by its file name without the extension, as a document card does, and never by its type alone.",
    "Draws an empty frame with a short note when the list is empty, because the list may hold photos and videos.",
  ],
  capability: {
    id: "site_visits",
    noun: "visit",
    label: "Site visits",
    schema: {
      fields: fields([
        ["title", "string", true],
        ["site", "string", false],
        ["visited_on", "date", false],
        ["files", "file[]", false, [...FILE_FAMILIES]],
      ]),
    },
    form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  },
  previewSamples: [
    {
      record: {
        id: "visit-1",
        title: "Kitchen walls, second coat",
        site: "Calle 9 apartment",
        visited_on: "2026-09-22",
        files: [
          {
            url: fileUrl(PHOTO_KEY),
            name: "IMG_6120.JPG",
            kind: "image",
            mime: "image/jpeg",
            size: 2_104_331,
          },
          {
            url: fileUrl(VIDEO_KEY),
            name: "VID_0412.MOV",
            kind: "video",
            mime: "video/quicktime",
            size: 18_220_544,
          },
          {
            url: fileUrl(NOTE_KEY),
            name: "Recording 31.m4a",
            kind: "audio",
            mime: "audio/mp4",
            size: 301_552,
          },
          {
            url: fileUrl(REPORT_KEY),
            name: "Moisture report.pdf",
            kind: "document",
            mime: "application/pdf",
            size: 640_118,
          },
        ],
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="stack gap-0_5">',
        '<span class="text-xl text-bold line-clamp-2">Kitchen walls, second coat</span>',
        '<span class="text-sm text-muted truncate">Calle 9 apartment</span>',
        "</div>",
        '<div class="cluster gap-1">',
        `<figure ${THUMB}><img src="${fileUrl(PHOTO_KEY)}" alt="" loading="lazy" decoding="async"></figure>`,
        `<div class="stack gap-0_5"><figure ${THUMB}><video src="${fileUrl(VIDEO_KEY)}" muted playsinline preload="metadata"></video></figure><span class="text-xs text-muted">Video</span></div>`,
        '<span class="text-xs text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">Audio</span>',
        '<span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Moisture report</span>',
        "</div>",
        '<div class="cluster gap-1 text-xs text-muted">',
        "<span>4 files</span>",
        '<time datetime="2026-09-22">2026-09-22</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
    {
      record: {
        id: "visit-2",
        title: "First look at the roof",
        site: null,
        visited_on: "2026-09-25",
        files: [],
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="stack gap-0_5">',
        '<span class="text-xl text-bold line-clamp-2">First look at the roof</span>',
        "</div>",
        '<figure class="media-frame media-frame--wide w-full" style="margin: 0;">',
        '<div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">Nothing added yet</span></div>',
        "</figure>",
        '<div class="cluster gap-1 text-xs text-muted">',
        "<span>0 files</span>",
        '<time datetime="2026-09-25">2026-09-25</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "type File = { url: string; name: string; kind: string };",
    "",
    `const THUMB = '${THUMB}';`,
    "",
    "function entry(file: File): string {",
    "  const url = escapeHtml(file.url);",
    '  if (file.kind === "image") return `<figure ${THUMB}><img src="${url}" alt=""></figure>`;',
    '  if (file.kind === "video") {',
    '    return `<div class="stack gap-0_5"><figure ${THUMB}><video src="${url}" muted playsinline></video></figure><span class="text-xs text-muted">Video</span></div>`;',
    "  }",
    '  if (file.kind === "audio") {',
    '    return \'<span class="text-xs text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">Audio</span>\';',
    "  }",
    '  const name = file.name.replace(/\\.[A-Za-z0-9]{1,5}$/, "") || file.name;',
    '  return `<span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(name)}</span>`;',
    "}",
    "",
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const files = (Array.isArray(record.files) ? record.files : []) as File[];",
    "  const title = escapeHtml(record.title);",
    "  const visitedOn =",
    "    record.visited_on === null",
    '      ? ""',
    '      : `<time datetime="${escapeHtml(record.visited_on)}">${escapeHtml(record.visited_on)}</time>`;',
    "  const site =",
    '    record.site === null ? "" : `<span class="text-sm text-muted truncate">${escapeHtml(record.site)}</span>`;',
    "  const strip =",
    "    files.length > 0",
    '      ? `<div class="cluster gap-1">${files.map(entry).join("")}</div>`',
    '      : \'<figure class="media-frame media-frame--wide w-full" style="margin: 0;"><div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">Nothing added yet</span></div></figure>\';',
    '  const count = `${files.length} ${files.length === 1 ? "file" : "files"}`;',
    "",
    '  return `<div class="stack gap-2">',
    '    <div class="stack gap-0_5">',
    '      <span class="text-xl text-bold line-clamp-2">${title}</span>',
    "      ${site}",
    "    </div>",
    "    ${strip}",
    '    <div class="cluster gap-1 text-xs text-muted">',
    "      <span>${count}</span>",
    "      ${visitedOn}",
    "    </div>",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};

const TRIP_PHOTO_KEY = "a5d2f8c1-3e7b-4a6d-9c0f-8b4e1a7d3c62";
const TRIP_VIDEO_KEY = "3b8e1d6f-9a2c-4e5b-a7d0-1f4c8e2b9a57";
const TRIP_NOTE_KEY = "f0c6a3e9-2b8d-4f1a-8e7c-5a3d0b9f6e41";
const TRIP_PASS_KEY = "c8e5b2d7-6a1f-4d3c-9b8e-2f7a0c5d1e94";

const CELL = 'class="media-frame media-frame--square w-full" style="margin: 0;"';
const SUN_CHIP =
  'class="text-xs text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);"';
const SKY_CHIP =
  'class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);"';
const NOTHING_YET =
  '<div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">Nothing added yet</span></div>';

export const FILE_STRIP_TILE: FewShotDesignExample = {
  id: "trip_strip_tile",
  title: "Tile of many files",
  layout: "grid",
  suitedFor:
    "Records that keep several files of any kind, laid out as tiles that scan side by side.",
  composition:
    "A three-across grid of the files leads, every one in the order it was added: a photo or a video in a small square frame, a sound as Audio and a document by its name. Then the place in bold and a line counting each kind beside the date. A video says Video under its frame, so the tile reads where no first frame is drawn.",
  notes: [
    "Draws every entry, in order, by its kind, while the list is short enough for a tile. A longer list is named in words alone, by its count of each kind, so the tile never draws some files and drops the rest.",
    "Counts each kind by its own word, so two clips read 2 videos and never 2 photos.",
    "Draws one empty frame when the list is empty, because it may hold photos and videos, and says nothing about a count of none.",
  ],
  capability: {
    id: "trips",
    noun: "trip",
    label: "Trips",
    schema: {
      fields: fields([
        ["place", "string", true],
        ["went_on", "date", false],
        ["keepsakes", "file[]", false, [...FILE_FAMILIES]],
      ]),
    },
    form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  },
  previewSamples: [
    {
      record: {
        id: "trip-1",
        place: "Salento",
        went_on: "2026-05-17",
        keepsakes: [
          {
            url: fileUrl(TRIP_PHOTO_KEY),
            name: "IMG_7001.JPG",
            kind: "image",
            mime: "image/jpeg",
            size: 1_904_220,
          },
          {
            url: fileUrl(TRIP_VIDEO_KEY),
            name: "VID_0150.MP4",
            kind: "video",
            mime: "video/mp4",
            size: 9_820_113,
          },
          {
            url: fileUrl(TRIP_NOTE_KEY),
            name: "Recording 4.m4a",
            kind: "audio",
            mime: "audio/mp4",
            size: 220_118,
          },
          {
            url: fileUrl(TRIP_PASS_KEY),
            name: "Bus tickets.pdf",
            kind: "document",
            mime: "application/pdf",
            size: 88_310,
          },
        ],
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="grid grid-cols-3 gap-1">',
        `<figure ${CELL}><img src="${fileUrl(TRIP_PHOTO_KEY)}" alt="" loading="lazy" decoding="async"></figure>`,
        `<div class="stack gap-0_5"><figure ${CELL}><video src="${fileUrl(TRIP_VIDEO_KEY)}" muted playsinline preload="metadata"></video></figure><span class="text-xs text-muted">Video</span></div>`,
        `<span ${SUN_CHIP}>Audio</span>`,
        `<span ${SKY_CHIP}>Bus tickets</span>`,
        "</div>",
        '<span class="text-lg text-bold line-clamp-2">Salento</span>',
        '<div class="cluster gap-1 text-xs text-muted">',
        "<span>1 photo, 1 video, 1 recording, 1 document</span>",
        '<time datetime="2026-05-17">2026-05-17</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
    {
      record: { id: "trip-2", place: "Villa de Leyva", went_on: null, keepsakes: [] },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        `<figure ${CELL}>${NOTHING_YET}</figure>`,
        '<span class="text-lg text-bold line-clamp-2">Villa de Leyva</span>',
        '<div class="cluster gap-1 text-xs text-muted">',
        "</div>",
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "type File = { url: string; name: string; kind: string };",
    "",
    `const CELL = '${CELL}';`,
    "const WORDS: [string, string, string][] = [",
    '  ["image", "photo", "photos"],',
    '  ["video", "video", "videos"],',
    '  ["audio", "recording", "recordings"],',
    '  ["document", "document", "documents"],',
    "];",
    "",
    "function cell(file: File): string {",
    "  const url = escapeHtml(file.url);",
    '  if (file.kind === "image") return `<figure ${CELL}><img src="${url}" alt=""></figure>`;',
    '  if (file.kind === "video") {',
    '    return `<div class="stack gap-0_5"><figure ${CELL}><video src="${url}" muted playsinline></video></figure><span class="text-xs text-muted">Video</span></div>`;',
    "  }",
    `  if (file.kind === "audio") return '<span class="text-xs text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">Audio</span>';`,
    '  const name = file.name.replace(/\\.[A-Za-z0-9]{1,5}$/, "") || file.name;',
    '  return `<span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(name)}</span>`;',
    "}",
    "",
    "function counted(files: File[]): string {",
    "  return WORDS.map(([kind, one, many]) => {",
    "    const n = files.filter((file) => file.kind === kind).length;",
    '    return n === 0 ? "" : `${n} ${n === 1 ? one : many}`;',
    "  })",
    "    .filter(Boolean)",
    '    .join(", ");',
    "}",
    "",
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const files = (Array.isArray(record.keepsakes) ? record.keepsakes : []) as File[];",
    "  const place = escapeHtml(record.place);",
    "  const wentOn =",
    "    record.went_on === null",
    '      ? ""',
    '      : `<time datetime="${escapeHtml(record.went_on)}">${escapeHtml(record.went_on)}</time>`;',
    "  const grid =",
    "    files.length === 0",
    `      ? \`<figure \${CELL}>${NOTHING_YET}</figure>\``,
    "      : files.length <= 6",
    '        ? `<div class="grid grid-cols-3 gap-1">${files.map(cell).join("")}</div>`',
    '        : "";',
    '  const count = files.length === 0 ? "" : `<span>${counted(files)}</span>`;',
    "",
    '  return `<div class="stack gap-2">',
    "    ${grid}",
    '    <span class="text-lg text-bold line-clamp-2">${place}</span>',
    '    <div class="cluster gap-1 text-xs text-muted">',
    "      ${count}",
    "      ${wentOn}",
    "    </div>",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};
