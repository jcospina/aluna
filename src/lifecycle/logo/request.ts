// The one generation request, assembled from the four things a claim hands back.
//
// [ADR-0007](../../../docs/adr/0007-capability-logo-contract.md) fixes the whole request except
// four values: everything held constant is a module-level constant with a literal type, and
// {@link buildLogoGenerationRequest} takes only the claim's subject, its two colours and its seed.
// There is no options parameter, so "no caller may vary the constants" is a fact about the
// signature rather than a rule someone has to remember.
//
// The ground is named twice — once in `controls.background_color` and once in words inside the
// prompt — because L2 records that naming it in one place alone does not work: the control is
// ignored.

import type { LogoShade } from "../../registry/logo.ts";

/** Recraft's vector model. The v4 vector models accept no style, substyle or controls
 * at all, so none of the rest of this contract would apply to them (ADR-0007 L1). */
export const LOGO_GENERATION_MODEL = "recraftv3_vector";

/** Enforces the flatness in the request rather than asking for it in words. Without
 * this pairing the model shades. */
export const LOGO_GENERATION_STYLE = "vector_illustration";
export const LOGO_GENERATION_SUBSTYLE = "bold_stroke";

/** Square, because the tile is square and nothing is ever stretched. */
export const LOGO_GENERATION_SIZE = "1024x1024";

/** Returned URLs expire in about 24 hours and a logo has to outlast that, so the bytes
 * come back in the response. */
export const LOGO_GENERATION_RESPONSE_FORMAT = "b64_json";

/** Recorded as *not sufficient on its own*: it does not stop a symbol the model reads as
 * part of the object, which is why the prompt forbids lettering in words as well. */
export const LOGO_GENERATION_NO_TEXT = true;

/** The path this request is POSTed to, relative to the configured API base. */
export const LOGO_GENERATION_PATH = "/images/generations";

/**
 * The thirty-two shades as bytes, the only place shade names become numbers. Not design tokens:
 * they reach the request alone (L8); `request.test.ts` measures daylight chroma, not tokens.css.
 */
const LOGO_SHADE_RGB = {
  grass: [0x3f, 0xa6, 0x5b],
  emerald: [0x19, 0xa8, 0x77],
  lime: [0x74, 0xb4, 0x30],
  clover: [0x57, 0xbd, 0x63],
  forest: [0x2a, 0x7a, 0x45],
  pine: [0x21, 0x91, 0x70],
  fern: [0x3f, 0x8c, 0x3a],
  juniper: [0x2d, 0x86, 0x63],
  teal: [0x3e, 0x9e, 0x92],
  turquoise: [0x1e, 0xb0, 0xa0],
  viridian: [0x23, 0x93, 0x7c],
  jade: [0x5c, 0xbb, 0xa6],
  cyan: [0x7f, 0xd2, 0xe0],
  azure: [0x4b, 0xb4, 0xd8],
  aqua: [0x55, 0xcd, 0xcd],
  cerulean: [0x2f, 0x9f, 0xc9],
  golden: [0xf2, 0xb3, 0x2c],
  amber: [0xe8, 0xa0, 0x1c],
  marigold: [0xf6, 0xc6, 0x2f],
  lemon: [0xee, 0xd2, 0x3a],
  mustard: [0xc9, 0x90, 0x2f],
  ochre: [0xb8, 0x7a, 0x24],
  turmeric: [0xe0, 0xb0, 0x31],
  cinnamon: [0xb5, 0x76, 0x3a],
  coral: [0xe8, 0x76, 0x3c],
  tangerine: [0xf2, 0x86, 0x1f],
  persimmon: [0xdf, 0x5f, 0x2e],
  apricot: [0xef, 0x9a, 0x55],
  amethyst: [0x9a, 0x86, 0xc4],
  iris: [0x7a, 0x68, 0xc2],
  orchid: [0xa8, 0x65, 0xc2],
  plum: [0x8a, 0x5c, 0xb4],
} as const satisfies Record<LogoShade, readonly [number, number, number]>;

/**
 * The same shades as English, the other half of L2, with both ban lists in `request.test.ts`: no
 * wording against the daylight close, and no scene word — *stacked* returned a stack of books.
 */
