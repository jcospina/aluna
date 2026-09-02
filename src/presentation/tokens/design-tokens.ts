// The token half of the closed-value design contract — the *names* generated markup may
// pick from on the three closed axes, re-derived against High Meadow (Module 5, epic
// 5.1; ADR-0005 §4 as amended 2026-08-20; `modules/05-the-desk/PLAN.md` decision 10).
//
// Names live here and in `design/design-system.md`; every *value* lives once in
// `design/styles/tokens.css`. This file states no value, so the two cannot disagree
// about one — and `design-tokens.test.ts` cross-checks every name below against that
// stylesheet, the same way `vocabulary.test.ts` cross-checks the class allow-list
// against its CSS. A token renamed in High Meadow fails the suite rather than silently
// becoming an off-token value the gate rejects at build time.
//
// Both enforcement surfaces key on these sets: `style-discipline.ts` at render time and
// the design-lint gate rung at build time.
//
// Three axes, and there is no fourth. ADR-0005's border weight is retired rather than
// re-derived (epic 5.2): every boundary on the surface is drawn by the ink system, so
// `border` is never declared and there is nothing to pick from — the same shape
// `border-radius` and `box-shadow` already have. `--line` survives in
// `design/styles/tokens.css` as the room a platform component reserves for that drawn
// line; it is not a value a record names, so it has no set here.

/**
 * The High Meadow palette — the closed colour list. Five fills build every surface,
 * `--ink` draws every line and sets every piece of type (never a background, never a
 * fill), `--ink-2`/`--ink-3` are type at lower strengths, eight tint anchors carry role
 * and identity, and `--signal` is reserved for alerts and destructive confirmation.
 *
 * The chrome-only colours are deliberately absent, because they are not the palette a
 * record picks from: the title-bar panes, the partial-strength ink the ink system draws
 * shadows and hairlines with, and the focus ring the shell paints.
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
 * The High Meadow size set. `--type-xs` through `--type-xl` are the everyday ladder;
 * `--type-title` is the window title's locked size and `--type-display` the one clamped
 * display size. All eight are on-token — the last two carry a platform *role* rather
 * than a restriction, and a record that reaches for one is off-key, not off-contract.
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

/** Whether `token` names a token in `names` — `var(--name)`, with the whitespace CSS allows
 *  inside the parentheses. A fallback form (`var(--x, red)`) is deliberately not accepted:
 *  it could launder an off-token value. */
export function isTokenFrom(token: string, names: ReadonlySet<string>): boolean {
  const match = /^var\(\s*--([a-z0-9_-]+)\s*\)$/.exec(token);
  return match?.[1] !== undefined && names.has(match[1]);
}
