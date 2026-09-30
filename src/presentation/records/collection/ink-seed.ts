// The hand a drawn record is given, derived from the record's own id.
//
// A seed may never come from where an element sits, or it would re-roll on every move and every
// resize (`design/design-system.md`). A record's id is the one thing about it that is stable
// across a view swap, a reorder and a resize, so two renders of the same record get the same hand
// wherever they land. The ink system reads the number off `data-ink-seed` at mount and never asks
// where it came from, so nothing in the generation pipeline changes to produce one.

import { seedFrom } from "#design/lib/random.js";

/** The attribute the ink system reads a pre-assigned hand from. */
export const INK_SEED_ATTR = "data-ink-seed";

/**
 * The seed for one record, or `null` when there is no id to derive it from. `null` lets the ink
 * system fall back to its mount-order seed, so such a row is drawn but loses its hand on a swap.
 */
export function recordInkSeed(id: unknown): number | null {
  if (id === null || id === undefined) return null;
  const text = String(id);
  return text.length === 0 ? null : seedFrom(text);
}

/**
 * The seed attribute for one record, ready to sit in a start tag, or the empty string
 * when the record carries no id. The value is a bare integer, so it needs no escaping.
 */
export function inkSeedAttr(id: unknown): string {
  const seed = recordInkSeed(id);
  return seed === null ? "" : ` ${INK_SEED_ATTR}="${seed}"`;
}
