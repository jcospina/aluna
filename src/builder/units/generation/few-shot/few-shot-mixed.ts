// The few-shot gallery's single files that may be of more than one kind: a keepsake of any kind and
// an interview kept as a recording or a transcript, each as a feed card and as a tile, drawn by the
// file's `kind` (7.4/03). Split from `few-shot-gallery.ts`, which injects them.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.

import { fileUrl } from "../../../../platform/files/file-url.ts";
import { FILE_FAMILIES } from "../../../../registry/index.ts";
import type { FewShotDesignExample } from "./few-shot-gallery.ts";
import { ESCAPE_HELPER_SOURCE, fields } from "./few-shot-parts.ts";

const LETTER = {
  url: fileUrl("5b1d8e3f-2c7a-4f9d-8a6e-0c3b9f5d2a71"),
  name: "Letter from Ana.pdf",
  kind: "document",
  mime: "application/pdf",
  size: 310_442,
};
const FIRST_STEPS = {
  url: fileUrl("9f4a2c6e-8d1b-4e7f-a3c5-6b0d2e8f4a19"),
  name: "VID_0007.MOV",
  kind: "video",
  mime: "video/quicktime",
  size: 14_220_871,
};
const LULLABY = {
  url: fileUrl("2e7c5a9d-4f3b-4a1e-b8d6-7c9f1e3a5b02"),
  name: "Recording 2.m4a",
  kind: "audio",
  mime: "audio/mp4",
  size: 610_004,
};
const TRANSCRIPT = {
  url: fileUrl("7a3f9c1e-6d2b-4b8a-9e5f-3c1a7e9b2d46"),
  name: "Interview with Rosa.docx",
  kind: "document",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: 52_180,
};

