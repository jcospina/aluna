/**
 * The contrast audit: every foreground/background pairing the product declares.
 *
 * PLAN decision 43 commits to WCAG AA for text and controls and narrows the rest of D8 to
 * best-effort. Enumerating the pairings is affordable because High Meadow is closed. The audit
 * claims each declared pairing has been measured against the threshold that applies to it, not
 * that every palette colour passes against every other.
 *
 * Every row is measured from the live token values, so changing `--ink-3` re-measures. Every
 * `color`, `outline` and `opacity` declaration in a shipped stylesheet has to be claimed by a
 * row, so a new one fails until it is classified. `opacity` is here because it changes what a
 * pairing measures: a link dimmed to 0.66 on the menu bar was 3.67 against the bar behind it
 * while its declared colour was 8.13.
 */

import type { Colour } from "./contrast.js";
import { CONTROL_PAIRINGS } from "./contrast-pairings-controls.js";
import { EXEMPLAR_PAIRINGS } from "./contrast-pairings-exemplars.js";
import { SURFACE_PAIRINGS } from "./contrast-pairings-surface.js";

/**
 * Which threshold a pairing answers to: `text` is WCAG 2.2 §1.4.3 at 4.5:1, `large-text` the same
 * criterion's 3:1 at 24px or 18.66px bold, `non-text` §1.4.11 at 3:1, `exempt` a §1.4.3 exception.
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
   * Fills this row measures on behalf of, because the one it names is the tightest of the set.
   * The audit checks that claim rather than taking it, so a fill that stopped being lighter fails.
   */
  readonly alsoCovers?: readonly Colour[];
}

/** The stylesheets the product loads: the manifest, then the temporary shell bridge. */
export const AUDITED_SHEETS: readonly string[] = [
  // The token layer states no rule of its own, so it contributes no site. It is here because
  // the manifest imports it, and a list that skipped it would be a list with an exception in it.
  "design/styles/tokens.css",
  "design/styles/base.css",
  "design/styles/layout.css",
  "design/styles/layout-kit.css",
  "design/styles/components/collection.css",
  "design/styles/components/controls.css",
  "design/styles/components/desk.css",
  "design/styles/components/doc.css",
  "design/styles/components/file-field.css",
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
  // The gallery's exemplars paint through inline `style` attributes and are fed verbatim into
  // the item-renderer prompt as approved examples, so a failure here is one the platform teaches.
  "src/builder/units/generation/few-shot-gallery.ts",
];

/**
 * Every property that can put a colour in front of a reader: `accent-color` draws a checkbox,
 * `-webkit-text-fill-color` overrides `color`. One missing here is a pairing the audit misses.
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
  ...EXEMPLAR_PAIRINGS,
];
