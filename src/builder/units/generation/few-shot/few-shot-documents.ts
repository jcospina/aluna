// The few-shot gallery's document exemplars: an appliance manual as a feed card and as a tile,
// each naming the document it holds (Module 7 PLAN decision 29). Split from
// `few-shot-gallery.ts`, which injects them.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.

import { fileUrl } from "../../../../platform/files/file-url.ts";
import type { FewShotDesignExample } from "./few-shot-gallery.ts";
import { ESCAPE_HELPER_SOURCE, fields } from "./few-shot-parts.ts";

/** The key the manual exemplars' PDF is stored under. */
const PREVIEW_MANUAL_KEY = "7b3e9d2a-4c1f-4a8e-9f6b-0d2c5e8a1b74";

const MANUAL = {
  url: fileUrl(PREVIEW_MANUAL_KEY),
  name: "Kettle manual.pdf",
  kind: "document",
  mime: "application/pdf",
  size: 1_842_310,
};

const WHAT_SOURCE = [
  "  const manual = record.manual as { name?: unknown } | null;",
  '  const named = String(manual?.name ?? "");',
  '  const what = !manual ? "No manual yet" : named.replace(/\\.[A-Za-z0-9]{1,5}$/, "") || named;',
];

export const MANUAL_FEED: FewShotDesignExample = {
  id: "appliance_manual_feed",
  title: "Document feed card",
  layout: "feed",
  suitedFor:
    "Records that hold a document, such as a manual, a receipt or a lease, beside a few words.",
  composition:
    "The appliance leads, with its model beneath it, then a chip naming the manual beside the date it was bought. A document has no picture, so the card names it in words and draws no frame.",
  notes: [
    "Draws no link and no embed: a card is a button, which can hold neither, and the open record opens or downloads it.",
    "Names the manual by its file name without the extension, so Kettle manual.pdf reads Kettle manual, and says No manual yet when it holds none, so the chip changes with the field.",
    "Never labels the manual by its type alone, such as PDF, which says nothing about which manual it is.",
  ],
  capability: {
    id: "appliance_manuals",
    noun: "manual",
    label: "Appliance manuals",
    schema: {
      fields: fields([
        ["manual", "file", false, ["document"]],
        ["appliance", "string", true],
        ["model", "string", false],
        ["bought_on", "date", false],
      ]),
    },
    form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  },
  previewSamples: [
    {
      record: {
        id: "manual-1",
        manual: MANUAL,
        appliance: "Electric kettle",
        model: "KT-2200",
        bought_on: "2026-03-02",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="stack gap-0_5">',
        '<span class="text-xl text-bold line-clamp-2">Electric kettle</span>',
        '<span class="text-sm text-muted truncate">KT-2200</span>',
        "</div>",
        '<div class="cluster gap-1 text-xs">',
        '<span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Kettle manual</span>',
        '<time class="text-muted" datetime="2026-03-02">2026-03-02</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
    {
      record: {
        id: "manual-2",
        manual: null,
        appliance: "Dishwasher",
        model: null,
        bought_on: "2025-11-20",
      },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<div class="stack gap-0_5">',
        '<span class="text-xl text-bold line-clamp-2">Dishwasher</span>',
        "</div>",
        '<div class="cluster gap-1 text-xs">',
        '<span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">No manual yet</span>',
        '<time class="text-muted" datetime="2025-11-20">2025-11-20</time>',
        "</div>",
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const appliance = escapeHtml(record.appliance);",
    "  const boughtOn =",
    "    record.bought_on === null",
    '      ? ""',
    '      : `<time class="text-muted" datetime="${escapeHtml(record.bought_on)}">${escapeHtml(record.bought_on)}</time>`;',
    ...WHAT_SOURCE,
    "  const model =",
    "    record.model === null",
    '      ? ""',
    '      : `<span class="text-sm text-muted truncate">${escapeHtml(record.model)}</span>`;',
    "",
    '  return `<div class="stack gap-2">',
    '    <div class="stack gap-0_5">',
    '      <span class="text-xl text-bold line-clamp-2">${appliance}</span>',
    "      ${model}",
    "    </div>",
    '    <div class="cluster gap-1 text-xs">',
    '      <span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(what)}</span>',
    "      ${boughtOn}",
    "    </div>",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};

export const MANUAL_TILE: FewShotDesignExample = {
  id: "appliance_manual_tile",
  title: "Document grid tile",
  layout: "grid",
  suitedFor: "Records that hold a document, laid out as tiles that scan side by side.",
  composition:
    "A chip naming the manual leads, then the appliance in bold and its model. The chip carries the tile where a photo would, so the grid reads without a frame.",
  notes: [
    "Draws no frame, no link and no embed: a document has no picture, and the open record opens or downloads it.",
    "Names the manual without its extension, or says No manual yet, as the field holds; never its type alone.",
  ],
  capability: {
    ...MANUAL_FEED.capability,
    schema: {
      fields: fields([
        ["manual", "file", false, ["document"]],
        ["appliance", "string", true],
        ["model", "string", false],
      ]),
    },
  },
  previewSamples: [
    {
      record: { id: "manual-3", manual: MANUAL, appliance: "Electric kettle", model: "KT-2200" },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Kettle manual</span>',
        '<span class="text-xl text-bold line-clamp-3">Electric kettle</span>',
        '<span class="text-sm text-muted truncate">KT-2200</span>',
        "</div>",
      ].join(""),
    },
    {
      record: { id: "manual-4", manual: null, appliance: "Dishwasher", model: null },
      previewInnerHtml: [
        '<div class="stack gap-2">',
        '<span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">No manual yet</span>',
        '<span class="text-xl text-bold line-clamp-3">Dishwasher</span>',
        "</div>",
      ].join(""),
    },
  ],
  rendererSource: [
    "export default function renderItem(record: Record<string, unknown>): string {",
    "  const appliance = escapeHtml(record.appliance);",
    "  const model =",
    "    record.model === null",
    '      ? ""',
    '      : `<span class="text-sm text-muted truncate">${escapeHtml(record.model)}</span>`;',
    ...WHAT_SOURCE,
    "",
    '  return `<div class="stack gap-2">',
    '    <span class="text-xs text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(what)}</span>',
    '    <span class="text-xl text-bold line-clamp-3">${appliance}</span>',
    "    ${model}",
    "  </div>`;",
    "}",
    "",
    ESCAPE_HELPER_SOURCE,
  ].join("\n"),
};