const KEEPSAKES = {
  id: "keepsakes",
  noun: "keepsake",
  label: "Keepsakes",
  schema: {
    fields: fields([
      ["keepsake", "file", false, [...FILE_FAMILIES]],
      ["title", "string", true],
      ["kept_on", "date", false],
    ]),
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
};

const KEEPSAKE_SOURCE = (shape: "wide" | "square") => [
  "  const file = record.keepsake as { url: string; name: string; kind: string } | null;",
  "  const title = escapeHtml(record.title);",
  "  const keptOn =",
  "    record.kept_on === null",
  '      ? ""',
  '      : `<time class="text-muted" datetime="${escapeHtml(record.kept_on)}">${escapeHtml(record.kept_on)}</time>`;',
  '  const url = file ? escapeHtml(file.url) : "";',
  "  const media = !file",
  '    ? \'<div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">Nothing kept yet</span></div>\'',
  '    : file.kind === "image"',
  '      ? `<img src="${url}" alt="">`',
  '      : file.kind === "video"',
  '        ? `<video src="${url}" muted playsinline></video>`',
  '        : "";',
  "  const frame = media",
  `    ? \`<figure class="media-frame media-frame--${shape} w-full" style="margin: 0;">\${media}</figure>\``,
  '    : "";',
  "  const what = !file",
  '    ? ""',
  '    : file.kind === "video"',
  '      ? "Video"',
  '      : file.kind === "audio"',
  '        ? "Audio"',
  '        : file.kind === "document"',
  '          ? file.name.replace(/\\.[A-Za-z0-9]{1,5}$/, "") || file.name',
  '          : "";',
  "  const chip = what",
  '    ? `<span class="text-bold truncate" style="background-color: var(--clay); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(what)}</span>`',
  '    : "";',
];

const CLAY_CHIP =
  'class="text-bold truncate" style="background-color: var(--clay); color: var(--ink); padding: var(--space-1) var(--space-1);"';

export const KEEPSAKE_FEED: FewShotDesignExample = {
  id: "keepsake_feed",
  title: "Feed card for one file of any kind",
  layout: "feed",
  suitedFor:
    "Records whose one file may be a photo, a video, a sound or a document, where the file leads when it has a picture.",
  composition:
    "A wide frame leads when the file is a photo or a video, then the title, then a chip saying what the file is beside the date: Video for a video, Audio for a sound and the name for a document. A photo needs no chip, because its picture says it.",
  notes: [
    "Decides by the file's kind, never by the field: the same card holds a photo one day and a letter the next.",
    "Draws no frame for a sound or a document, and an empty frame with a short note when there is no file, because the field may hold a picture.",
  ],
  capability: KEEPSAKES,
  previewSamples: [
    {
      record: {
        id: "keepsake-1",
        keepsake: LETTER,
        title: "The letter from Lisbon",
        kept_on: "2026-02-14",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<span class="text-xl text-bold line-clamp-2">The letter from Lisbon</span>',
        '<div class="cluster gap-1 text-xs">',
        `<span ${CLAY_CHIP}>Letter from Ana</span>`,
        '<time class="text-muted" datetime="2026-02-14">2026-02-14</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
    {
      record: { id: "keepsake-2", keepsake: null, title: "Concert ticket stub", kept_on: null },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<figure class="media-frame media-frame--wide w-full" style="margin: 0;"><div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">Nothing kept yet</span></div></figure>',
        '<span class="text-xl text-bold line-clamp-2">Concert ticket stub</span>',
        '<div class="cluster gap-1 text-xs">',
        "</div>",
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    ...KEEPSAKE_SOURCE("wide"),
    "",
    '  return `<div class="stack gap-2">',
    "    ${frame}",
    '    <span class="text-xl text-bold line-clamp-2">${title}</span>',
    '    <div class="cluster gap-1 text-xs">${chip}${keptOn}</div>',
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};

export const KEEPSAKE_TILE: FewShotDesignExample = {
  id: "keepsake_tile",
  title: "Tile for one file of any kind",
  layout: "grid",
  suitedFor: "Records whose one file may be of any kind, laid out as tiles that scan side by side.",
  composition:
    "A square frame leads when the file is a photo or a video; otherwise the chip naming the file leads. The title follows in bold, then the date.",
  notes: [
    "Decides by the file's kind, so a video says Video under its frame and a sound or a document leads with words.",
    "Draws the empty frame with a short note when there is no file, because the field may hold a picture.",
  ],
  capability: KEEPSAKES,
  previewSamples: [
    {
      record: {
        id: "keepsake-3",
        keepsake: FIRST_STEPS,
        title: "First steps",
        kept_on: "2025-11-03",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        `<figure class="media-frame media-frame--square w-full" style="margin: 0;"><video src="${FIRST_STEPS.url}" muted playsinline preload="metadata"></video></figure>`,
        `<span ${CLAY_CHIP}>Video</span>`,
        '<span class="text-lg text-bold line-clamp-2">First steps</span>',
        '<time class="text-muted" datetime="2025-11-03">2025-11-03</time>',
        "</div>",
      ].join(""),
    },
    {
      record: { id: "keepsake-4", keepsake: LULLABY, title: "Abuela's lullaby", kept_on: null },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        `<span ${CLAY_CHIP}>Audio</span>`,
        '<span class="text-lg text-bold line-clamp-2">Abuela&#39;s lullaby</span>',
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    ...KEEPSAKE_SOURCE("square"),
    "",
    '  return `<div class="stack gap-2">',
    "    ${frame}",
    "    ${chip}",
    '    <span class="text-lg text-bold line-clamp-2">${title}</span>',
    "    ${keptOn}",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};

const INTERVIEWS = {
  id: "interviews",
  noun: "interview",
  label: "Interviews",
  schema: {
    fields: fields([
      ["source", "file", false, ["audio", "document"]],
      ["title", "string", true],
      ["person", "string", false],
    ]),
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
};

const SUN_CHIP =
  'class="text-xs text-bold truncate" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);"';

const INTERVIEW_SOURCE = [
  "  const file = record.source as { name: string; kind: string } | null;",
  "  const title = escapeHtml(record.title);",
  "  const person =",
  '    record.person === null ? "" : `<span class="text-sm text-muted truncate">${escapeHtml(record.person)}</span>`;',
  "  const what = !file",
  '    ? "No file yet"',
  '    : file.kind === "audio"',
  '      ? "Audio"',
  '      : file.name.replace(/\\.[A-Za-z0-9]{1,5}$/, "") || file.name;',
  '  const chip = `<span class="text-xs text-bold truncate" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(what)}</span>`;',
];

export const INTERVIEW_FEED: FewShotDesignExample = {
  id: "interview_feed",
  title: "Feed card for a sound or a document",
  layout: "feed",
  suitedFor:
    "Records whose one file is a sound or a document, such as an interview kept as a recording or a transcript.",
  composition:
    "The title leads with the person beneath it, then a chip saying what the file is: Audio for a recording, the name for a transcript. Neither kind has a picture, so the card draws no frame.",
  notes: [
    "Decides by the file's kind, and says No file yet in words when there is none, with no frame, because the field can never hold a picture.",
  ],
  capability: INTERVIEWS,
  previewSamples: [
    {
      record: {
        id: "interview-1",
        source: LULLABY,
        title: "Growing up in Mompox",
        person: "Rosa Díaz",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="stack gap-0_5">',
        '<span class="text-xl text-bold line-clamp-2">Growing up in Mompox</span>',
        '<span class="text-sm text-muted truncate">Rosa Díaz</span>',
        "</div>",
        `<span ${SUN_CHIP}>Audio</span>`,
        "</div>",
      ].join(""),
    },
    {
      record: { id: "interview-2", source: null, title: "The river trade", person: null },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="stack gap-0_5">',
        '<span class="text-xl text-bold line-clamp-2">The river trade</span>',
        "</div>",
        `<span ${SUN_CHIP}>No file yet</span>`,
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    ...INTERVIEW_SOURCE,
    "",
    '  return `<div class="stack gap-2">',
    '    <div class="stack gap-0_5">',
    '      <span class="text-xl text-bold line-clamp-2">${title}</span>',
    "      ${person}",
    "    </div>",
    "    ${chip}",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};

export const INTERVIEW_TILE: FewShotDesignExample = {
  id: "interview_tile",
  title: "Tile for a sound or a document",
  layout: "grid",
  suitedFor:
    "Records whose one file is a sound or a document, laid out as tiles that scan side by side.",
  composition:
    "The chip saying what the file is leads where a picture would, then the title in bold and the person.",
  notes: [
    "Decides by the file's kind, and draws no frame, because the field can never hold a picture.",
  ],
  capability: INTERVIEWS,
  previewSamples: [
    {
      record: {
        id: "interview-3",
        source: TRANSCRIPT,
        title: "Fishing at dawn",
        person: "Rosa Díaz",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        `<span ${SUN_CHIP}>Interview with Rosa</span>`,
        '<span class="text-lg text-bold line-clamp-3">Fishing at dawn</span>',
        '<span class="text-sm text-muted truncate">Rosa Díaz</span>',
        "</div>",
      ].join(""),
    },
    {
      record: { id: "interview-4", source: LULLABY, title: "Songs of the plaza", person: null },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        `<span ${SUN_CHIP}>Audio</span>`,
        '<span class="text-lg text-bold line-clamp-3">Songs of the plaza</span>',
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    ...INTERVIEW_SOURCE,
    "",
    '  return `<div class="stack gap-2">',
    "    ${chip}",
    '    <span class="text-lg text-bold line-clamp-3">${title}</span>',
    "    ${person}",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};
