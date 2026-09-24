// URL attribute values as a browser reads them, for the item enforcer and the Handler scrub.
// lol-html hands an attribute over raw, so `https&#58;//` and `\\host` passed every check as
// written: a browser decodes the reference and reads a backslash as a slash.

import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";

/**
 * Every named character reference that decodes to ASCII, from the WHATWG table
 * (html.spec.whatwg.org/entities.json). Any other reference decodes past ASCII, where no scheme,
 * slash or colon can be spelled, so it is left as written.
 */
const ASCII_REFERENCES: ReadonlyMap<string, string> = new Map([
  ["Tab", "\t"],
  ["NewLine", "\n"],
  ["excl", "!"],
  ["quot", '"'],
  ["QUOT", '"'],
  ["num", "#"],
  ["dollar", "$"],
  ["percnt", "%"],
  ["amp", "&"],
  ["AMP", "&"],
  ["apos", "'"],
  ["lpar", "("],
  ["rpar", ")"],
  ["ast", "*"],
  ["midast", "*"],
  ["plus", "+"],
  ["comma", ","],
  ["period", "."],
  ["sol", "/"],
  ["colon", ":"],
  ["semi", ";"],
  ["lt", "<"],
  ["LT", "<"],
  ["equals", "="],
  ["gt", ">"],
  ["GT", ">"],
  ["quest", "?"],
  ["commat", "@"],
  ["lsqb", "["],
  ["lbrack", "["],
  ["bsol", "\\"],
  ["rsqb", "]"],
  ["rbrack", "]"],
  ["Hat", "^"],
  ["lowbar", "_"],
  ["UnderBar", "_"],
  ["grave", "`"],
  ["DiacriticalGrave", "`"],
  ["lcub", "{"],
  ["lbrace", "{"],
  ["verbar", "|"],
  ["vert", "|"],
  ["VerticalLine", "|"],
  ["rcub", "}"],
  ["rbrace", "}"],
  ["fjlig", "fj"],
]);

/**
 * Whether a URL value carries a script-executing or smuggling scheme. C0 controls are stripped from
 * a `src`, so `java\tscript:` cannot pass; a `srcset` splits there, as a browser does. Item markup
 * takes the stricter {@link isOffOriginUrl}.
 */
export function isDangerousUrl(value: string, attribute?: string): boolean {
  return urlCandidates(value, attribute).some(isDangerousUrlCandidate);
}

/**
 * Whether a URL value in item markup is off-limits: everything but an inline `data:image/*`
 * and a same-origin path. A remote 1×1 `<img src>` exfiltrated every record it rendered.
 */
export function isOffOriginUrl(value: string, attribute?: string): boolean {
  return urlCandidates(value, attribute).some(
    (candidate) => isDangerousUrlCandidate(candidate) || isRemoteCandidate(candidate),
  );
}

/** Whether a URL value names a file the platform serves, at `/files/<key>` on this origin. */
export function namesServedFile(value: string, attribute?: string): boolean {
  return urlCandidates(value, attribute).some(
    (candidate) =>
      !isRemoteCandidate(candidate) &&
      (URL.parse(candidate, "http://origin.invalid/")?.pathname.startsWith(FILE_URL_PREFIX) ??
        false),
  );
}

/**
 * The addresses one attribute value names. Only `srcset` is a comma-separated candidate list:
 * reading it as one URL sees neither address in `a.png 1x, https://evil.example/b.png 2x`, and
 * splitting a `src` would read `data:image/svg+xml,…a,b:c` as a scheme.
 */
function urlCandidates(value: string, attribute: string | undefined): string[] {
  const decoded = decodeAttributeValue(value);
  const parts =
    attribute === "srcset"
      ? decoded.split(",").map((part) => part.split(ASCII_WHITESPACE).find(Boolean) ?? "")
      : [decoded];
  return parts.map((part) => stripControls(part).replaceAll("\\", "/"));
}

/** What a browser's `srcset` parser splits a candidate at; JS `\s` also matches Unicode spaces. */
const ASCII_WHITESPACE = /[\t\n\f\r ]+/;

/**
 * An attribute value with its character references decoded. A name without its semicolon is left
 * as written: the legacy names a browser reads that way spell only `&`, `<`, `>`, `"` or Latin-1.
 */
function decodeAttributeValue(raw: string): string {
  return raw.replace(
    /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z0-9]*);)/g,
    (reference, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) return ASCII_REFERENCES.get(name) ?? reference;
      const code = decimal === undefined ? Number.parseInt(hex ?? "", 16) : Number(decimal);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\u{FFFD}";
    },
  );
}

/** Drop C0 controls and spaces, so `java\tscript:` reads as what a browser will read. */
function stripControls(value: string): string {
  let stripped = "";
  for (const ch of value) {
    if (ch.charCodeAt(0) > 0x20) stripped += ch;
  }
  return stripped;
}

function isDangerousUrlCandidate(candidate: string): boolean {
  const v = candidate.toLowerCase();
  if (v.includes("javascript:") || v.includes("vbscript:")) return true;
  return v.startsWith("data:") && !v.startsWith("data:image/");
}

/** A scheme of any kind, or a protocol-relative authority — both leave this origin. */
function isRemoteCandidate(candidate: string): boolean {
  const v = candidate.toLowerCase();
  if (v.startsWith("data:image/")) return false;
  if (v.startsWith("//")) return true;
  return /^[a-z][a-z0-9+.-]*:/.test(v);
}
