// Token-discipline for the inline-`style` escape hatch (ADR-0005 §4, amended 2026-07-01
// and re-derived against High Meadow 2026-08-20; design/design-system.md "What a
// generated screen may declare").
//
// The escape hatch relaxed only *off-token style*, never the executable surface. So
// `sanitizeStyle` works declaration by declaration: it *drops* a declaration that names
// a never-declared property (font family, `border-radius`, a shadow, `all`), *drops* one
// that sets a closed axis with an off-token value (colour, type size, spacing, and — until
// epic 5.2 hands boundaries to the ink system — border weight), *drops* forbidden
// constructs (`url(...)`, `expression(...)`, gradients and colour functions, item-escaping
// `position`, raw colours, inline custom-property definitions), and *passes conforming
// declarations through*. A fully-conforming value comes back byte-identical so the enforcer
// can leave it untouched; anything hostile smuggled into `style` comes out inert.
//
// Every check reads one canonical property name: vendor-deprefixed, and refused outright if
// it is not a plain ident. A property is a CSS ident token, so `\66 ont-family` *is*
// `font-family` to a browser — an axis or a ban keyed on the string as written is closed in
// name only.
//
// `describeStyleViolation` is the same walk with the verdict inverted: it names the first
// declaration that would be dropped and why. The design-lint gate rung uses it to refuse a
// generated renderer in the contract's own words instead of in a before/after diff.
//
// The token *names* live in design-tokens.ts and the values in `design/styles/tokens.css`;
// nothing here restates either.
//
// This deliberately is not a full CSS parser. Its security guarantee (nothing here can
// load a resource or run script) is airtight; its brand guarantee (off-token values on
// the closed axes are removed) is complete for the well-structured properties and backed
// everywhere by raw-colour/`url(` detection. A stray *named* colour inside a shorthand this
// file leaves free (`outline-offset: thistle`, say) is inert and is caught at build time by
// the design-lint gate rung; it is the one documented residual.

import {
  isTokenFrom,
  LINE_WEIGHT_TOKENS,
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "./design-tokens.ts";

/** Sanitize an inline `style` value. Returns the input unchanged when every declaration
 * conforms, the surviving declarations rejoined when some are dropped, or `""` when none
 * survive. */
export function sanitizeStyle(value: string): string {
  const survivors: string[] = [];
  let dropped = false;

  for (const declaration of declarationsOf(value)) {
    if (checkDeclaration(declaration) === undefined) survivors.push(declaration);
    else dropped = true;
  }

  if (survivors.length === 0) return ""; // nothing worth keeping (all empty or all dropped)
  if (!dropped) return value; // byte-identical passthrough for a conforming value
  return survivors.join("; ");
}

/**
 * Name the first off-contract declaration in an inline `style` value, in the design
 * contract's own words, or `undefined` when the whole value conforms. Every reason
 * `sanitizeStyle` would drop on is reported here, so the two can never disagree about
 * what conforms.
 */
export function describeStyleViolation(value: string): string | undefined {
  const declarations = declarationsOf(value);
  // A `style` holding nothing is reported rather than passed over. For a whitespace or
  // semicolon-only value the two surfaces would otherwise disagree — `sanitizeStyle` returns
  // `""`, the enforcer removes the attribute, and the markup stops being byte-identical. A
  // literally empty `style=""` does survive enforcement untouched, and is refused here
  // anyway: it is a declaration of nothing, and saying so gives the fix loop a rule to act
  // on instead of leaving an empty attribute to the before/after dump.
  if (declarations.length === 0) {
    return "`style` holds no declaration — leave the attribute off rather than empty";
  }
  for (const declaration of declarations) {
    const reason = checkDeclaration(declaration);
    if (reason) return `\`${declaration}\` — ${reason}`;
  }
  return undefined;
}

/** The non-empty declarations of a `style` value, trimmed. */
function declarationsOf(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0); // skip empty segments (e.g. a trailing `;`)
}

