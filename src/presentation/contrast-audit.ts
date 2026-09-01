/**
 * The contrast audit: every foreground/background pairing the product declares.
 *
 * PLAN decision 43 commits to WCAG AA for text and controls and narrows the rest
 * of D8 to best-effort. That commitment is affordable because High Meadow is
 * closed — a fixed palette, and a fixed set of places one of its colours is put
 * on another. This file is that set. It does not claim every palette colour
 * passes against every other; it claims that each pairing the stylesheets
 * actually declare has been measured and passes the threshold that applies to it.
 *
 * Two things make it an audit rather than a note. Every row is measured from the
 * live token values, so changing `--ink-3` re-measures rather than leaving a
 * number that was true of the colour it replaced. And every `color`, `outline`
 * and `opacity` declaration in every shipped stylesheet has to be claimed by a
 * row: a new one fails the audit until it is classified, which is what stops the
 * inventory going quietly out of date.
 *
 * `opacity` is here because it changes what a pairing measures. A link dimmed to
 * 0.66 on the menu bar was 3.67 against the bar behind it while its declared
 * colour, ink, was 8.13 — the failure lived in a property that names no colour
 * at all.
 */

import type { Colour } from "./contrast.js";
import { CONTROL_PAIRINGS } from "./contrast-pairings-controls.js";
import { PREVIEW_PAIRINGS } from "./contrast-pairings-preview.js";
import { SURFACE_PAIRINGS } from "./contrast-pairings-surface.js";

/**
 * Which threshold a pairing answers to.
 *
 * `text` is WCAG 2.2 §1.4.3 at 4.5:1. `large-text` is the same criterion's 3:1
 * for type at 24px, or 18.66px bold. `non-text` is §1.4.11 at 3:1, for the parts
 * of a control you need to see to know it is there — a focus ring, a glyph, a
 * grip. `exempt` names one of §1.4.3's own exceptions and says which.
 */
export type Threshold = "text" | "large-text" | "non-text" | "exempt";

export const MINIMUM: Readonly<Record<Threshold, number>> = {
  text: 4.5,
  "large-text": 3,
  "non-text": 3,
  exempt: 0,
};

export interface Pairing {
  /** What a reader is looking at. */
  readonly what: string;
  readonly foreground: Colour;
  readonly background: Colour;
  readonly threshold: Threshold;
  /** Why this threshold, and anything the number alone does not say. */
  readonly note: string;
  /** Every declaration this pairing accounts for, as `sheet § selector [property]`. */
  readonly sites: readonly string[];
  /**
   * Fills this row measures on behalf of, because the one it names is the tightest
   * of the set and the rest can only read better. The audit checks that claim
   * rather than taking it, so a fill that stopped being lighter would fail here.
   */
  readonly alsoCovers?: readonly Colour[];
}

/** The stylesheets the product loads: the manifest, then the temporary shell bridge. */
export const AUDITED_SHEETS: readonly string[] = [
  // The token layer states no rule of its own, so it contributes no site — it is here
  // because the manifest imports it, and a list that skipped it would be a list with
  // an exception in it.
  "design/styles/tokens.css",
  "design/styles/base.css",
  "design/styles/layout.css",
  "design/styles/layout-kit.css",
  "design/styles/components/collection.css",
  "design/styles/components/controls.css",
  "design/styles/components/desk.css",
  "design/styles/components/doc.css",
  "design/styles/components/form-controls.css",
  "design/styles/components/ink.css",
  "design/styles/components/list-field.css",
  "design/styles/components/logo-contract.css",
  "design/styles/components/window.css",
  "public/css/base.css",
  "public/css/collection.css",
  "public/css/components.css",
  "public/css/deletion.css",
  "public/css/demo.css",
  "public/css/fields.css",
  "public/css/prompt.css",
  "public/css/record-view.css",
  "public/css/shell.css",
  // Served surfaces that carry their stylesheet inline rather than linking one. They
  // load after everything the manifest ships, so they are the last word on what they
  // name — and `ink-seam.test.ts` already had to learn the same lesson.
  "public/primitives-preview.html",
  "src/app/region-lifecycle-preview.ts",
  "src/app/swap-target-preview.ts",
  "src/builder/units/few-shot-gallery-preview.ts",
];

/**
 * Every property that can put a colour in front of a reader, or change what one is
 * read against. `color` is the obvious one and was nearly the only one: a UA-drawn
 * checkbox takes its colour from `accent-color`, a spinner from `border-top-color`,
 * and `-webkit-text-fill-color` overrides `color` outright wherever it is supported.
 * A property missing from this list is a pairing the audit cannot see.
 */
export const AUDITED_PROPERTIES: readonly string[] = [
  "color",
  "-webkit-text-fill-color",
  "outline",
  "opacity",
  "accent-color",
  "caret-color",
  "text-decoration-color",
  "column-rule-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "fill",
  "stroke",
];

/** Every pairing, in three files so each stays readable; see each for what it holds. */
export const PAIRINGS: readonly Pairing[] = [
  ...SURFACE_PAIRINGS,
  ...CONTROL_PAIRINGS,
  ...PREVIEW_PAIRINGS,
];
