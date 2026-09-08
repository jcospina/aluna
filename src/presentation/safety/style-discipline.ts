// Token-discipline for the inline-`style` escape hatch (ADR-0005 §4, amended 2026-07-01 and
// re-derived against High Meadow 2026-08-20; design/design-system.md).
//
// The escape hatch relaxed off-token style, never the executable surface, so `sanitizeStyle`
// works declaration by declaration. It drops a declaration that names a never-declared property,
// sets a closed axis with an off-token value, or carries a forbidden construct; everything
// conforming passes through byte-identical, so the enforcer can leave it untouched.
//
// Token names live in design-tokens.ts and their values in `design/styles/tokens.css`; nothing
// here restates either. This is not a full CSS parser, and two cases fail closed by dropping CSS
// that would have conformed: a comment anywhere in a declaration drops it whole, and a `;` inside
// a quoted string splits it.

import {
  isTokenFrom,
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "../tokens/design-tokens.ts";

/** Sanitize an inline `style` value: the input unchanged when every declaration conforms, the
 * survivors rejoined when some are dropped, or `""` when none survive. */
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
 * Name the first off-contract declaration in an inline `style` value, in the design contract's
 * own words, or `undefined` when it conforms. Every reason `sanitizeStyle` drops on is reported.
 */
export function describeStyleViolation(value: string): string | undefined {
  const declarations = declarationsOf(value);
  // A `style` holding nothing is reported rather than passed over: on a whitespace-only value
  // `sanitizeStyle` returns `""`, the enforcer drops the attribute, and the two would disagree.
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

/** Split `prop: value`, settle the property's canonical name, and hand both to the checks.
 *  Returns the reason the declaration is off-contract, or `undefined` when it conforms. */
function checkDeclaration(declaration: string): string | undefined {
  const colon = declaration.indexOf(":");
  if (colon === -1) return MALFORMED;

  const written = declaration.slice(0, colon).trim().toLowerCase();
  const value = declaration.slice(colon + 1).trim();
  if (written.length === 0 || value.length === 0) return MALFORMED;

  if (written.startsWith("--")) return "inline custom-property definitions are not allowed";

  // `!important` introduces no off-token value, but it changes who wins. An inline `style`
  // already outranks every sheet; on top of one it outranks the platform's own `!important`.
  if (IMPORTANT.test(value)) {
    return "`!important` is never declared — an inline `style` already outranks every sheet, and a record may not outrank the platform's own rules on top of that";
  }

  // One canonical property name for every check below. `\66 ont-family` *is* `font-family` to a
  // browser, so deprefix and then refuse anything that is not a plain ident rather than unescape.
  const prop = deprefix(written);
  if (!PLAIN_IDENT.test(prop)) {
    return "a property name is a plain CSS ident — an escape sequence or a character reference in it hides the property it really names";
  }

  return checkProperty(prop, value);
}

/** The checks themselves, in the order the contract states them: what may never be declared,
 *  what may never be constructed, the keyword rule, the token rule, then the closed axes. */
function checkProperty(prop: string, value: string): string | undefined {
  const banned = neverDeclaredReason(prop);
  if (banned) return banned;

  // Read against what was *written*, not the trimmed ident: entity-smuggled constructs live
  // in the value, and this is where they are caught.
  if (hasForbiddenConstruct(value)) {
    return "the value uses a forbidden construct — `url(...)`, a gradient or colour function, a legacy script vector, a raw hex colour, or a character reference hiding one of them";
  }
  if (isRecolouringProp(prop)) {
    return "a record may not re-colour the surface it sits on — `invert()`, `hue-rotate()` and a blend mode reach any colour at all without naming one, which is the closed colour axis walked around rather than obeyed";
  }

  const declared = withoutImportant(value);
  if (prop === "position") {
    return isSafePosition(declared)
      ? undefined
      : "a record may not escape its own bounds; only `static` and `relative` are allowed";
  }

  const rounded = roundedShapeReason(prop, declared);
  if (rounded) return rounded;

  const tokens = tokenize(declared);
  return inkFillReason(prop, tokens) ?? offAxisReason(prop, tokens);
}

/** The radius ban keys on the `-radius` suffix, which `clip-path: inset(0 round 12px)` walks
 *  straight past: a basic shape rounds the corners the ban keeps mitred, under another name. */
function roundedShapeReason(prop: string, value: string): string | undefined {
  if (prop !== "clip-path" && prop !== "shape-outside") return undefined;
  const shape = withoutImportant(value).trim().toLowerCase();
  if (shape === "" || shape === "none" || isGlobal(shape)) return undefined;
  if (/^inset\([^)]*\)$/.test(shape) && !/(?<![\w-])round(?![\w-])/.test(shape)) return undefined;
  return "a basic shape may not round its corners — High Meadow has no radius tokens and every corner is mitred, the same reason `border-radius` is never declared";
}

/** Strip a vendor prefix so a prefixed property is held to the same rule as the bare one. */
function deprefix(prop: string): string {
  return prop.replace(/^-(?:webkit|moz|ms|o)-/, "");
}

const PLAIN_IDENT = /^[a-z][a-z0-9-]*$/;

/** `! important`, in every spacing and casing a browser honours. */
const IMPORTANT = /!\s*important\b/i;

/**
 * Strip a trailing `!important` before the axis check reads the value's tokens. A declaration
 * carrying one is refused above, so removing that refusal would not turn it into a token.
 */
function withoutImportant(value: string): string {
  return value.replace(/\s*!\s*important$/i, "").trim();
}

/** The never-declared properties (PLAN decision 10), keyed on the deprefixed ident. One
 *  `-radius` suffix covers every longhand; the shadow ban names the effect, nothing casts. */
const NEVER_DECLARED: readonly {
  readonly owns: (prop: string) => boolean;
  readonly reason: string;
}[] = [
  {
    owns: (prop) => prop === "font" || prop === "font-family",
    reason: "font family is never declared — an item inherits the face of the surface it sits on",
  },
  {
    owns: (prop) => prop === "all",
    reason:
      "`all` is never declared — it resets the face, colour and metrics the surface supplies, which is the inheritance every other rule here depends on",
  },
  {
    owns: (prop) => prop === "border-radius" || prop.endsWith("-radius"),
    reason:
      "`border-radius` is never declared — High Meadow has no radius tokens, every corner is mitred, and a square corner is the absence of a declaration rather than a value of zero",
  },
  {
    owns: isBoundaryProp,
    reason:
      "`border` is never declared — the ink system owns every boundary, a drawn line is an SVG path rather than a CSS edge, and the platform draws the record's own",
  },
  {
    owns: isUnweighable,
    reason:
      "a line has no weight to name — retiring the border-weight axis left no thickness token on the surface, so a property whose value is a thickness has no value it may take",
  },
  {
    owns: (prop) => prop === "box-shadow" || prop === "text-shadow" || prop === "box-reflect",
    reason:
      "a shadow is never declared — nothing inside a window casts, and the shadow tokens are bare `<x> <y> <alpha>` numbers, so `box-shadow: var(--shadow-window)` is an invalid value that fails silently",
  },
  {
    owns: isBoundsEscapingProp,
    reason:
      "a record may not move or scale out of its own bounds — the platform owns where a record sits, the same reason `position: fixed` is refused",
  },
];

/**
 * These change the colour on screen without naming one: a filter chain reaches any hue, a blend
 * mode takes one from behind. Run after the construct scan, so `drop-shadow(…)` keeps its answer.
 */
function isRecolouringProp(prop: string): boolean {
  return (
    prop === "filter" ||
    prop === "backdrop-filter" ||
    prop === "mix-blend-mode" ||
    prop === "background-blend-mode"
  );
}

function neverDeclaredReason(prop: string): string | undefined {
  return NEVER_DECLARED.find((ban) => ban.owns(prop))?.reason;
}

/** The other ways out of the item's box; width and height stay free (ADR-0005 counts them as
 *  arrangement). A family test, not a list: the enumeration it replaced let `rotate` escape. */
function isBoundsEscapingProp(prop: string): boolean {
  if (prop === "zoom") return true;
  if (prop === "transform" || prop.startsWith("transform-")) return true;
  if (prop === "translate" || prop === "rotate" || prop === "scale") return true;
  if (prop === "perspective" || prop === "perspective-origin") return true;
  return prop === "offset" || prop.startsWith("offset-");
}

/** On the closed axes, every token must be a High Meadow token, a structural zero or a keyword;
 * a property outside them is free, having cleared the bans and the construct scan. */
function offAxisReason(prop: string, tokens: readonly string[]): string | undefined {
  if (tokens.length === 0) return MALFORMED;
  const axis = CLOSED_AXES.find((candidate) => candidate.owns(prop));
  if (!axis) return undefined;
  return tokens.every(axis.accepts) ? undefined : axis.refusal;
}

/** The refusal for a closed axis: name the axis and the set it picks from. */
function offToken(axis: string, tokens: ReadonlySet<string>): string {
  return `${axis} is picked from the High Meadow set and never written as a value — name one of ${tokenList(tokens)}`;
}

/**
 * Forbidden constructs and raw colours, property-agnostic. `&` is here for the reason `\` is:
 * `HTMLRewriter` hands back undecoded attribute text, so an entity-encoded `url(` would pass.
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

/** Colour-producing functions. A gradient is a colour written out rather than named, so it
 *  belongs beside `rgb()` — the one gradient High Meadow states is `--title-bar`, chrome. */
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
// Custom-property names are case-sensitive and matched that way; CSS keywords are not.

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
const isTypeOrGlobal = (t: string): boolean => isTokenFrom(t, TYPE_SIZE_TOKENS) || isGlobal(t);
const isSpacingToken = (t: string): boolean =>
  isTokenFrom(t, SPACING_TOKENS) || isZero(t) || isAuto(t) || isNormal(t) || isGlobal(t);
const isColorTokenOrKeyword = (t: string): boolean =>
  isTokenFrom(t, PALETTE_COLOR_TOKENS) || isColorKeyword(t) || isGlobal(t);

// ── The closed axes ──────────────────────────────────────────────────────────────────
// Membership is a predicate, not a list: an enumerated axis is closed in name only.

interface ClosedAxis {
  readonly owns: (prop: string) => boolean;
  readonly accepts: (token: string) => boolean;
  readonly refusal: string;
}

/** Spacing — margin/padding, gaps, the in-flow offsets, and the two indents. `position:
 *  relative` is legal, so the offsets that move a record out of its bounds are held here. */
function isSpacingProp(prop: string): boolean {
  if (/^(?:scroll-)?(?:margin|padding)(?:-|$)/.test(prop)) return true;
  if (prop === "gap" || prop.endsWith("-gap")) return true;
  if (/^(?:top|right|bottom|left)$/.test(prop)) return true;
  if (prop === "inset" || prop.startsWith("inset-")) return true;
  return prop === "text-indent" || prop === "border-spacing";
}

/** Colour — anything whose value is a colour: the `-color` suffix carries the family, the rest
 *  take one silently. As a shorthand residual, `background` let the title-bar gradient through. */
function isColorProp(prop: string): boolean {
  if (prop === "color" || prop.endsWith("-color")) return true;
  return COLOR_VALUED_PROPS.has(prop);
}

const COLOR_VALUED_PROPS: ReadonlySet<string> = new Set([
  "background",
  "background-image",
  "fill",
  "stroke",
  /* A line drawn round every glyph, at a width and in a colour, saying neither in its name.
   * The colour half is held to the palette here; `isUnweighable` settles the width half. */
  "text-stroke",
  /* The `-color` suffix carries `caret-color`; the bare shorthand says colour without
   * saying it, the same way `background` does. */
  "caret",
]);

/**
 * `--ink` fills nothing. Since the boundary ban it is also the way around it: an `--ink` block
 * round a `--surface` block is a frame. `--ink-2` and `--ink-3` go with it, a step lighter.
 */
const FILL_PROPS: ReadonlySet<string> = new Set([
  "background",
  "background-color",
  "background-image",
  "fill",
]);

const INK_TOKENS: ReadonlySet<string> = new Set(["ink", "ink-2", "ink-3"]);

/**
 * Which token, on which property — a rule about a value rather than an axis, which is why it
 * runs between the bans and the axes. As an axis it would answer for `background: white` too.
 */
function inkFillReason(prop: string, tokens: readonly string[]): string | undefined {
  if (!FILL_PROPS.has(prop)) return undefined;
  if (!tokens.some((token) => isTokenFrom(token, INK_TOKENS))) return undefined;
  return "`--ink` draws every line and sets every piece of type; it is never a background and never a fill, and neither are `--ink-2` and `--ink-3` — a filled block names one of the five surfaces or one of the eight tints";
}

/**
 * A line width with no set to pick from. Retiring the border-weight axis left no way to name a
 * thickness, so a raw `6px` is off-token by definition and refusing the property says so.
 */
function isUnweighable(prop: string): boolean {
  return (
    prop === "text-stroke-width" ||
    prop === "stroke-width" ||
    prop === "text-decoration-thickness" ||
    prop === "text-underline-offset"
  );
}

/**
 * A boundary — the fourth never-declared property (PLAN decision 10), and the ink system owns
 * the edge. `outline` too: the focus ring is the platform's, painted on the enclosing shell.
 */
function isBoundaryProp(prop: string): boolean {
  if (prop === "border-spacing" || prop === "border-collapse") return false;
  return (
    prop === "border" ||
    prop.startsWith("border-") ||
    prop === "outline" ||
    prop.startsWith("outline-") ||
    prop === "column-rule" ||
    prop.startsWith("column-rule-")
  );
}

const CLOSED_AXES: readonly ClosedAxis[] = [
  {
    owns: (prop) => prop === "font-size",
    accepts: isTypeOrGlobal,
    refusal: offToken("type size", TYPE_SIZE_TOKENS),
  },
  {
    owns: isSpacingProp,
    accepts: isSpacingToken,
    refusal: offToken("spacing", SPACING_TOKENS),
  },
  {
    owns: isColorProp,
    accepts: isColorTokenOrKeyword,
    refusal: offToken("colour", PALETTE_COLOR_TOKENS),
  },
  {
    owns: (prop) => prop === "text-decoration" || prop === "text-emphasis",
    accepts: isDecorationToken,
    refusal:
      "a decoration shorthand carries a line, a colour and a thickness in one value — name the line and the style here, keep the colour on `-color` where the palette answers for it, and leave the thickness off: there is no thickness token to name",
  },
];

/** The two shorthands mixing a line, a colour and a thickness. Left free, each carried an
 *  off-palette colour past `isUnweighable`; held to their keywords plus the palette instead. */
function isDecorationToken(token: string): boolean {
  if (DECORATION_KEYWORDS.has(token.toLowerCase())) return true;
  if (/^(?:"[^"]*"|'[^']*')$/.test(token)) return true; // text-emphasis' own mark string
  return isColorTokenOrKeyword(token);
}

const DECORATION_KEYWORDS: ReadonlySet<string> = new Set([
  "underline",
  "overline",
  "line-through",
  "blink",
  "solid",
  "double",
  "dotted",
  "dashed",
  "wavy",
  "filled",
  "open",
  "dot",
  "circle",
  "double-circle",
  "triangle",
  "sesame",
]);