const LOGO_SHADE_IN_WORDS = {
  grass: "a flat vivid grass green",
  emerald: "a flat rich emerald green",
  lime: "a flat bright lime green",
  clover: "a flat clear clover green",
  forest: "a flat rich forest green",
  pine: "a flat strong pine green",
  fern: "a flat rich fern green",
  juniper: "a flat cool juniper green",
  teal: "a flat cool teal green",
  turquoise: "a flat vivid turquoise",
  viridian: "a flat strong viridian green",
  jade: "a flat clear jade green",
  cyan: "a flat clear cyan blue",
  azure: "a flat bright azure blue",
  aqua: "a flat clear aqua blue",
  cerulean: "a flat strong cerulean blue",
  golden: "a flat warm golden yellow",
  amber: "a flat warm amber yellow",
  marigold: "a flat bright marigold yellow",
  lemon: "a flat bright lemon yellow",
  mustard: "a flat warm mustard ochre",
  ochre: "a flat rich ochre",
  turmeric: "a flat bright turmeric yellow",
  cinnamon: "a flat warm cinnamon orange",
  coral: "a flat warm coral orange",
  tangerine: "a flat bright tangerine orange",
  persimmon: "a flat vivid persimmon orange",
  apricot: "a flat warm apricot orange",
  amethyst: "a flat cool amethyst violet",
  iris: "a flat rich iris violet",
  orchid: "a flat vivid orchid violet",
  plum: "a flat strong plum violet",
} as const satisfies Record<LogoShade, string>;

export interface LogoColorControl {
  readonly rgb: readonly [number, number, number];
}

/** The exact JSON body one generation request carries. */
export interface LogoGenerationRequest {
  readonly prompt: string;
  readonly model: typeof LOGO_GENERATION_MODEL;
  readonly style: typeof LOGO_GENERATION_STYLE;
  readonly substyle: typeof LOGO_GENERATION_SUBSTYLE;
  readonly size: typeof LOGO_GENERATION_SIZE;
  readonly response_format: typeof LOGO_GENERATION_RESPONSE_FORMAT;
  readonly random_seed: number;
  readonly controls: {
    readonly colors: readonly [LogoColorControl, LogoColorControl];
    readonly background_color: LogoColorControl;
    readonly no_text: typeof LOGO_GENERATION_NO_TEXT;
  };
}

/** The four per-incarnation facts a won claim hands back. Nothing else is an input. */
export interface LogoGenerationInputs {
  readonly subject: string;
  readonly ground: LogoShade;
  readonly companion: LogoShade;
  readonly seed: number;
}

/**
 * The subject is wrapped, not concatenated: that is the whole defence against lettering, since
 * `controls.no_text` is not enough. Never move the slot to an edge. Both colours are named (L2).
 */
export function buildLogoPrompt(subject: string, ground: LogoShade, companion: LogoShade): string {
  return [
    `A flat colour square of ${subject}, drawn in ${LOGO_SHADE_IN_WORDS[companion]}, on ${LOGO_SHADE_IN_WORDS[ground]} background.`,
    "One single flat colour fills the whole background from edge to edge — an unbroken",
    "field, not panels, not blocks, not stripes, not a checkerboard, no floor, no wall,",
    "no horizon, no ground line, no perspective. The object sits centred on that field,",
    "large, filling most of the square with an even margin. Bold flat shapes with a",
    "confident dark contour, three or four flat colours in total, no gradient, no",
    "texture, no shadow. One object seen from one angle. Every surface is blank and",
    "unmarked: no text, no letters, no numerals, no labels, no engraving, no writing of",
    "any kind. Legible at 64 pixels. The two colours above are given — use them exactly as",
    "named. Any further colour stays in the same daylight register at high chroma: no",
    "near-blacks, no greys, nothing washed out. Keep the object clearly readable against",
    "its background.",
  ].join(" ");
}

/** One shade as the RGB triple the service takes. */
export function logoShadeColorControl(shade: LogoShade): LogoColorControl {
  return { rgb: LOGO_SHADE_RGB[shade] };
}

/**
 * The English the prompt names a shade with — exported for the contract's tests. `golden` is fixed
 * by `design/logo.html`; the other thirty-one follow its shape, a qualifier then a hue.
 */
export function logoShadeInWords(shade: LogoShade): string {
  return LOGO_SHADE_IN_WORDS[shade];
}

/**
 * Assemble the request. Every constant is baked in here and the caller supplies nothing
 * but the claim's four facts, so a presentation choice cannot enter at a call site.
 */
export function buildLogoGenerationRequest(inputs: LogoGenerationInputs): LogoGenerationRequest {
  const { ground, companion } = inputs;
  return {
    prompt: buildLogoPrompt(inputs.subject, inputs.ground, inputs.companion),
    model: LOGO_GENERATION_MODEL,
    style: LOGO_GENERATION_STYLE,
    substyle: LOGO_GENERATION_SUBSTYLE,
    size: LOGO_GENERATION_SIZE,
    response_format: LOGO_GENERATION_RESPONSE_FORMAT,
    random_seed: inputs.seed,
    controls: {
      colors: [logoShadeColorControl(ground), logoShadeColorControl(companion)],
      background_color: logoShadeColorControl(ground),
      no_text: LOGO_GENERATION_NO_TEXT,
    },
  };
}
