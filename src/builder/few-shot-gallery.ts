// Repo-only few-shot item-renderer gallery (Module 3, epic 3.5).
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: exemplar source strings intentionally include item.ts template placeholders.
//
// These examples are generation guidance, not user-facing product UI. The builder
// injects them into the item-renderer prompt alongside the closed design contract and
// the capability's chosen collection layout. The preview route renders sample output
// from this same data as a developer sign-off surface.

import { ALLOWED_CLASSES } from "../presentation/vocabulary.ts";
import type { FieldType, SpecField, UiCollectionLayout, UiFormIntent } from "../registry/index.ts";

export interface FewShotPreviewCapability {
  readonly id: string;
  readonly label: string;
  readonly schema: { readonly fields: readonly SpecField[] };
  readonly form: UiFormIntent;
  readonly detail: { readonly shows: readonly string[] };
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
      "Composes only one record. The platform owns the trigger, payload, and modal.",
    ],
    capability: {
      id: "research_notes",
      label: "Research notes",
      schema: {
        fields: fields([
          ["title", "string", true],
          ["source", "string", false],
          ["excerpt", "string", false],
          ["tag", "string", false],
        ]),
      },
      form: { list_inputs: [] },
      detail: { shows: ["title", "source", "excerpt", "tag"] },
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
          '<span class="text-bold truncate" style="background-color: var(--color-feature); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">Field memo</span>',
          '<span class="text-bold" style="background-color: var(--color-warm); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">research</span>',
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
          '<span class="text-bold truncate" style="background-color: var(--color-feature); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">Interview synthesis</span>',
          '<span class="text-bold" style="background-color: var(--color-warm); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">patterns</span>',
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
      '      <span class="text-bold truncate" style="background-color: var(--color-feature); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">${source}</span>',
      '      <span class="text-bold" style="background-color: var(--color-warm); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">${tag}</span>',
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
      "Uses the media-frame primitive with tokenized border and shadow for stronger presence.",
      "Escapes the image URL and text values before interpolation.",
    ],
    capability: {
      id: "photo_roll",
      label: "Photo roll",
      schema: {
        fields: fields([
          ["image_url", "string", true],
          ["title", "string", true],
          ["place", "string", false],
          ["taken_on", "date", false],
        ]),
      },
      form: { list_inputs: [] },
      detail: { shows: ["title", "place", "taken_on", "image_url"] },
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
          '<figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem; border: var(--border-thin) solid var(--color-accent); box-shadow: var(--shadow-sm);">',
          "<img src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%23f4c56f'/%3E%3Ccircle cx='78' cy='42' r='22' fill='%23d9825b'/%3E%3Cpath d='M0 94 L34 60 L58 82 L78 66 L120 104 V120 H0 Z' fill='%232f385c'/%3E%3C/svg%3E\" alt=\"\" loading=\"lazy\" decoding=\"async\">",
          "</figure>",
          '<span class="text-xl text-bold line-clamp-2">Morning market colors</span>',
          '<div class="cluster gap-1 text-xs">',
          '<span class="text-bold truncate" style="background-color: var(--color-info); color: var(--color-text); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">Valledupar</span>',
          '<time class="text-bold" style="background-color: var(--color-feature); color: var(--color-text); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);" datetime="2026-07-08">2026-07-08</time>',
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
          '<figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem; border: var(--border-thin) solid var(--color-accent); box-shadow: var(--shadow-sm);">',
          "<img src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%2378c7c9'/%3E%3Ccircle cx='36' cy='34' r='18' fill='%23f4c56f'/%3E%3Cpath d='M0 82 L22 70 L46 92 L74 58 L120 86 V120 H0 Z' fill='%23d9825b'/%3E%3Cpath d='M0 105 L42 82 L76 100 L120 78 V120 H0 Z' fill='%232f385c'/%3E%3C/svg%3E\" alt=\"\" loading=\"lazy\" decoding=\"async\">",
          "</figure>",
          '<span class="text-xl text-bold line-clamp-2">Workshop wall before launch</span>',
          '<div class="cluster gap-1 text-xs">',
          '<span class="text-bold truncate" style="background-color: var(--color-info); color: var(--color-text); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">Bogota</span>',
          '<time class="text-bold" style="background-color: var(--color-feature); color: var(--color-text); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);" datetime="2026-07-09">2026-07-09</time>',
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
      '    <figure class="media-frame media-frame--square w-full" style="margin: 0; aspect-ratio: 1 / 1; min-height: 12rem; border: var(--border-thin) solid var(--color-accent); box-shadow: var(--shadow-sm);">',
      '      <img src="${imageUrl}" alt="" loading="lazy" decoding="async">',
      "    </figure>",
      '    <span class="text-xl text-bold line-clamp-2">${title}</span>',
      '    <div class="cluster gap-1 text-xs">',
      '      <span class="text-bold truncate" style="background-color: var(--color-info); color: var(--color-text); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">${place}</span>',
      '      <time class="text-bold" style="background-color: var(--color-feature); color: var(--color-text); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);" datetime="${takenOn}">${takenOn}</time>',
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
      "Owned axes stay on tokens: gap, padding, color, border width, and border color all use var().",
    ],
    capability: {
      id: "saved_links",
      label: "Saved links",
      schema: {
        fields: fields([
          ["title", "string", true],
          ["url", "string", true],
          ["topic", "string", false],
          ["priority", "string", false],
        ]),
      },
      form: { list_inputs: [] },
      detail: { shows: ["title", "url", "topic", "priority"] },
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
          '<span class="text-xs text-bold" style="align-self: flex-start; background-color: var(--color-info); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">interface research</span>',
          "</div>",
          '<span class="text-sm text-bold" style="background-color: var(--color-accent); color: var(--color-text); border: var(--border-thin) solid var(--color-accent); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill); box-shadow: var(--shadow-sm);">later</span>',
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
          '<span class="text-xs text-bold" style="align-self: flex-start; background-color: var(--color-info); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">design system</span>',
          "</div>",
          '<span class="text-sm text-bold" style="background-color: var(--color-accent); color: var(--color-text); border: var(--border-thin) solid var(--color-accent); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill); box-shadow: var(--shadow-sm);">next</span>',
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
      '      <span class="text-xs text-bold" style="align-self: flex-start; background-color: var(--color-info); color: var(--color-text); border: var(--border-thin) solid var(--color-border); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill);">${topic}</span>',
      "    </div>",
      '    <span class="text-sm text-bold" style="background-color: var(--color-accent); color: var(--color-text); border: var(--border-thin) solid var(--color-accent); padding: var(--space-0_5) var(--space-1); border-radius: var(--radius-pill); box-shadow: var(--shadow-sm);">${priority}</span>',
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
    "- Color must use `var(--color-*)`; font family is never declared; type scale must use `var(--type-*)`; spacing must use `var(--space-*)`; border weight must use `var(--border-thin | --border-regular | --border-thick)`.",
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