const MALFORMED = "a declaration must read `property: value`";

/** Split `prop: value` and route to the bans and the axis checks. Returns the reason the
 *  declaration is off-contract, or `undefined` when it conforms. */
function checkDeclaration(declaration: string): string | undefined {
  const colon = declaration.indexOf(":");
  if (colon === -1) return MALFORMED;

  const written = declaration.slice(0, colon).trim().toLowerCase();
  const value = declaration.slice(colon + 1).trim();
  if (written.length === 0 || value.length === 0) return MALFORMED;

  if (written.startsWith("--")) return "inline custom-property definitions are not allowed";

  // One canonical property name for every check below. A CSS property is an ident token, so
  // `\66 ont-family` *is* `font-family` to a browser while reading nothing like it as a
  // string — and a vendor prefix names the same axis the bare property does. Deprefix, then
  // insist on a plain ident: nothing a record legitimately declares needs an escape, so
  // rather than implement ident unescaping, anything that is not a plain ident is refused.
  const prop = deprefix(written);
  if (!PLAIN_IDENT.test(prop)) {
    return "a property name is a plain CSS ident — an escape sequence or a character reference in it hides the property it really names";
  }

  const banned = neverDeclaredReason(prop);
  if (banned) return banned;

  // Read against what was *written*, not the trimmed ident: entity-smuggled constructs live
  // in the value, and this is where they are caught.
  if (hasForbiddenConstruct(value)) {
    return "the value uses a forbidden construct — `url(...)`, a gradient or colour function, a legacy script vector, a raw hex colour, or a character reference hiding one of them";
  }
  if (prop === "position") {
    return isSafePosition(value)
      ? undefined
      : "a record may not escape its own bounds; only `static` and `relative` are allowed";
  }

  return offAxisReason(prop, tokenize(withoutImportant(value)));
}

/** Strip a vendor prefix so a prefixed property is held to the same rule as the bare one. */
function deprefix(prop: string): string {
  return prop.replace(/^-(?:webkit|moz|ms|o)-/, "");
}

const PLAIN_IDENT = /^[a-z][a-z0-9-]*$/;

/** `!important` changes who wins, not what value is named, so it is dropped before the axis
 *  check rather than read as an off-token token. */
function withoutImportant(value: string): string {
  return value.replace(/\s*!\s*important$/i, "").trim();
}

/** The never-declared properties (PLAN decision 10), keyed on the deprefixed ident. Every
 *  `border-radius` longhand — physical and logical — falls out of the one `-radius` suffix,
 *  and the shadow ban is written around the *effect* rather than around one property name,
 *  because its stated reason is that nothing inside a window casts. */
function neverDeclaredReason(prop: string): string | undefined {
  if (prop === "font" || prop === "font-family") {
    return "font family is never declared — an item inherits the face of the surface it sits on";
  }
  if (prop === "all") {
    return "`all` is never declared — it resets the face, colour and metrics the surface supplies, which is the inheritance every other rule here depends on";
  }
  if (prop === "border-radius" || prop.endsWith("-radius")) {
    return "`border-radius` is never declared — High Meadow has no radius tokens, every corner is mitred, and a square corner is the absence of a declaration rather than a value of zero";
  }
  if (prop === "box-shadow" || prop === "text-shadow" || prop === "box-reflect") {
    return "a shadow is never declared — nothing inside a window casts, and the shadow tokens are bare `<x> <y> <alpha>` numbers, so `box-shadow: var(--shadow-window)` is an invalid value that fails silently";
  }
  if (BOUNDS_ESCAPING_PROPS.has(prop)) {
    return "a record may not move or scale out of its own bounds — the platform owns where a record sits, the same reason `position: fixed` is refused";
  }
  return undefined;
}

/** The other ways out of the item's box. `position` has its own keyword check and the
 *  offsets are held to the spacing set; these move or scale the whole record instead, which
 *  is the same harm the bounds rule already names. Width and height stay free — ADR-0005
 *  puts them among the arrangement properties a record composes with. */
