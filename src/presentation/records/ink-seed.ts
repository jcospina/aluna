// The hand a drawn record is given, derived from the record's own id.
//
// A seed may never come from where an element sits, or it would re-roll on every move
// and every resize (`design/design-system.md`, The line). A record's id is the one
// thing about it that is stable across a view swap, a reorder and a resize, so it is
// what the hand is made of: two renders of the same record get the same hand wherever
// they land, and no two records share one by accident.
//
// The ink system reads the number off `data-ink-seed` at mount and never asks where it
// came from, so nothing about the generation pipeline changes to produce one.

import { seedFrom } from "#design/lib/random.js";

/** The attribute the ink system reads a pre-assigned hand from. */
export const INK_SEED_ATTR = "data-ink-seed";

/**
 * The seed for one record, or `null` when there is no id to derive it from — a
 * hand-built preview row, or a malformed record. Returning `null` rather than a
 * constant lets the ink system fall back to its own mount-order seed, so such a row is
 * still drawn and merely does not keep its hand across a swap.
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
