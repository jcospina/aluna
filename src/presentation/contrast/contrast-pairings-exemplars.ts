/**
 * The pairings inside the few-shot gallery's exemplars.
 *
 * These are the last rows that are not a stylesheet of ours. The exemplars carry no
 * `<style>` block at all — every colour is an inline `style` attribute — and they are fed
 * verbatim into the item-renderer prompt as approved examples, so a failure here is one
 * the platform *teaches* rather than one a reader merely meets. Read with
 * `contrast-audit.ts`.
 *
 * The developer preview pages this file used to measure came down with module 5, and
 * their rows went with them: they styled no product surface, and nothing renders them
 * any more.
 */

import type { Pairing } from "./contrast-audit.js";

export const EXEMPLAR_PAIRINGS: readonly Pairing[] = [
  {
    what: "a gallery exemplar's tinted chip",
    foreground: { token: "ink" },
    background: { token: "clay" },
    threshold: "text",
    note:
      "The exemplars are fed verbatim into the item-renderer prompt as approved " +
      "examples — so a failure here is one the platform teaches. Clay is the tightest " +
      "of the three tints these chips use. `--shade` was a fourth and carried `--ink` " +
      "at 2.644, under even the non-text floor; it takes `--surface` now, the way C12's " +
      "own swap does.",
    alsoCovers: [{ token: "sun" }, { token: "sky" }],
    sites: [
      "src/builder/units/generation/few-shot-gallery.ts § span.text-bold.truncate[style] [color]",
      "src/builder/units/generation/few-shot-gallery.ts § span.text-bold[style] [color]",
      "src/builder/units/generation/few-shot-gallery.ts § span.text-xs.text-bold[style] [color]",
      "src/builder/units/generation/few-shot-gallery.ts § time.text-bold[style] [color]",
    ],
  },
  {
    what: "a gallery exemplar's chip on shade",
    foreground: { token: "surface" },
    background: { token: "shade" },
    threshold: "text",
    note: "The C12 swap, in the exemplars: a light label is what shade can carry.",
    sites: [
      "src/builder/units/generation/few-shot-gallery.ts § span.text-sm.text-bold[style] [color]",
    ],
  },
];
