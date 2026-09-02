// Token-discipline for the inline-`style` escape hatch (ADR-0005 §4, amended 2026-07-01
// and re-derived against High Meadow 2026-08-20; design/design-system.md "What a
// generated screen may declare").
//
// The escape hatch relaxed only *off-token style*, never the executable surface. So
// `sanitizeStyle` works declaration by declaration: it *drops* a declaration that names
// a never-declared property (font family, a boundary, `border-radius`, a shadow, `all`),
// *drops* one that sets a closed axis with an off-token value (colour, type size, spacing),
// *drops* forbidden constructs (`url(...)`, `expression(...)`, gradients and colour
// functions, item-escaping `position`, raw colours, inline custom-property definitions),
// and *passes conforming declarations through*. A fully-conforming value comes back
// byte-identical so the enforcer can leave it untouched; anything hostile smuggled into
// `style` comes out inert.
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
// This deliberately is not a full CSS parser, and two cases fail closed by dropping CSS
// that would have conformed: a comment anywhere in a declaration drops it whole, and a `;`
// inside a quoted string splits it. Neither is a safety hole.

import {
  isTokenFrom,
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

/** Split `prop: value`, settle the property's canonical name, and hand both to the checks.
 *  Returns the reason the declaration is off-contract, or `undefined` when it conforms. */
function checkDeclaration(declaration: string): string | undefined {
  const colon = declaration.indexOf(":");
  if (colon === -1) return MALFORMED;

  const written = declaration.slice(0, colon).trim().toLowerCase();
  const value = declaration.slice(colon + 1).trim();
  if (written.length === 0 || value.length === 0) return MALFORMED;

  if (written.startsWith("--")) return "inline custom-property definitions are not allowed";

  // `!important` cannot introduce an off-token value — every check below still runs on the
  // value it carries — but it changes *who wins*, and a record is the one thing on this
  // surface that may never win a specificity fight with the chrome around it. An inline
  // `style` already outranks every stylesheet; `!important` on top of one outranks the
  // platform's own `!important` too, which is the last thing holding a record inside its box.
  if (IMPORTANT.test(value)) {
    return "`!important` is never declared — an inline `style` already outranks every sheet, and a record may not outrank the platform's own rules on top of that";
  }

  // One canonical property name for every check below. A CSS property is an ident token, so
  // `\66 ont-family` *is* `font-family` to a browser while reading nothing like it as a
  // string — and a vendor prefix names the same axis the bare property does. Deprefix, then
  // insist on a plain ident: nothing a record legitimately declares needs an escape, so
  // rather than implement ident unescaping, anything that is not a plain ident is refused.
  const prop = deprefix(written);
  if (!PLAIN_IDENT.test(prop)) {
    return "a property name is a plain CSS ident — an escape sequence or a character reference in it hides the property it really names";
  }

  return checkProperty(prop, value);
}

/** The checks themselves, in the order the contract states them: what may never be
 *  declared, what may never be constructed, the one property with its own keyword rule,
 *  then which token on which property and finally the closed axes. */
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

/** The radius ban keys on the `-radius` property suffix, which `clip-path: inset(0 round
 *  12px)` walks straight past — a basic shape rounds the corners the ban exists to keep
 *  mitred, under a property name that never says "radius". */
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
 * Strip a trailing `!important` before the axis check reads the value's tokens.
 *
 * A declaration carrying one is already refused above, so nothing reaching here has one —
 * this is what keeps the axis check reading a value rather than a value plus a keyword, and
 * it is the reason removing the refusal above would not silently turn `!important` into an
 * off-token token instead of the thing it actually is.
 */
function withoutImportant(value: string): string {
  return value.replace(/\s*!\s*important$/i, "").trim();
}

/** The never-declared properties (PLAN decision 10), keyed on the deprefixed ident — one
 *  row per ban, the shape `CLOSED_AXES` uses below. Every `border-radius` longhand —
 *  physical and logical — falls out of the one `-radius` suffix, and the shadow ban is
 *  written around the *effect* rather than around one property name, because its stated
 *  reason is that nothing inside a window casts. */
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
 * The colour axis holds a record to the palette by reading the colour a declaration
 * *names*. These change the colour that lands on the screen without naming one: a filter
 * chain (`invert(1) sepia(1) saturate(9999%) hue-rotate(90deg)`) reaches an arbitrary hue
 * from an on-token value, and a blend mode derives one from whatever sits behind. Written
 * around the effect, the way the shadow ban is.
 *
 * Checked after the construct scan rather than beside the other never-declared rows, so
 * `filter: drop-shadow(…)` keeps the shadow answer it already had — the repair hint a
 * generator gets back is the reason it should read, and "this casts" is the apter one.
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

/** The other ways out of the item's box; width and height stay free (ADR-0005 counts them
 *  as arrangement). A family test rather than a list for the reason `isBoundaryProp` is:
 *  the enumeration this replaced held `transform`, `translate` and `scale`, and let the
 *  third individual transform property — `rotate` — tilt a card straight out of its box. */
function isBoundsEscapingProp(prop: string): boolean {
  if (prop === "zoom") return true;
  if (prop === "transform" || prop.startsWith("transform-")) return true;
  if (prop === "translate" || prop === "rotate" || prop === "scale") return true;
  if (prop === "perspective" || prop === "perspective-origin") return true;
  return prop === "offset" || prop.startsWith("offset-");
}

/** On the closed axes, every token must be a High Meadow token (or a structural zero or
 * keyword); a property outside the closed axes is free (it has already cleared the bans
 * and the construct scan). */
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
const isTypeOrGlobal = (t: string): boolean => isTokenFrom(t, TYPE_SIZE_TOKENS) || isGlobal(t);
const isSpacingToken = (t: string): boolean =>
  isTokenFrom(t, SPACING_TOKENS) || isZero(t) || isAuto(t) || isNormal(t) || isGlobal(t);
const isColorTokenOrKeyword = (t: string): boolean =>
  isTokenFrom(t, PALETTE_COLOR_TOKENS) || isColorKeyword(t) || isGlobal(t);

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
  readonly refusal: string;
}

