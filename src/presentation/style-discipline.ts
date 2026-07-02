// Token-discipline for the inline-`style` escape hatch (ADR-0005 §4 as amended
// 2026-07-01; epic 3.1/01, docs/design-system.md "The inline-`style` escape hatch").
//
// The escape hatch relaxed only *off-token style*, never the executable surface. So
// `sanitizeStyle` works declaration by declaration: it *drops* a declaration that sets
// one of the five platform-owned axes with an off-token value (color/font/type/spacing/
// border weight), *drops* forbidden constructs (`url(...)`, `expression(...)`,
// item-escaping `position`, raw colors, inline custom-property definitions), and *passes
// conforming declarations through*. A fully-conforming value comes back byte-identical
// so the enforcer can leave it untouched; anything hostile smuggled into `style` comes
// out inert.
//
// This deliberately is not a full CSS parser. Its security guarantee (nothing here can
// load a resource or run script) is airtight; its brand guarantee (off-token values on
// the owned axes are removed) is complete for the well-structured properties and backed
// everywhere by raw-color/`url(` detection. A stray *named* color inside a mixed
// shorthand (`background`, `box-shadow`) is inert and is caught at build time by the
// design-lint gate rung (3.6); it is the one documented residual.

/** Sanitize an inline `style` value. Returns the input unchanged when every declaration
 * conforms, the surviving declarations rejoined when some are dropped, or `""` when none
 * survive. */
export function sanitizeStyle(value: string): string {
  const survivors: string[] = [];
  let dropped = false;

  for (const part of value.split(";")) {
    const declaration = part.trim();
    if (declaration.length === 0) continue; // empty segment (e.g. a trailing `;`)

    if (isConformingDeclaration(declaration)) survivors.push(declaration);
    else dropped = true;
  }

  if (survivors.length === 0) return ""; // nothing worth keeping (all empty or all dropped)
  if (!dropped) return value; // byte-identical passthrough for a conforming value
  return survivors.join("; ");
}

/** Split `prop: value` and route to the axis checks; malformed declarations are dropped. */
function isConformingDeclaration(declaration: string): boolean {
  const colon = declaration.indexOf(":");
  if (colon === -1) return false;

  const prop = declaration.slice(0, colon).trim().toLowerCase();
  const value = declaration.slice(colon + 1).trim();
  if (prop.length === 0 || value.length === 0) return false;

  if (prop.startsWith("--")) return false; // no inline custom-property definitions
  if (hasForbiddenConstruct(value)) return false; // url()/expression()/raw color/etc.
  if (prop === "position") return isSafePosition(value);
  if (prop === "font" || prop === "font-family") return false; // font family never declared

  return isOnTokenForAxis(prop, tokenize(value));
}

/** On the owned axes, every token must be a platform token (or a structural zero/keyword);
 * a property outside the owned axes is free (it has already cleared the construct scan). */
function isOnTokenForAxis(prop: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  if (TYPE_SIZE_PROPS.has(prop)) return tokens.every(isTypeOrGlobal);
  if (SPACING_PROPS.has(prop)) return tokens.every(isSpacingToken);
  if (BORDER_WIDTH_PROPS.has(prop)) return tokens.every(isBorderWidthOrZero);
  if (BORDER_SHORTHAND_PROPS.has(prop)) return tokens.every(isBorderShorthandToken);
  if (COLOR_ONLY_PROPS.has(prop)) return tokens.every(isColorTokenOrKeyword);
  return true;
}

/**
 * Forbidden constructs and raw colors, property-agnostic. `url(`/`image-set(` load
 * resources; `expression(`/`-moz-binding` are legacy script vectors; `/* *​/` comments,
 * angle brackets, backslashes, `@`, and `javascript:`/`vbscript:` are smuggling shapes;
 * and a raw hex or color-function value is off-token on the color axis wherever it
 * appears. Values are already HTML-entity-decoded by the parser before they reach here.
 */
