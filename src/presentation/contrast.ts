/**
 * WCAG contrast, and the colours to measure it between.
 *
 * The audit this serves is affordable because High Meadow is closed: the palette
 * is a fixed list and every place the product puts one colour on another is
 * declared in a stylesheet we own. So the measurement never has to render a page
 * — it resolves the tokens the stylesheets name and does the arithmetic.
 *
 * Three shapes of colour reach a surface. A token, straight from
 * `design/styles/tokens.css`; a token at partial opacity over another, which is
 * how a menu bar dims a link and how a drawn shadow haloes a label on the
 * wallpaper; and a `color-mix()` of two tokens, which is how a hover fill and the
 * developer well's faint punctuation are derived rather than declared. All three
 * resolve to one hex before anything is compared.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

/** A colour the product puts on a surface, in the terms the stylesheet states it. */
export type Colour =
  /** `var(--name)` from the token layer. */
  | { readonly token: string }
  /** `--token` painted at `alpha` over what is behind it — an `opacity` rule, or a shadow. */
  | { readonly token: string; readonly alpha: number; readonly over: Colour }
  /** `color-mix(in <space>, var(--from), var(--to) <toward>%)`. */
  | {
      readonly mix: readonly [string, string];
      readonly toward: number;
      readonly space: "oklab" | "oklch";
    };

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { red: (value >> 16) & 0xff, green: (value >> 8) & 0xff, blue: value & 0xff };
}

