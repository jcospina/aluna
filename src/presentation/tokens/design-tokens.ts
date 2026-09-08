// The token half of the closed-value design contract — the names generated markup may pick from
// on the three closed axes, re-derived against High Meadow (epic 5.1; ADR-0005 §4 as amended
// 2026-08-20; `modules/05-the-desk/PLAN.md` decision 10).
//
// Names live here and in `design/design-system.md`; every value lives once in
// `design/styles/tokens.css`, so the two cannot disagree about one, and `design-tokens.test.ts`
// cross-checks every name below against that stylesheet. Both enforcement surfaces key on these
// sets: `style-discipline.ts` at render time and the design-lint gate rung at build time.
//
// There is no fourth axis. ADR-0005's border weight is retired (epic 5.2): every boundary is
// drawn by the ink system, so `border` is never declared. `--line` survives in the stylesheet as
// the room a platform component reserves for that drawn line, not a value a record names.

/**
 * The closed colour list a record picks from: five fills, `--ink` and its two weaker type
 * strengths, eight tint anchors, `--signal` for alerts. Panes, shadow ink and the ring are chrome.
 */
export const PALETTE_COLOR_TOKENS: ReadonlySet<string> = new Set([
  // The five fills
  "ground",
  "ground-deep",
  "surface",
  "surface-2",
  "ink",
  // Ink at reading strengths — type only
  "ink-2",
  "ink-3",
  // The eight tint anchors
  "leaf",
  "shade",
  "teal",
  "sky",
  "sun",
  "ochre",
  "clay",
  "violet",
  // Reserved
  "signal",
]);

/**
 * The High Meadow size set: `--type-xs` to `--type-xl` is the everyday ladder, `--type-title`
 * and `--type-display` platform roles. All eight are on-token; reaching for a role is off-key.
 */
export const TYPE_SIZE_TOKENS: ReadonlySet<string> = new Set([
  "type-xs",
  "type-sm",
  "type-base",
  "type-md",
  "type-lg",
  "type-xl",
  "type-title",
  "type-display",
]);

/** The High Meadow spacing set — eight steps, and nothing between them. */
export const SPACING_TOKENS: ReadonlySet<string> = new Set([
  "space-1",
  "space-2",
  "space-3",
  "space-4",
  "space-5",
  "space-6",
  "space-7",
  "space-8",
]);

/** Render a token set as the `var(--name)` list a refusal or a prompt names it by. */
export function tokenList(tokens: ReadonlySet<string>): string {
  return [...tokens].map((name) => `var(--${name})`).join(", ");
}

/** Whether `token` names a token in `names` — `var(--name)`, with the whitespace CSS allows.
 *  A fallback form (`var(--x, red)`) is refused, because it could launder an off-token value. */
export function isTokenFrom(token: string, names: ReadonlySet<string>): boolean {
  const match = /^var\(\s*--([a-z0-9_-]+)\s*\)$/.exec(token);
  return match?.[1] !== undefined && names.has(match[1]);
}
