// Repo-only few-shot item-renderer gallery.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.
//
// These examples are generation guidance, not user-facing product UI. The builder
// injects them into the item-renderer prompt alongside the closed design contract and
// the capability's chosen collection layout. The preview route renders sample output
// from this same data as a developer sign-off surface.

import {
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "../../presentation/design-tokens.ts";
import { ALLOWED_CLASSES } from "../../presentation/vocabulary.ts";
import type {
  FieldType,
  SpecField,
  UiCollectionLayout,
  UiFormIntent,
} from "../../registry/index.ts";

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

const ESCAPE_HELPER_SOURCE = [
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

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
      form: { list_inputs: [], choice_inputs: [] },
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
      '  const source = escapeHtml(record.source ?? "Unlabeled source");',
      '  const excerpt = escapeHtml(record.excerpt ?? "");',
      '  const tag = escapeHtml(record.tag ?? "note");',
      "",
      '  return `<div class="stack gap-1">',
      '    <span class="text-xl text-bold line-clamp-2">${title}</span>',
      '    <div class="cluster gap-1 text-xs">',
      '      <span class="text-bold truncate" style="background-color: var(--sun); color: var(--ink); padding: var(--space-1) var(--space-1);">${source}</span>',
      '      <span class="text-bold" style="background-color: var(--clay); color: var(--ink); padding: var(--space-1) var(--space-1);">${tag}</span>',
      "    </div>",
      '    <p class="line-clamp-3 text-sm text-subtle">${excerpt}</p>',
      "  </div>`;",
      "}",
      "",
      ESCAPE_HELPER_SOURCE,
    ].join("\n"),
  },
  {
    id: "photo_grid_tile",
    title: "Media-forward grid tile",
    layout: "grid",
    suitedFor: "Visual records where the image should carry the scan pattern.",
    composition:
      "Large square media frame, bold caption, and vivid metadata chips. The image owns the tile while the text still scans in a responsive grid.",
    notes: [
      "Uses the media-frame primitive, whose own tinted fill gives the box presence without a boundary — the platform draws every line, and nothing inside a window casts a shadow.",
      "Escapes the image URL and text values before interpolation.",
    ],
    capability: {
      id: "photo_roll",
      noun: "photo",
      label: "Photo roll",
      schema: {
        fields: fields([
          ["image_url", "string", true],
          ["title", "string", true],
          ["place", "string", false],
          ["taken_on", "date", false],
        ]),
      },
      form: { list_inputs: [], choice_inputs: [] },
    },
    previewSamples: [
      {
        record: {
          id: "photo-1",
          image_url:
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%23f4c56f'/%3E%3Ccircle cx='78' cy='42' r='22' fill='%23d9825b'/%3E%3Cpath d='M0 94 L34 60 L58 82 L78 66 L120 104 V120 H0 Z' fill='%232f385c'/%3E%3C/svg%3E",
          title: "Morning market colors",
          place: "Valledupar",
          taken_on: "2026-07-08",
        },
        previewInnerHtml: [
          '<div class="stack gap-2">',
          '<figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem;">',
          "<img src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%23f4c56f'/%3E%3Ccircle cx='78' cy='42' r='22' fill='%23d9825b'/%3E%3Cpath d='M0 94 L34 60 L58 82 L78 66 L120 104 V120 H0 Z' fill='%232f385c'/%3E%3C/svg%3E\" alt=\"\" loading=\"lazy\" decoding=\"async\">",
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
          image_url:
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%2378c7c9'/%3E%3Ccircle cx='36' cy='34' r='18' fill='%23f4c56f'/%3E%3Cpath d='M0 82 L22 70 L46 92 L74 58 L120 86 V120 H0 Z' fill='%23d9825b'/%3E%3Cpath d='M0 105 L42 82 L76 100 L120 78 V120 H0 Z' fill='%232f385c'/%3E%3C/svg%3E",
          title: "Workshop wall before launch",
          place: "Bogota",
          taken_on: "2026-07-09",
        },
        previewInnerHtml: [
          '<div class="stack gap-2">',
          '<figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem;">',
          "<img src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%2378c7c9'/%3E%3Ccircle cx='36' cy='34' r='18' fill='%23f4c56f'/%3E%3Cpath d='M0 82 L22 70 L46 92 L74 58 L120 86 V120 H0 Z' fill='%23d9825b'/%3E%3Cpath d='M0 105 L42 82 L76 100 L120 78 V120 H0 Z' fill='%232f385c'/%3E%3C/svg%3E\" alt=\"\" loading=\"lazy\" decoding=\"async\">",
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
      '  const imageUrl = escapeHtml(record.image_url ?? "");',
      "  const title = escapeHtml(record.title);",
      '  const place = escapeHtml(record.place ?? "Unplaced");',
      '  const takenOn = escapeHtml(record.taken_on ?? "");',
      "",
      '  return `<div class="stack gap-2">',
      '    <figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem;">',
      '      <img src="${imageUrl}" alt="" loading="lazy" decoding="async">',
      "    </figure>",
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
  },
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
      form: { list_inputs: [], choice_inputs: [] },
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
          '<span class="text-sm text-bold" style="background-color: var(--shade); color: var(--ink); padding: var(--space-1) var(--space-1);">later</span>',
          "</div>",
        ].join(""),
      },
      {
        record: {
          id: "link-2",
          title: "Token discipline for generated interfaces",
          url: "https://example.com/token-discipline",
          topic: "design system",
          priority: "next",
        },
        previewInnerHtml: [
          '<div class="grid" style="grid-template-columns: minmax(0, 1fr) max-content; gap: var(--space-2); align-items: center;">',
          '<div class="stack gap-0_5">',
          '<span class="text-lg text-bold truncate">Token discipline for generated interfaces</span>',
          '<span class="text-sm text-muted truncate">https://example.com/token-discipline</span>',
          '<span class="text-xs text-bold" style="align-self: flex-start; background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">design system</span>',
          "</div>",
          '<span class="text-sm text-bold" style="background-color: var(--shade); color: var(--ink); padding: var(--space-1) var(--space-1);">next</span>',
          "</div>",
        ].join(""),
      },
    ],
    rendererSource: [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const title = escapeHtml(record.title);",
      "  const url = escapeHtml(record.url);",
      '  const topic = escapeHtml(record.topic ?? "reference");',
      '  const priority = escapeHtml(record.priority ?? "later");',
      "",
      '  return `<div class="grid" style="grid-template-columns: minmax(0, 1fr) max-content; gap: var(--space-2); align-items: center;">',
      '    <div class="stack gap-0_5">',
      '      <span class="text-lg text-bold truncate">${title}</span>',
      '      <span class="text-sm text-muted truncate">${url}</span>',
      '      <span class="text-xs text-bold" style="align-self: flex-start; background-color: var(--sky); color: var(--ink); padding: var(--space-1) var(--space-1);">${topic}</span>',
      "    </div>",
      '    <span class="text-sm text-bold" style="background-color: var(--shade); color: var(--ink); padding: var(--space-1) var(--space-1);">${priority}</span>',
      "  </div>`;",
      "}",
      "",
      ESCAPE_HELPER_SOURCE,
    ].join("\n"),
  },
];

export function buildItemRendererDesignInjection(layout: UiCollectionLayout): string {
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
    ...FEW_SHOT_DESIGN_EXAMPLES.flatMap(formatExampleForPrompt),
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

function fields(
  rows: readonly (readonly [name: string, type: FieldType, required: boolean])[],
): SpecField[] {
  return rows.map(([name, type, required]) => ({
    name,
    label: name,
    type,
    required,
    lifecycle: "active",
  }));
}