function hasForbiddenConstruct(value: string): boolean {
  const v = value.toLowerCase();
  if (
    /url\(|image-set\(|expression\(|-moz-binding|\/\*|\*\/|javascript:|vbscript:|[<>\\@]/.test(v)
  ) {
    return true;
  }
  if (/#[0-9a-f]{3,8}/.test(v)) return true; // raw hex color
  return /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|device-cmyk)\(/.test(v);
}

/** `position` may stay in the item's own flow; values that escape its bounds are dropped. */
function isSafePosition(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "static" || v === "relative" || isGlobal(v);
}

/** Split a CSS value on top-level whitespace, keeping `var(...)`/`fn(...)` groups intact. */
function tokenize(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    depth = Math.max(0, depth + parenDelta(ch));
    if (depth > 0 || !/\s/.test(ch)) {
      current += ch;
      continue;
    }
    if (current.length > 0) tokens.push(current);
    current = "";
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function parenDelta(ch: string): number {
  if (ch === "(") return 1;
  if (ch === ")") return -1;
  return 0;
}

// ── Token predicates ─────────────────────────────────────────────────────────────────
// Custom-property names are case-sensitive, so the `var(--ns-*)` forms are matched
// case-sensitively against the lowercase tokens the CSS authored (a bare `var(--ns-name)`
// only — a fallback form could launder an off-token value, so it is not accepted). CSS
// keywords are matched case-insensitively.

function isGlobal(token: string): boolean {
  return /^(?:inherit|initial|unset|revert|revert-layer)$/i.test(token);
}
function isZero(token: string): boolean {
  return /^0(?:\.0+)?[a-z%]*$/i.test(token); // 0, 0px, 0.0, 0% …
}
function isAuto(token: string): boolean {
  return token.toLowerCase() === "auto";
}
function isTypeToken(token: string): boolean {
  return /^var\(--type-[a-z0-9_-]+\)$/.test(token);
}
function isSpaceToken(token: string): boolean {
  return /^var\(--space-[a-z0-9_-]+\)$/.test(token);
}
function isBorderWidthToken(token: string): boolean {
  return /^var\(--border-(?:thin|regular|thick)\)$/.test(token);
}
function isColorToken(token: string): boolean {
  return /^var\(--color-[a-z0-9_-]+\)$/.test(token);
}
function isColorKeyword(token: string): boolean {
  return /^(?:transparent|currentcolor|none)$/i.test(token);
}
function isLineStyle(token: string): boolean {
  return /^(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(token);
}

const isTypeOrGlobal = (t: string): boolean => isTypeToken(t) || isGlobal(t);
const isSpacingToken = (t: string): boolean =>
  isSpaceToken(t) || isZero(t) || isAuto(t) || isGlobal(t);
const isBorderWidthOrZero = (t: string): boolean =>
  isBorderWidthToken(t) || isZero(t) || isGlobal(t);
const isColorTokenOrKeyword = (t: string): boolean =>
  isColorToken(t) || isColorKeyword(t) || isGlobal(t);
const isBorderShorthandToken = (t: string): boolean =>
  isBorderWidthToken(t) ||
  isZero(t) ||
  isLineStyle(t) ||
  isColorToken(t) ||
  isColorKeyword(t) ||
  isGlobal(t);

// ── Owned-axis property sets ─────────────────────────────────────────────────────────

/** Type scale — the font-size axis. `font` (shorthand) is dropped outright, above. */
const TYPE_SIZE_PROPS: ReadonlySet<string> = new Set(["font-size"]);

/** Spacing — margin/padding/gap. Values must be `var(--space-*)`, a zero, or `auto`. */
const SPACING_PROPS: ReadonlySet<string> = new Set([
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-inline",
  "margin-block-start",
  "margin-block-end",
  "margin-inline-start",
  "margin-inline-end",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-inline",
  "padding-block-start",
  "padding-block-end",
  "padding-inline-start",
  "padding-inline-end",
  "gap",
  "row-gap",
  "column-gap",
  "grid-gap",
  "grid-row-gap",
  "grid-column-gap",
]);

/** Border weight — the width sub-axis. Values must be `var(--border-*)` or a zero. */
const BORDER_WIDTH_PROPS: ReadonlySet<string> = new Set([
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-block-width",
  "border-inline-width",
  "border-block-start-width",
  "border-block-end-width",
  "border-inline-start-width",
  "border-inline-end-width",
  "outline-width",
  "column-rule-width",
]);

/** Border/outline shorthands — width + line-style + color, each of which must be on-token. */
const BORDER_SHORTHAND_PROPS: ReadonlySet<string> = new Set([
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-block",
  "border-inline",
  "border-block-start",
  "border-block-end",
  "border-inline-start",
  "border-inline-end",
  "outline",
  "column-rule",
]);

/** Properties whose whole value is a color — must be `var(--color-*)` or a safe keyword. */
const COLOR_ONLY_PROPS: ReadonlySet<string> = new Set([
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-block-color",
  "border-inline-color",
  "border-block-start-color",
  "border-block-end-color",
  "border-inline-start-color",
  "border-inline-end-color",
  "outline-color",
  "text-decoration-color",
  "text-emphasis-color",
  "column-rule-color",
  "caret-color",
  "scrollbar-color",
  "fill",
  "stroke",
  "stop-color",
  "flood-color",
  "lighting-color",
  "accent-color",
]);
