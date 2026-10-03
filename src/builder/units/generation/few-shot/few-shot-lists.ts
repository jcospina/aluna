// The few-shot gallery's lists that hold no picture: a meeting's recordings and minutes, as a feed
// card that names every entry and as a tile that names the list by how many files it holds
// (7.4/03). Split from `few-shot-gallery.ts`, which injects them.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.

import { fileUrl } from "../../../../platform/files/file-url.ts";
import type { FewShotDesignExample } from "./few-shot-gallery.ts";
import { ESCAPE_HELPER_SOURCE, fields } from "./few-shot-parts.ts";

const RECORDING = {
  url: fileUrl("4c9e2a7f-1b3d-4e8a-9f6c-5d0b8e2a7c13"),
  name: "Meeting 12.m4a",
  kind: "audio",
  mime: "audio/mp4",
  size: 5_120_441,
};
const MINUTES = {
  url: fileUrl("8e1f6b3a-7c2d-4a9e-b5f0-3d6a9c1e8b24"),
  name: "Minutes, March.pdf",
  kind: "document",
  mime: "application/pdf",
  size: 182_330,
};
const BUDGET = {
  url: fileUrl("d2a7c9e1-5f3b-4c8d-a6e0-9b1f4d7a2c58"),
  name: "Budget draft.xlsx",
  kind: "document",
  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size: 40_918,
};

const CAPABILITY = {
  id: "committee_meetings",
  noun: "meeting",
  label: "Committee meetings",
  schema: {
    fields: fields([
      ["title", "string", true],
      ["met_on", "date", false],
      ["files", "file[]", false, ["audio", "document"]],
    ]),
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
};

const MET_ON_SOURCE = [
  "  const metOn =",
  "    record.met_on === null",
  '      ? ""',
  '      : `<time class="text-muted" datetime="${escapeHtml(record.met_on)}">${escapeHtml(record.met_on)}</time>`;',
];

export const MEETING_FILES_FEED: FewShotDesignExample = {
  id: "meeting_files_feed",
  title: "List of sounds and documents",
  layout: "feed",
  suitedFor:
    "Records that keep several sounds or documents, such as a meeting's recordings and minutes.",
  composition:
    "The meeting leads with its date beside it, then a wrapping row naming every file in the order it was added: a sound says Audio, and a document is named in a chip. Nothing here has a picture, so the card draws no frame, even when the list is empty.",
  notes: [
    "Names every entry in order, a sound as Audio and a document by its name: a list that named the minutes and dropped the recording would tell the reader the meeting kept less than it did.",
    "Names a document by its file name without the extension, and never by its type alone.",
    "Says Nothing added yet in words when the list is empty, with no frame, because no entry could be a picture.",
  ],
  capability: CAPABILITY,
  previewSamples: [
    {
      record: {
        id: "meeting-1",
        title: "Spring budget",
        met_on: "2026-03-11",
        files: [RECORDING, MINUTES, BUDGET],
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="cluster gap-1">',
        '<span class="text-xl text-bold line-clamp-2">Spring budget</span>',
        '<time class="text-muted" datetime="2026-03-11">2026-03-11</time>',
        "</div>",
        '<div class="cluster gap-1 text-xs">',
        '<span class="text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">Audio</span>',
        '<span class="text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Minutes, March</span>',
        '<span class="text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Budget draft</span>',
        "</div>",
        "</div>",
      ].join(""),
    },
    {
      record: { id: "meeting-2", title: "Garden plot rota", met_on: null, files: [] },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="cluster gap-1">',
        '<span class="text-xl text-bold line-clamp-2">Garden plot rota</span>',
        "</div>",
        '<span class="text-sm text-subtle">Nothing added yet</span>',
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "type File = { name: string; kind: string };",
    "",
    "function entry(file: File): string {",
    '  if (file.kind === "audio") {',
    '    return \'<span class="text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">Audio</span>\';',
    "  }",
    '  const name = file.name.replace(/\\.[A-Za-z0-9]{1,5}$/, "") || file.name;',
    '  return `<span class="text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(name)}</span>`;',
    "}",
    "",
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const files = (Array.isArray(record.files) ? record.files : []) as File[];",
    "  const title = escapeHtml(record.title);",
    ...MET_ON_SOURCE,
    "  const list =",
    "    files.length > 0",
    '      ? `<div class="cluster gap-1 text-xs">${files.map(entry).join("")}</div>`',
    "      : '<span class=\"text-sm text-subtle\">Nothing added yet</span>';",
    "",
    '  return `<div class="stack gap-2">',
    '    <div class="cluster gap-1">',
    '      <span class="text-xl text-bold line-clamp-2">${title}</span>',
    "      ${metOn}",
    "    </div>",
    "    ${list}",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};

export const MEETING_FILES_TILE: FewShotDesignExample = {
  id: "meeting_files_tile",
  title: "Tile naming a list by its count",
  layout: "grid",
  suitedFor:
    "Records that keep several sounds or documents, laid out as tiles too narrow to name each one.",
  composition:
    "A chip saying how many recordings and documents the meeting keeps leads, then the title in bold and the date. A tile has no room for every name, so it names the list in words alone, by count, and the open record lists each file.",
  notes: [
    "Names the whole list by how many of each kind it holds, rather than drawing some entries and dropping the rest.",
    "Says Nothing added yet when the list is empty, with no frame, because no entry could be a picture.",
  ],
  capability: CAPABILITY,
  previewSamples: [
    {
      record: {
        id: "meeting-3",
        title: "Spring budget",
        met_on: "2026-03-11",
        files: [RECORDING, MINUTES, BUDGET],
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<span class="text-xs text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">1 recording, 2 documents</span>',
        '<span class="text-xl text-bold line-clamp-3">Spring budget</span>',
        '<time class="text-muted" datetime="2026-03-11">2026-03-11</time>',
        "</div>",
      ].join(""),
    },
    {
      record: { id: "meeting-4", title: "Garden plot rota", met_on: null, files: [] },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<span class="text-xs text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">Nothing added yet</span>',
        '<span class="text-xl text-bold line-clamp-3">Garden plot rota</span>',
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "function count(files: { kind: string }[], kind: string, one: string, many: string): string {",
    "  const n = files.filter((file) => file.kind === kind).length;",
    '  return n === 0 ? "" : `${n} ${n === 1 ? one : many}`;',
    "}",
    "",
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const files = (Array.isArray(record.files) ? record.files : []) as { kind: string }[];",
    "  const title = escapeHtml(record.title);",
    ...MET_ON_SOURCE,
    "  const what =",
    '    [count(files, "audio", "recording", "recordings"), count(files, "document", "document", "documents")]',
    "      .filter(Boolean)",
    '      .join(", ") || "Nothing added yet";',
    "",
    '  return `<div class="stack gap-2">',
    '    <span class="text-xs text-bold" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">${what}</span>',
    '    <span class="text-xl text-bold line-clamp-3">${title}</span>',
    "    ${metOn}",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};
