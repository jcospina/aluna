/**
 * The pairings on the developer preview surfaces.
 *
 * Four pages carry their stylesheet inline instead of linking one, and every one of
 * them loads after the whole manifest — so what they declare is the last word on
 * what they name, and leaving them out would have left the audit measuring a
 * surface nobody looks at while four that people do look at went unchecked.
 *
 * They are read on one of five fills, and the darkest is the banner's tint over the
 * desk. Everything here is measured against that one, so a row is conservative
 * wherever it actually lands. Read with `contrast-audit.ts`.
 */

import type { Pairing } from "./contrast-audit.js";

/** `color-mix(in oklch, var(--shade), transparent 90%)` — shade at a tenth, over the desk. */
const previewTint = { token: "shade", alpha: 0.1, over: { token: "ground" } } as const;

export const PREVIEW_PAIRINGS: readonly Pairing[] = [
  {
    what: "secondary type on a developer preview",
    foreground: { token: "ink-2" },
    background: previewTint,
    threshold: "text",
    note:
      "The banner tint over the desk is the darkest fill on any of these pages, so " +
      "every one of them is measured against it. `--ink-3` was here and is not any " +
      "more: on the desk it is 4.15, and these pages have no window under them.",
    alsoCovers: [
      { token: "shade", alpha: 0.08, over: { token: "surface" } },
      { token: "shade", alpha: 0.06, over: { token: "surface" } },
      { token: "surface" },
      { token: "ground" },
    ],
    sites: [
      "public/primitives-preview.html § .preview-banner [background]",
      "public/primitives-preview.html § .preview-banner [color]",
      "public/primitives-preview.html § .preview-note [color]",
      "src/app/region-lifecycle-preview.ts § .preview-banner [background]",
      "src/app/region-lifecycle-preview.ts § .preview-banner [color]",
      "src/app/region-lifecycle-preview.ts § .preview-readout [background]",
      "src/app/region-lifecycle-preview.ts § .preview-readout [color]",
      "src/app/region-lifecycle-preview.ts § .preview-view [color]",
      "src/app/swap-target-preview.ts § .preview-banner [background]",
      "src/app/swap-target-preview.ts § .preview-banner [color]",
      "src/app/swap-target-preview.ts § .preview-readout [background]",
      "src/app/swap-target-preview.ts § .preview-readout [color]",
      "src/app/swap-target-preview.ts § .preview-table tr:nth-child(odd) td, .preview-table tr:nth-child(odd) th [background]",
      "src/app/swap-target-preview.ts § .preview-view [color]",
      "src/builder/units/few-shot-gallery-preview.ts § .gallery-example__notes [color]",
      "src/builder/units/few-shot-gallery-preview.ts § .gallery-example__source summary [color]",
      "src/builder/units/few-shot-gallery-preview.ts § .preview-banner [background]",
      "src/builder/units/few-shot-gallery-preview.ts § .preview-banner [color]",
      "src/builder/units/few-shot-gallery-preview.ts § .preview-note [color]",
    ],
  },
  {
    what: "type on a developer preview",
    foreground: { token: "ink" },
    background: previewTint,
    threshold: "text",
    note: "The gallery's own examples and the code block under them.",
    alsoCovers: [{ token: "ink", alpha: 0.04, over: { token: "surface" } }],
    sites: [
      "src/builder/units/few-shot-gallery-preview.ts § .gallery-code [background]",
      "src/builder/units/few-shot-gallery-preview.ts § .gallery-code [color]",
      "src/builder/units/few-shot-gallery-preview.ts § .gallery-example__layout [color]",
    ],
  },
  {
    what: "a gallery exemplar's tinted chip",
    foreground: { token: "ink" },
    background: { token: "clay" },
    threshold: "text",
    note:
      "The exemplars themselves, which are not only rendered at `/demo/few-shot-gallery` " +
      "but fed verbatim into the item-renderer prompt as approved examples — so a failure " +
      "here is one the platform teaches. Clay is the tightest of the three tints these " +
      "chips use. `--shade` was a fourth and carried `--ink` at 2.644, under even the " +
      "non-text floor; it takes `--surface` now, the way C12's own swap does.",
    alsoCovers: [{ token: "sun" }, { token: "sky" }],
    sites: [
      "src/builder/units/few-shot-gallery.ts § span.text-bold.truncate[style] [color]",
      "src/builder/units/few-shot-gallery.ts § span.text-bold[style] [color]",
      "src/builder/units/few-shot-gallery.ts § span.text-xs.text-bold[style] [color]",
      "src/builder/units/few-shot-gallery.ts § time.text-bold[style] [color]",
    ],
  },
  {
    what: "a gallery exemplar's chip on shade",
    foreground: { token: "surface" },
    background: { token: "shade" },
    threshold: "text",
    note: "The C12 swap, in the exemplars: a light label is what shade can carry.",
    sites: ["src/builder/units/few-shot-gallery.ts § span.text-sm.text-bold[style] [color]"],
  },
];