const BOUNDS_ESCAPING_PROPS: ReadonlySet<string> = new Set([
  "transform",
  "translate",
  "scale",
  "zoom",
]);

/** On the closed axes, every token must be a High Meadow token (or a structural zero or
 * keyword); a property outside the closed axes is free (it has already cleared the bans
 * and the construct scan). */
function offAxisReason(prop: string, tokens: readonly string[]): string | undefined {
  if (tokens.length === 0) return MALFORMED;
  const axis = CLOSED_AXES.find((candidate) => candidate.owns(prop));
  if (!axis) return undefined;
  return tokens.every(axis.accepts) ? undefined : axis.refusal();
}

/** The refusal for a closed axis: name the axis and the set it picks from. */
function offToken(axis: string, tokens: ReadonlySet<string>): string {
  return `${axis} is picked from the High Meadow set and never written as a value — name one of ${tokenList(tokens)}`;
}

/**
 * Forbidden constructs and raw colours, property-agnostic. `url(`, `image-set(`, `image(`,
 * `src(`, `cross-fade(`, `element(` and `paint(` all load or synthesize a resource;
 * `expression(`/`-moz-binding` are legacy script vectors; `drop-shadow(` casts
 * the shadow the shadow ban exists to prevent; `/* *​/` comments, angle brackets,
 * backslashes and `@` are smuggling shapes; and a raw hex, gradient or colour-function
 * value is off-token on the colour axis wherever it appears.
 *
 * `&` is here for the same reason as `\\`. Values reach this function as the browser
 * received them, *not* entity-decoded — Bun's `HTMLRewriter` hands back the raw attribute
 * text while the browser's own parser decodes it, so `&#x75;rl(...)` would read as harmless
 * `rl(` here and load a resource on screen. A CSS value a record legitimately writes has no
 * use for `&`, so refusing it closes the whole family rather than one encoding of it.
 */
