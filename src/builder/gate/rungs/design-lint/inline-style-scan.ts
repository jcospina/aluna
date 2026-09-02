// The inline-`style` scan the design-lint rung runs over a rendered record, ahead of the
// enforcer diff, so a refusal names the rule the renderer broke rather than showing a
// before and an after.
//
// It reads `style` through the same parser the enforcer uses, not with a regex over the
// markup text. A hostile field value the renderer escaped correctly renders as inert *text*
// that can read exactly like an attribute — the design-lint probes carry one that does — and
// a regex cannot tell the two apart, so it would refuse a correct renderer for quoting a
// payload.
//
// The parser hands back the *raw* attribute text rather than the entity-decoded value the
// browser will act on, which is why `style-discipline.ts` refuses a value carrying `&` at
// all rather than trusting a decode that has not happened.

import { describeStyleViolation } from "../../../../presentation/index.ts";

/** What the scan found in a record's inline styles: a declaration the render-time
 *  discipline would drop, or the one residual it cannot see — a named CSS colour inside a
 *  mixed shorthand, inert at render time but still off-token. */
export type InlineStyleViolation =
  | { readonly kind: "declaration"; readonly detail: string }
  | { readonly kind: "raw-colour"; readonly colour: string };

/** The first off-contract thing in any `style` attribute of `markup`, or `undefined`. */
export function findInlineStyleViolation(markup: string): InlineStyleViolation | undefined {
  for (const value of styleAttributes(markup)) {
    const detail = describeStyleViolation(value);
    if (detail) return { kind: "declaration", detail };
    const colour = NAMED_COLOR_TOKEN.exec(value.toLowerCase());
    if (colour?.[0]) return { kind: "raw-colour", colour: colour[0] };
  }
  return undefined;
}

/** Every `style` attribute value in the markup, in document order.
 *
 * The attribute list is walked rather than `getAttribute("style")`, which returns only the
 * first of a repeated attribute. Browsers keep the first and the enforcer keeps the last, so
 * reading one of them would let the other carry an off-token value past this scan. */
function styleAttributes(markup: string): string[] {
  const values: string[] = [];
  new HTMLRewriter()
    .on("*", {
      element(element) {
        for (const [name, value] of element.attributes) {
          if (name.toLowerCase() === "style") values.push(value);
        }
      },
    })
    .transform(markup);
  return values;
}

/** The standard CSS named colours. `transparent`/`currentcolor` are token-safe keywords and
 *  are deliberately absent, so they are never flagged. */
const NAMED_CSS_COLORS: readonly string[] = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];

// A named colour as a whole CSS token: not preceded or followed by a word char or hyphen, so
// `var(--tan)` (preceded by `-`) and `whitesmoke` (not matched as `white`) are safe.
const NAMED_COLOR_TOKEN = new RegExp(`(?<![\\w-])(?:${NAMED_CSS_COLORS.join("|")})(?![\\w-])`);
