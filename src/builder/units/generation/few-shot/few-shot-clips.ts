// The few-shot gallery's video tile: a practice clip laid out as a grid cell, so a card holding
// videos has a grid composition as well as the feed card it shares with photos (7.4/03). Split from
// `few-shot-gallery.ts`, which injects it.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.

import { fileUrl } from "../../../../platform/files/file-url.ts";
import type { FewShotDesignExample } from "./few-shot-gallery.ts";
import { ESCAPE_HELPER_SOURCE, fields } from "./few-shot-parts.ts";

/** The key the clip exemplar's video is stored under. */
const PREVIEW_CLIP_KEY = "2d7f4b9e-1c6a-4e3d-8b5f-9a0c3e7d1f28";

export const CLIP_TILE: FewShotDesignExample = {
  id: "practice_clip_tile",
  title: "Video grid tile",
  layout: "grid",
  suitedFor: "Records that hold one video, laid out as tiles that scan side by side.",
  composition:
    "A wide frame leads, then the piece in bold and a row with a chip saying Video beside the date. The frame keeps its shape whether or not a first frame is drawn, so the tiles line up.",
  notes: [
    "Draws the video muted and playsinline with no controls, autoplay or poster: the tile shows it, and the open record plays it.",
    "Says Video in words under the frame, because some browsers draw no first frame and leave the frame as its tinted well.",
    "Draws the empty frame with a short note when the clip is null, and drops the chip, which would say nothing.",
  ],
  capability: {
    id: "practice_clips",
    noun: "clip",
    label: "Practice clips",
    schema: {
      fields: fields([
        ["clip", "file", false, ["video"]],
        ["piece", "string", true],
        ["practiced_on", "date", false],
      ]),
    },
    form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  },
  previewSamples: [
    {
      record: {
        id: "clip-1",
        clip: {
          url: fileUrl(PREVIEW_CLIP_KEY),
          name: "VID_0388.MP4",
          kind: "video",
          mime: "video/mp4",
          size: 21_430_118,
        },
        piece: "Barre chords, slow tempo",
        practiced_on: "2026-09-14",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<figure class="media-frame media-frame--wide w-full" style="margin: 0;">',
        `<video src="${fileUrl(PREVIEW_CLIP_KEY)}" muted playsinline preload="metadata"></video>`,
        "</figure>",
        '<span class="text-lg text-bold line-clamp-2">Barre chords, slow tempo</span>',
        '<div class="cluster gap-1 text-xs">',
        '<span class="text-bold" style="background-color: var(--clay); color: var(--ink); padding: var(--space-1) var(--space-1);">Video</span>',
        '<time class="text-muted" datetime="2026-09-14">2026-09-14</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
    {
      record: {
        id: "clip-2",
        clip: null,
        piece: "Fingerpicking pattern",
        practiced_on: "2026-09-16",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<figure class="media-frame media-frame--wide w-full" style="margin: 0;">',
        '<div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">No clip yet</span></div>',
        "</figure>",
        '<span class="text-lg text-bold line-clamp-2">Fingerpicking pattern</span>',
        '<div class="cluster gap-1 text-xs">',
        '<time class="text-muted" datetime="2026-09-16">2026-09-16</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const clip = record.clip as { url: string } | null;",
    "  const piece = escapeHtml(record.piece);",
    "  const practicedOn =",
    "    record.practiced_on === null",
    '      ? ""',
    '      : `<time class="text-muted" datetime="${escapeHtml(record.practiced_on)}">${escapeHtml(record.practiced_on)}</time>`;',
    "  const frame = clip",
    '    ? `<video src="${escapeHtml(clip.url)}" muted playsinline></video>`',
    '    : \'<div class="flex items-center justify-center" style="height: 100%;"><span class="text-sm text-subtle">No clip yet</span></div>\';',
    "  const chip = clip",
    '    ? \'<span class="text-bold" style="background-color: var(--clay); color: var(--ink); padding: var(--space-1) var(--space-1);">Video</span>\'',
    '    : "";',
    "",
    '  return `<div class="stack gap-2">',
    '    <figure class="media-frame media-frame--wide w-full" style="margin: 0;">${frame}</figure>',
    '    <span class="text-lg text-bold line-clamp-2">${piece}</span>',
    '    <div class="cluster gap-1 text-xs">${chip}',
    "      ${practicedOn}",
    "    </div>",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};