function hasForbiddenConstruct(value: string): boolean {
  const v = value.toLowerCase();
  if (
    /(?:url|image-set|image|src|cross-fade|element|paint|expression|drop-shadow)\(|-moz-binding|\/\*|\*\/|javascript:|vbscript:|[<>\\@&]/.test(
      v,
    )
  ) {
    return true;
  }
  if (/#[0-9a-f]{3,8}/.test(v)) return true; // raw hex colour
  return COLOR_FUNCTION.test(v);
}

/** Colour-producing functions. A gradient is a colour value written out rather than named,
 *  so it belongs here beside `rgb()` and `oklch()` — the one gradient High Meadow states is
 *  `--title-bar`, which is chrome and not a record's to paint with. */
const COLOR_FUNCTION =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color|device-cmyk|light-dark|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/;

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
// Custom-property names are case-sensitive, so the `var(--name)` forms are matched
// case-sensitively against the lowercase names High Meadow authored (a bare `var(--name)`
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
/** `normal` is the gap properties' initial value — the absence of a gap, not a size. */
function isNormal(token: string): boolean {
  return token.toLowerCase() === "normal";
}
/** Keywords that are a colour property's own initial value rather than a colour: `auto` on
 *  `caret-color`/`accent-color`/`scrollbar-color`, and the three that name no paint. */
function isColorKeyword(token: string): boolean {
  return /^(?:transparent|currentcolor|none|auto)$/i.test(token);
}
function isLineStyle(token: string): boolean {
  return /^(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(token);
}

const isTypeOrGlobal = (t: string): boolean => isTokenFrom(t, TYPE_SIZE_TOKENS) || isGlobal(t);
const isSpacingToken = (t: string): boolean =>
  isTokenFrom(t, SPACING_TOKENS) || isZero(t) || isAuto(t) || isNormal(t) || isGlobal(t);
const isBorderWidthOrZero = (t: string): boolean =>
  isTokenFrom(t, LINE_WEIGHT_TOKENS) || isZero(t) || isGlobal(t);
const isColorTokenOrKeyword = (t: string): boolean =>
  isTokenFrom(t, PALETTE_COLOR_TOKENS) || isColorKeyword(t) || isGlobal(t);
const isBorderShorthandToken = (t: string): boolean =>
  isTokenFrom(t, LINE_WEIGHT_TOKENS) ||
  isZero(t) ||
  isLineStyle(t) ||
  isTokenFrom(t, PALETTE_COLOR_TOKENS) ||
  isColorKeyword(t) ||
  isGlobal(t);

// ── The closed axes ──────────────────────────────────────────────────────────────────
// One row per axis: which properties it owns, what it accepts, and what it says when a
// declaration misses. Membership is a *predicate* rather than a list, because a list can
// only ever name the properties someone thought of — `-webkit-text-fill-color` paints type
// and `background` fills a surface just as surely as `color` and `background-color` do, and
// an axis that enumerated its way around them would be closed in name only. Every property
// reaching these predicates has already been deprefixed and checked for a plain ident.

interface ClosedAxis {
  readonly owns: (prop: string) => boolean;
  readonly accepts: (token: string) => boolean;
  readonly refusal: () => string;
}

/** Spacing — margin/padding, gaps, the in-flow offsets, and the two indents. `position:
 *  relative` is legal, so the offsets that move a record out of its own bounds are held to
 *  the spacing set rather than left free. */
function isSpacingProp(prop: string): boolean {
  if (/^(?:margin|padding)(?:-|$)/.test(prop)) return true;
  if (prop === "gap" || prop.endsWith("-gap")) return true;
  if (/^(?:top|right|bottom|left)$/.test(prop)) return true;
  if (prop === "inset" || prop.startsWith("inset-")) return true;
  return prop === "text-indent" || prop === "border-spacing";
}

/** Colour — anything whose value is a colour. The `-color` suffix carries the whole family
 *  (`border-block-start-color`, `-webkit-text-fill-color`, `caret-color`, …); the rest are
 *  the properties that take a colour without saying so in their name. `background` is here
 *  because it *is* the surface fill — leaving it to the shorthand residual let a gradient
 *  and the chrome's own title-bar token through. */
function isColorProp(prop: string): boolean {
  if (prop === "color" || prop.endsWith("-color")) return true;
  return COLOR_VALUED_PROPS.has(prop);
}

const COLOR_VALUED_PROPS: ReadonlySet<string> = new Set([
  "background",
  "background-image",
  "fill",
  "stroke",
]);

/** Border weight — the width sub-axis. High Meadow has one weight: `var(--line)`, or a zero. */
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

/** Border/outline shorthands — width + line-style + colour, each of which must be on-token. */
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

const CLOSED_AXES: readonly ClosedAxis[] = [
  {
    owns: (prop) => prop === "font-size",
    accepts: isTypeOrGlobal,
    refusal: () => offToken("type size", TYPE_SIZE_TOKENS),
  },
  {
    owns: isSpacingProp,
    accepts: isSpacingToken,
    refusal: () => offToken("spacing", SPACING_TOKENS),
  },
  {
    owns: (prop) => BORDER_WIDTH_PROPS.has(prop),
    accepts: isBorderWidthOrZero,
    refusal: () => offToken("border weight", LINE_WEIGHT_TOKENS),
  },
  {
    owns: (prop) => BORDER_SHORTHAND_PROPS.has(prop),
    accepts: isBorderShorthandToken,
    refusal: () =>
      `a boundary is ${tokenList(LINE_WEIGHT_TOKENS)}, a line style, and a High Meadow palette colour — ${tokenList(PALETTE_COLOR_TOKENS)}`,
  },
  {
    owns: isColorProp,
    accepts: isColorTokenOrKeyword,
    refusal: () => offToken("colour", PALETTE_COLOR_TOKENS),
  },
];