function formatHex({ red, green, blue }: Rgb): string {
  return `#${[red, green, blue].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** sRGB → linear-light, the transfer function both luminance and OKLab start from. */
function linear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function toLinear({ red, green, blue }: Rgb): readonly [number, number, number] {
  return [linear(red), linear(green), linear(blue)];
}

function fromLinear(channels: readonly [number, number, number]): Rgb {
  const encode = (channel: number) => {
    const value = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(value * 255)));
  };
  const [red, green, blue] = channels;
  return { red: encode(red), green: encode(green), blue: encode(blue) };
}

function toOklab(rgb: Rgb): readonly [number, number, number] {
  const [r, g, b] = toLinear(rgb);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([lightness, a, b]: readonly [number, number, number]): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return fromLinear([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]);
}

/**
 * `in oklch`: lightness and chroma interpolate straight, hue takes the shorter arc —
 * which is what CSS does, and it is not the same result as `in oklab`. Both spaces
 * are in use, so both are resolved rather than one standing in for the other.
 */
function mixRectangular(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  toward: number,
): readonly [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * toward,
    a[1] + (b[1] - a[1]) * toward,
    a[2] + (b[2] - a[2]) * toward,
  ];
}

function mixPolar(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  toward: number,
): readonly [number, number, number] {
  const chroma = (c: readonly [number, number, number]) => Math.hypot(c[1], c[2]);
  const hue = (c: readonly [number, number, number]) => Math.atan2(c[2], c[1]);
  let delta = hue(b) - hue(a);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  const h = hue(a) + delta * toward;
  const c = chroma(a) + (chroma(b) - chroma(a)) * toward;
  return [a[0] + (b[0] - a[0]) * toward, c * Math.cos(h), c * Math.sin(h)];
}

/**
 * Every token the layer declares, resolved to a hex. A token may name another —
 * `--focus-ring: var(--violet)` is the whole reason the ring is one colour — so
 * aliases are followed rather than skipped.
 */
export function paletteTokens(): ReadonlyMap<string, string> {
  const css = readFileSync(join(ROOT, "design/styles/tokens.css"), "utf8");
  const hexes = new Map(
    [...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map(([, name, hex]) => [
      name as string,
      (hex as string).toLowerCase(),
    ]),
  );
  for (const [, name, target] of css.matchAll(/--([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)\s*;/g)) {
    const hex = hexes.get(target as string);
    if (hex) hexes.set(name as string, hex);
  }
  // And a token may be derived rather than named — `--well-alert` is the invalid
  // field's fill, mixed from the alert colour and the surface it sits on.
  const mixed =
    /--([a-z0-9-]+):\s*color-mix\(in (oklab|oklch),\s*var\(--([a-z0-9-]+)\),\s*var\(--([a-z0-9-]+)\)\s*([\d.]+)%\s*\)/g;
  for (const [, name, space, from, to, percent] of css.matchAll(mixed)) {
    hexes.set(
      name as string,
      resolveColour(
        {
          mix: [from as string, to as string],
          toward: Number(percent) / 100,
          space: space as "oklab" | "oklch",
        },
        hexes,
      ),
    );
  }
  return hexes;
}

function tokenHex(name: string, palette: ReadonlyMap<string, string>): string {
  const hex = palette.get(name);
  if (!hex) throw new Error(`--${name} is not a hex token in design/styles/tokens.css`);
  return hex;
}

/** One colour, resolved to the hex a screen would actually paint. */
export function resolveColour(colour: Colour, palette: ReadonlyMap<string, string>): string {
  if ("mix" in colour) {
    const [from, to] = colour.mix;
    const a = toOklab(parseHex(tokenHex(from, palette)));
    const b = toOklab(parseHex(tokenHex(to, palette)));
    const t = colour.toward;
    if (colour.space === "oklch") return formatHex(fromOklab(mixPolar(a, b, t)));
    return formatHex(fromOklab(mixRectangular(a, b, t)));
  }
  const top = parseHex(tokenHex(colour.token, palette));
  if (!("alpha" in colour)) return formatHex(top);
  // `opacity` and a shadow's alpha both composite in sRGB, which is what a browser does.
  const under = parseHex(resolveColour(colour.over, palette));
  const blend = (over: number, below: number) => over * colour.alpha + below * (1 - colour.alpha);
  return formatHex({
    red: blend(top.red, under.red),
    green: blend(top.green, under.green),
    blue: blend(top.blue, under.blue),
  });
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = toLinear(parseHex(hex));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.2 §1.4.3 contrast ratio, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

export interface Declaration {
  readonly sheet: string;
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}

/**
 * Every rule in a stylesheet, comments stripped.
 *
 * Flat by construction: an `@media` or `@supports` wrapper is stepped over, but CSS
 * nesting is refused outright rather than mis-parsed — a nested block would take its
 * parent's declarations out of the audit's sight, which is worse than a failure.
 */
export function declarations(sheet: string, properties: readonly string[]): Declaration[] {
  const source = readFileSync(join(ROOT, sheet), "utf8");
  // A page or a served template carries its stylesheet in `<style>` rather than being
  // one. Those blocks land after everything the manifest ships, so they are the last
  // word on anything they name, and the audit has to see them.
  const css = (
    sheet.endsWith(".css")
      ? source
      : [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
          .map(([, block]) => block)
          .join("\n")
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  return css.split("}").flatMap((chunk) => {
    if (!chunk.includes("{")) return [];
    const cut = chunk.lastIndexOf("{");
    // Split on both braces so an `@media` wrapper does not ride along on the selector.
    const selector = (chunk.slice(0, cut).split(/[{}]/).pop() as string)
      .replace(/\s+/g, " ")
      .trim();
    const body = chunk.slice(cut + 1);
    if (body.includes("&") || selector.includes("&")) {
      throw new Error(
        `${sheet} nests with \`&\`, and this parser is flat — see the note above \`declarations\`.`,
      );
    }
    return properties.flatMap((property) => {
      // Last wins, as it does in the browser. Reading only the first left a rule that
      // restates a property paintable and unaudited at the same time.
      const matches = [...body.matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+)`, "g"))];
      const value = matches.at(-1)?.[1]?.trim();
      return value === undefined ? [] : [{ sheet, selector, property, value }];
    });
  });
}

/**
 * A declaration that puts no colour on the surface and dims nothing: `outline: none`
 * suppressing a ring, `border-color: transparent` handing an edge to the ink system,
 * `color: inherit`, `opacity: 1`. `0.42` is not one of these — a fade is a pairing,
 * which is why the test is exact rather than a prefix.
 */
export function statesNoColour({ value }: Declaration): boolean {
  return /^(?:none|inherit|transparent|0|1)$/.test(value);
}

/** The key a pairing claims a declaration by. */
export function siteKey({ sheet, selector, property }: Declaration): string {
  return `${sheet} § ${selector} [${property}]`;
}

/**
 * Every hex a colour could legitimately resolve to.
 *
 * One for a token, an alpha composite or an `in oklab` mix — those are arithmetic
 * and a browser reproduces them exactly, byte for byte, which was checked against
 * Chrome. An `in oklch` mix does not: the spec interpolates hue linearly, and
 * Chrome — measured, not assumed — returns the chromatic side's hue unchanged when
 * the other side is as close to grey as `--surface` is. Rather than take a side on
 * which is right, both readings are produced and the audit measures the worse.
 */
export function resolveCandidates(
  colour: Colour,
  palette: ReadonlyMap<string, string>,
): readonly string[] {
  if ("mix" in colour && colour.space === "oklch") {
    const [from, to] = colour.mix;
    const a = toOklab(parseHex(tokenHex(from, palette)));
    const b = toOklab(parseHex(tokenHex(to, palette)));
    const held = mixRectangular(a, b, colour.toward);
    // Whichever side actually carries the hue, not whichever was written first.
    const chromatic = Math.hypot(a[1], a[2]) >= Math.hypot(b[1], b[2]) ? a : b;
    const hue = Math.atan2(chromatic[2], chromatic[1]);
    const scale = Math.hypot(held[1], held[2]);
    return [
      formatHex(fromOklab(mixPolar(a, b, colour.toward))),
      formatHex(fromOklab([held[0], scale * Math.cos(hue), scale * Math.sin(hue)])),
    ];
  }
  return [resolveColour(colour, palette)];
}

/** The tightest reading of a pairing: no candidate resolution does better than this. */
export function worstContrast(
  foreground: Colour,
  background: Colour,
  palette: ReadonlyMap<string, string>,
): number {
  const fronts = resolveCandidates(foreground, palette);
  const backs = resolveCandidates(background, palette);
  return Math.min(...fronts.flatMap((f) => backs.map((b) => contrastRatio(f, b))));
}

/** Every palette token a declaration's value names — `--btn-fill` and `--line` are not one. */
export function tokensNamedIn(value: string, palette: ReadonlyMap<string, string>): string[] {
  return [...value.matchAll(/var\(--([a-z0-9-]+)\)/g)]
    .map(([, token]) => token as string)
    .filter((token) => palette.has(token));
}

/** A bare number: what an `opacity` declaration states, and nothing else does. */
export function alphaStatedIn(value: string): number | undefined {
  return /^(?:0?\.\d+|[01])$/.test(value) ? Number(value) : undefined;
}
