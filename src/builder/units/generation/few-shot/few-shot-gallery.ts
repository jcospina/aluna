// Repo-only few-shot item-renderer gallery.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.
//
// These examples are generation guidance, not user-facing product UI. The builder
// injects them into the item-renderer prompt alongside the closed design contract and
// the capability's chosen collection layout. Nothing renders them to a reader: the
// developer preview route that once did came down with module 5, and what stands over
// them now is `gate-design-lint-high-meadow.test.ts`, which composes each sample through
// the real presentation adapter rather than serving it.

import { ALLOWED_CLASSES } from "../../../../presentation/safety/enforcer/vocabulary.ts";
import {
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "../../../../presentation/tokens/design-tokens.ts";
import {
  type FileFamily,
  isFileFieldType,
  isFileListFieldType,
  type SpecField,
  type UiCollectionLayout,
  type UiFormIntent,
} from "../../../../registry/index.ts";
import { CLIP_TILE } from "./few-shot-clips.ts";
import { MANUAL_FEED, MANUAL_TILE } from "./few-shot-documents.ts";
import { MEETING_FILES_FEED, MEETING_FILES_TILE } from "./few-shot-lists.ts";
import {
  PHOTO_GRID_TILE,
  VOICE_MEMO_FEED,
  VOICE_MEMO_TILE,
  WALK_MEDIA_FEED,
} from "./few-shot-media.ts";
import { INTERVIEW_FEED, INTERVIEW_TILE, KEEPSAKE_FEED, KEEPSAKE_TILE } from "./few-shot-mixed.ts";
import { ESCAPE_HELPER_SOURCE, fields } from "./few-shot-parts.ts";
import { FILE_STRIP_FEED, FILE_STRIP_TILE } from "./few-shot-strips.ts";

export interface FewShotPreviewCapability {
  readonly id: string;
  readonly label: string;
  readonly noun: string;
  readonly schema: { readonly fields: readonly SpecField[] };
  readonly form: UiFormIntent;
}

export interface FewShotDesignExample {
  readonly id: string;
  readonly title: string;
  readonly layout: UiCollectionLayout;
  readonly suitedFor: string;
  readonly composition: string;
  readonly notes: readonly string[];
  readonly capability: FewShotPreviewCapability;
  readonly previewSamples: readonly FewShotPreviewSample[];
  readonly rendererSource: string;
}

export interface FewShotPreviewSample {
  readonly record: Readonly<Record<string, unknown>>;
  readonly previewInnerHtml: string;
}

export const FEW_SHOT_DESIGN_EXAMPLES: readonly FewShotDesignExample[] = [
  {
    id: "research_note_feed",
    title: "Text-forward note card",
    layout: "feed",
    suitedFor: "Text-heavy records where the newest item should read like a calm feed entry.",
    composition:
      "Title first, color-backed source and tag chips second, then a clamped excerpt. No nested frame because the platform wrapper already supplies the card surface.",
    notes: [
      "Uses feed-friendly hierarchy and truncation.",
      "Turns source/tag into visible metadata without adding an inner card.",
      "Composes only one record. The platform owns the trigger, the payload, and the record's own view.",
    ],
    capability: {
      id: "research_notes",
      noun: "research note",
      label: "Research notes",
      schema: {
        fields: fields([
          ["title", "string", true],
          ["source", "string", false],
          ["excerpt", "string", false],
          ["tag", "string", false],
        ]),
      },
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
    },
    previewSamples: [
      {
        record: {
          id: "note-1",
          title: "Ambient interfaces change what people choose to track",
          source: "Field memo",
          excerpt:
            "People start with broad intent, then their actual tracking vocabulary sharpens once the first records exist.",
          tag: "research",
        },
        previewInnerHtml: [
          '<div class="stack gap-1">',
          '<span class="text-xl text-bold line-clamp-2">Ambient interfaces change what people choose to track</span>',
          '<div class="cluster gap-1 text-xs">',
          '<span class="text-bold truncate" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">Field memo</span>',
          '<span class="text-bold" style="background-color: var(--clay); color: var(--ink); padding: var(--space-1) var(--space-1);">research</span>',
          "</div>",
          '<p class="line-clamp-3 text-sm text-subtle">People start with broad intent, then their actual tracking vocabulary sharpens once the first records exist.</p>',
          "</div>",
        ].join(""),
      },
      {
        record: {
          id: "note-2",
          title: "Tiny labels become durable product language",
          source: "Interview synthesis",
          excerpt:
            "A short label that starts as a convenience often becomes the team's shared shorthand for an entire workflow.",
          tag: "patterns",
        },
        previewInnerHtml: [
          '<div class="stack gap-1">',
          '<span class="text-xl text-bold line-clamp-2">Tiny labels become durable product language</span>',
          '<div class="cluster gap-1 text-xs">',
          '<span class="text-bold truncate" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">Interview synthesis</span>',
          '<span class="text-bold" style="background-color: var(--clay); color: var(--ink); padding: var(--space-1) var(--space-1);">patterns</span>',
          "</div>",
          '<p class="line-clamp-3 text-sm text-subtle">A short label that starts as a convenience often becomes the team&#39;s shared shorthand for an entire workflow.</p>',
          "</div>",
        ].join(""),
      },
    ],
    rendererSource: [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const title = escapeHtml(record.title);",
      "  const source =",
      "    record.source === null",
      '      ? ""',
      '      : `<span class="text-bold truncate" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(record.source)}</span>`;',
      "  const tag =",
      "    record.tag === null",
      '      ? ""',
      '      : `<span class="text-bold" style="background-color: var(--clay); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(record.tag)}</span>`;',
      "  const excerpt =",
      "    record.excerpt === null",
      '      ? ""',
      '      : `<p class="line-clamp-3 text-sm text-subtle">${escapeHtml(record.excerpt)}</p>`;',
      '  const meta = source + tag ? `<div class="cluster gap-1 text-xs">${source}${tag}</div>` : "";',
      "",
      '  return `<div class="stack gap-1">',
      '    <span class="text-xl text-bold line-clamp-2">${title}</span>',
      "    ${meta}",
      "    ${excerpt}",
      "  </div>`;",
      "}",
      "",
      ESCAPE_HELPER_SOURCE,
    ].join("\n"),
  },
  PHOTO_GRID_TILE,
  WALK_MEDIA_FEED,
  CLIP_TILE,
  VOICE_MEMO_FEED,
  VOICE_MEMO_TILE,
  MANUAL_FEED,
  MANUAL_TILE,
  FILE_STRIP_FEED,
  FILE_STRIP_TILE,
  MEETING_FILES_FEED,
  MEETING_FILES_TILE,
  KEEPSAKE_FEED,
  KEEPSAKE_TILE,
  INTERVIEW_FEED,
  INTERVIEW_TILE,
  {
    id: "saved_link_metadata_feed",
    title: "Compact metadata row",
    layout: "feed",
    suitedFor: "Reference records where title and URL need fast comparison in a dense feed.",
    composition:
      "Two-column row with the title/URL stack on the left and a colored priority pill on the right. The inline style is the token-disciplined escape hatch.",
    notes: [
      "Demonstrates style for arrangement that the primitive classes do not cover.",
      "Owned axes stay on tokens: gap, padding and colour all use var(), and no boundary is declared — the platform draws the record's own.",
      "Leaves out the topic and the priority when the record holds neither, rather than inventing one.",
    ],
    capability: {
      id: "saved_links",
      noun: "saved link",
      label: "Saved links",
      schema: {
        fields: fields([
          ["title", "string", true],
          ["url", "string", true],
          ["topic", "string", false],
          ["priority", "string", false],
        ]),
      },
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
    },
    previewSamples: [
      {
        record: {
          id: "link-1",
          title: "Designing with AI-generated components",
          url: "https://example.com/designing-with-ai-components",
          topic: "interface research",
          priority: "later",
        },
        previewInnerHtml: [
          '<div class="grid" style="grid-template-columns: minmax(0, 1fr) max-content; gap: var(--space-2); align-items: center;">',
          '<div class="stack gap-0_5">',
          '<span class="text-lg text-bold truncate">Designing with AI-generated components</span>',
          '<span class="text-sm text-muted truncate">https://example.com/designing-with-ai-components</span>',
          '<span class="text-xs text-bold" style="align-self: flex-start; background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">interface research</span>',
          "</div>",
          '<span class="text-sm text-bold" style="background-color: var(--shade); color: var(--surface); padding: var(--space-1) var(--space-1);">later</span>',
          "</div>",
        ].join(""),
      },
      {
        record: {
          id: "link-2",
          title: "Token discipline for generated interfaces",
          url: "https://example.com/token-discipline",
          topic: null,
          priority: null,
        },
        previewInnerHtml: [
          '<div class="grid" style="grid-template-columns: minmax(0, 1fr) max-content; gap: var(--space-2); align-items: center;">',
          '<div class="stack gap-0_5">',
          '<span class="text-lg text-bold truncate">Token discipline for generated interfaces</span>',
          '<span class="text-sm text-muted truncate">https://example.com/token-discipline</span>',
          "</div>",
          "</div>",
        ].join(""),
      },
    ],
    rendererSource: [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const title = escapeHtml(record.title);",
      "  const url = escapeHtml(record.url);",
      "  const topic =",
      "    record.topic === null",
      '      ? ""',
      '      : `<span class="text-xs text-bold" style="align-self: flex-start; background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(record.topic)}</span>`;',
      "  const priority =",
      "    record.priority === null",
      '      ? ""',
      '      : `<span class="text-sm text-bold" style="background-color: var(--shade); color: var(--surface); padding: var(--space-1) var(--space-1);">${escapeHtml(record.priority)}</span>`;',
      "",
      '  return `<div class="grid" style="grid-template-columns: minmax(0, 1fr) max-content; gap: var(--space-2); align-items: center;">',
      '    <div class="stack gap-0_5">',
      '      <span class="text-lg text-bold truncate">${title}</span>',
      '      <span class="text-sm text-muted truncate">${url}</span>',
      "      ${topic}",
      "    </div>",
      "    ${priority}",
      "  </div>`;",
      "}",
      "",
      ESCAPE_HELPER_SOURCE,
    ].join("\n"),
  },
  {
    id: "quote_tile",
    title: "Text grid tile",
    layout: "grid",
    suitedFor:
      "Short text records laid out as tiles that scan side by side, with no picture to lead.",
    composition:
      "The words lead at a larger size, clamped so the tiles keep a rhythm, then a tinted chip naming who said it beside the year. A tile with nothing optional filled is just its words.",
    notes: [
      "Lets the type carry the tile: a text record needs no frame to hold a grid cell.",
      "Leaves out the chip and the year when the record holds neither, rather than inventing a placeholder.",
    ],
    capability: {
      id: "quotes",
      noun: "quote",
      label: "Quotes",
      schema: {
        fields: fields([
          ["words", "string", true],
          ["who", "string", false],
          ["year", "number", false],
        ]),
      },
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
    },
    previewSamples: [
      {
        record: {
          id: "quote-1",
          words: "The map is not the territory.",
          who: "Alfred Korzybski",
          year: 1931,
        },
        previewInnerHtml: [
          '<div class="stack gap-2">',
          '<span class="text-lg text-bold line-clamp-3">The map is not the territory.</span>',
          '<div class="cluster gap-1 text-xs">',
          '<span class="text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">Alfred Korzybski</span>',
          '<span class="text-muted">1931</span>',
          "</div>",
          "</div>",
        ].join(""),
      },
      {
        record: {
          id: "quote-2",
          words: "Make the easy thing the right thing.",
          who: null,
          year: null,
        },
        previewInnerHtml: [
          '<div class="stack gap-2">',
          '<span class="text-lg text-bold line-clamp-3">Make the easy thing the right thing.</span>',
          "</div>",
        ].join(""),
      },
    ],
    rendererSource: [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const words = escapeHtml(record.words);",
      "  const who =",
      "    record.who === null",
      '      ? ""',
      '      : `<span class="text-bold truncate" style="background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${escapeHtml(record.who)}</span>`;',
      '  const year = record.year === null ? "" : `<span class="text-muted">${escapeHtml(record.year)}</span>`;',
      '  const meta = who + year ? `<div class="cluster gap-1 text-xs">${who}${year}</div>` : "";',
      "",
      '  return `<div class="stack gap-2">',
      '    <span class="text-lg text-bold line-clamp-3">${words}</span>',
      "    ${meta}",
      "  </div>`;",
      "}",
      "",
      ESCAPE_HELPER_SOURCE,
    ].join("\n"),
  },
];

/** One file field a card shows: the families it takes, and whether it holds a list. */
export interface ShownFile {
  readonly accepts: readonly FileFamily[];
  readonly list: boolean;
}

const takesAPicture = (families: readonly FileFamily[]) =>
  families.some((family) => family === "image" || family === "video");

/**
 * The exemplars a card is shown: every one without a file, and each one whose file can be any
 * file a shown field holds. Its families cover the field's, it takes a picture exactly when the
 * field does, so an empty frame means the same thing in both, and it holds a list exactly when
 * the field does.
 */
export function fewShotExamplesFor(shown: readonly ShownFile[]): readonly FewShotDesignExample[] {
  return FEW_SHOT_DESIGN_EXAMPLES.filter((example) => {
    const file = example.capability.schema.fields.find((field) => isFileFieldType(field.type));
    if (!file) return true;
    const accepts = file.accepts ?? [];
    return shown.some(
      (field) =>
        field.accepts.every((family) => accepts.includes(family)) &&
        takesAPicture(field.accepts) === takesAPicture(accepts) &&
        field.list === isFileListFieldType(file.type),
    );
  });
}

/** @param shown the file fields the card shows */
export function buildItemRendererDesignInjection(
  layout: UiCollectionLayout,
  shown: readonly ShownFile[] = [],
): string {
  const examples = fewShotExamplesFor(shown);
  return [
    "Injected design contract and few-shot gallery:",
    "",
    "Closed primitive classes:",
    allowedClassList(),
    "",
    "Inline style escape hatch:",
    "- Use inline `style` only when the primitive classes cannot express the composition.",
    "- Three axes are closed: name a High Meadow token, never write a value.",
    `  - colour: ${tokenList(PALETTE_COLOR_TOKENS)}`,
    `  - type size: ${tokenList(TYPE_SIZE_TOKENS)}`,
    `  - spacing: ${tokenList(SPACING_TOKENS)}`,
    "- Two palette colours carry a meaning as well as a value. `--ink` draws lines and sets type and is never a background or a fill; type at lower strengths is `--ink-2` and `--ink-3`. `--signal` is reserved for alerts and destructive confirmation, so an ordinary record never decorates itself with it.",
    "- Four properties are never declared at all: `font-family` (an item inherits the face of the surface it sits on), `border` (every boundary on this surface is drawn by hand by the platform, the record's own included — a CSS edge would sit beside the drawn one, so there is no weight to name; `outline` and `column-rule` are the same edge under other names), `border-radius` (there are no radius tokens — every corner is mitred, and a square corner is the absence of a declaration) and `box-shadow` (nothing inside a window casts, and the shadow tokens are bare `<x> <y> <alpha>` numbers, so `box-shadow: var(--shadow-window)` is an invalid value that fails silently).",
    "- Without a border, separation comes from the palette and the spacing: a filled `background-color` block, a change of type size or weight, or a gap. Hierarchy is what a reader sees, not what a line encloses.",
    "- An `<hr>` is a line too, and the browser draws it without a declaration, so it is not available either. Neither is filling a box with `--ink`, `--ink-2` or `--ink-3`: an ink block wrapped round a lighter one is a border by another route. A filled block names one of the five surfaces or one of the eight tints.",
    "- The shadow rule is about the effect, not the property: `text-shadow`, `filter: drop-shadow(...)` and `-webkit-box-reflect` are out for the same reason. So is `all`, which would reset the inherited face and colour the surface supplies.",
    "- The platform owns where a record sits: no `position: absolute|fixed|sticky`, no `transform`, `translate`, `scale` or `zoom`, and offsets like `top`/`left` name a spacing token like any other length.",
    "- Never put record values in a `style` attribute. Never use `url(...)`, `position: absolute`, `position: fixed`, event handlers, scripts, links, buttons, inputs, or custom classes.",
    "",
    `Chosen collection layout for this capability: "${layout}".`,
    layout === "feed"
      ? "Compose one full-width record that scans comfortably in a vertical feed."
      : "Compose one compact record that remains legible in a responsive grid cell.",
    "",
    "Few-shot gallery. Vary, don't copy:",
    "- Treat these as range examples for the contract, not templates to clone.",
    "- Keep the export shape and safety discipline, but choose hierarchy, ordering, density, and emphasis from this capability's own fields.",
    "- Prefer examples with the matching collection layout, then borrow only small composition ideas from the others when useful.",
    ...examples.flatMap(formatExampleForPrompt),
  ].join("\n");
}

function formatExampleForPrompt(example: FewShotDesignExample, index: number): string[] {
  return [
    "",
    `Example ${index + 1}: ${example.title}`,
    `- collection.layout: ${example.layout}`,
    `- Suited for: ${example.suitedFor}`,
    `- Composition: ${example.composition}`,
    `- Notes: ${example.notes.join(" ")}`,
    "```ts",
    example.rendererSource,
    "```",
  ];
}

function allowedClassList(): string {
  return [...ALLOWED_CLASSES].sort().join(", ");
}