/** Spacing — margin/padding, gaps, the in-flow offsets, and the two indents. `position:
 *  relative` is legal, so the offsets that move a record out of its own bounds are held to
 *  the spacing set rather than left free. */
function isSpacingProp(prop: string): boolean {
  if (/^(?:scroll-)?(?:margin|padding)(?:-|$)/.test(prop)) return true;
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
  /* A line drawn round every glyph, at a width and in a colour. It says neither in its
   * name, which is what this set is for; the colour half is held to the palette here and
   * the width half has nothing left to name, which `isUnweighable` settles. */
  "text-stroke",
  /* The `-color` suffix carries `caret-color`; the bare shorthand says colour without
   * saying it, the same way `background` does. */
  "caret",
]);

/**
 * `--ink` fills nothing. The handbook states it flatly — "`--ink` draws every line and
 * sets every piece of type. It is never a background and never a fill" — and until the
 * boundary ban that rule cost nothing to leave unenforced, because a record that wanted a
 * frame could simply declare one.
 *
 * Now it is the way around the ban. An `--ink` block wrapped round a `--surface` block is
 * an ink frame at whatever thickness the padding says, drawn beside the hand-drawn line
 * rather than instead of it. So `--ink` stays a legal colour for type and for what strokes
 * a path, and is refused wherever the value fills a box.
 *
 * `--ink-2` and `--ink-3` go with it. They are the same ink at reading strengths — the
 * handbook gives them to type alone — and leaving them fillable would reopen the same
 * door one step lighter.
 */
const FILL_PROPS: ReadonlySet<string> = new Set([
  "background",
  "background-color",
  "background-image",
  "fill",
]);

const INK_TOKENS: ReadonlySet<string> = new Set(["ink", "ink-2", "ink-3"]);

/**
 * Which token, on which property — a rule about a value rather than a closed axis, and it
 * runs between the bans and the axes for that reason. As an axis it would have answered
 * for every off-token fill, so `background: white` would have been refused in the ink
 * rule's words when its problem is simply that white is not in the palette.
 */
function inkFillReason(prop: string, tokens: readonly string[]): string | undefined {
  if (!FILL_PROPS.has(prop)) return undefined;
  if (!tokens.some((token) => isTokenFrom(token, INK_TOKENS))) return undefined;
  return "`--ink` draws every line and sets every piece of type; it is never a background and never a fill, and neither are `--ink-2` and `--ink-3` — a filled block names one of the five surfaces or one of the eight tints";
}

/**
 * A line width with no set to pick from. Retiring the border-weight axis left the surface
 * with no way to name a thickness at all, so a property whose value *is* a thickness has
 * no satisfiable value — a raw length is off-token by definition, and there is no token.
 * Refusing it says that, rather than letting a raw `6px` through on a property no axis
 * happens to own.
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
 * A boundary — the fourth never-declared property (PLAN decision 10). Written as a prefix
 * test rather than a list because a list can only name the longhands someone thought of:
 * the shorthand, the four physical and six logical sides, and the width, style and colour
 * sub-properties of each all draw the same CSS edge, and the ink system owns it.
 *
 * `outline` and `column-rule` are here on the same reasoning rather than by association.
 * The focus ring is `--focus-ring`, painted by the platform on the enclosing shell, and a
 * record holds no interactive descendant to ring; a column rule is a CSS edge inside a
 * record like any other.
 *
 * Two exclusions. `border-radius` is caught above, which keeps its own reason — there are
 * no radius tokens — rather than being absorbed into this one. `border-spacing` and
 * `border-collapse` are table metrics that draw nothing: the first is held to the spacing
 * set below and the second is free, exactly as before.
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

/** The two shorthands mixing a line, a colour and a thickness in one value. Left free,
 *  each carried a live off-palette colour and a thickness past `isUnweighable`; held to
 *  their own keywords plus the palette rather than banned, so `text-decoration: underline`
 *  still reads the way an author writes it. */
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
