import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { fileUrl } from "../../../platform/files/file-url.ts";
import {
  ASCII_REFERENCE_ENTRIES,
  decodeAttributeValue,
  isDangerousUrl,
  isOffOriginUrl,
  namesServedFile,
} from "./attribute-urls.ts";

interface Piece {
  readonly text: string;
  readonly extendedBy: RegExp | null;
}

const DECIMAL_TAIL = /^[0-9;]/;
const HEX_TAIL = /^[0-9a-fA-F;]/;

const namesFor = (unit: string): string[] =>
  [...ASCII_REFERENCE_ENTRIES].filter(([, value]) => value === unit).map(([name]) => name);

/** Every way a browser would read `unit` from an attribute: literal, decimal, hex or named. */
function spellings(unit: string): fc.Arbitrary<Piece> {
  const options: fc.Arbitrary<Piece>[] = [];
  if (unit !== "&") options.push(fc.constant({ text: unit, extendedBy: null }));
  const names = namesFor(unit);
  if (names.length > 0) {
    options.push(
      fc.constantFrom(...names).map((name) => ({ text: `&${name};`, extendedBy: null })),
    );
  }
  const code = unit.codePointAt(0) ?? 0;
  if ([...unit].length === 1) {
    options.push(
      fc.record({ zeros: fc.nat({ max: 3 }), closed: fc.boolean() }).map(({ zeros, closed }) => ({
        text: `&#${"0".repeat(zeros)}${code}${closed ? ";" : ""}`,
        extendedBy: closed ? null : DECIMAL_TAIL,
      })),
      fc
        .record({
          zeros: fc.nat({ max: 3 }),
          x: fc.constantFrom("x", "X"),
          upper: fc.boolean(),
          closed: fc.boolean(),
        })
        .map(({ zeros, x, upper, closed }) => {
          const digits = code.toString(16);
          return {
            text: `&#${x}${"0".repeat(zeros)}${upper ? digits.toUpperCase() : digits}${closed ? ";" : ""}`,
            extendedBy: closed ? null : HEX_TAIL,
          };
        }),
    );
  }
  return fc.oneof(...options);
}

/** Pieces joined, closing an open numeric reference the next piece would otherwise extend. */
const joined = (pieces: readonly Piece[]): string =>
  pieces
    .map((piece, index) => {
      const next = pieces[index + 1]?.text ?? "";
      return piece.extendedBy?.test(next) ? `${piece.text};` : piece.text;
    })
    .join("");

const respelled = (units: readonly string[]): fc.Arbitrary<string> =>
  fc.tuple(...units.map(spellings)).map(joined);

const asciiUnit = fc.oneof(
  fc.integer({ min: 1, max: 0x7f }).map((code) => String.fromCodePoint(code)),
  fc.constantFrom(...ASCII_REFERENCE_ENTRIES.map(([, value]) => value)),
);

describe("character references, decoded as a browser decodes them", () => {
  test("any spelling of ASCII text — named, decimal or hex, with or without `;` — decodes to that text", () => {
    fc.assert(
      fc.property(
        fc
          .array(asciiUnit, { maxLength: 24 })
          .chain((units) => fc.tuple(fc.constant(units.join("")), respelled(units))),
        ([plain, spelled]) => {
          expect(decodeAttributeValue(spelled)).toBe(plain);
        },
      ),
      { seed: 1, numRuns: 400 },
    );
  });

  test("every named reference the platform knows decodes to its ASCII text", () => {
    for (const [name, value] of ASCII_REFERENCE_ENTRIES) {
      expect(name).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(value.length).toBeGreaterThan(0);
      expect([...value].every((ch) => ch.charCodeAt(0) < 0x80)).toBe(true);
      expect(decodeAttributeValue(`a&${name};b`)).toBe(`a${value}b`);
    }
  });

  test("a name the table lacks, or a name without its `;`, stays as written", () => {
    expect(decodeAttributeValue("&notareference;&colon")).toBe("&notareference;&colon");
  });

  test("a null, surrogate or out-of-range code point reads as U+FFFD, as a browser reads it", () => {
    for (const reference of [
      "&#0;",
      "&#x0;",
      "&#99999999;",
      "&#x110000;",
      "&#xD800;",
      "&#57343;",
    ]) {
      expect(decodeAttributeValue(`java${reference}script:`)).toBe("java\u{FFFD}script:");
    }
    expect(decodeAttributeValue("&#x10FFFF;")).toBe(String.fromCodePoint(0x10ffff));
    expect(decodeAttributeValue("&#xD7FF;&#xE000;")).toBe("\u{D7FF}\u{E000}");
  });
});

const browserStripsAnywhere = fc.constantFrom("\t", "\n", "\r");
const browserStripsLeading = fc.oneof(
  fc.constant(" "),
  fc.integer({ min: 1, max: 0x1f }).map((code) => String.fromCodePoint(code)),
);

/** A dangerous value as an attacker may write it: mixed case, stray tabs and newlines, respelled. */
const disguised = fc
  .tuple(
    fc.constantFrom("javascript:alert(1)", "vbscript:msgbox", "data:text/html,<script>"),
    fc.array(browserStripsLeading, { maxLength: 3 }),
  )
  .chain(([value, leading]) =>
    fc
      .tuple(
        ...[...value].map((ch) =>
          fc.tuple(
            fc.constantFrom(ch.toLowerCase(), ch.toUpperCase()),
            fc.array(browserStripsAnywhere, { maxLength: 2 }),
          ),
        ),
      )
      .map((chars) => [...leading, ...chars.flatMap(([ch, noise]) => [ch, ...noise])]),
  )
  .chain(respelled);

describe("a dangerous scheme however it is spelled", () => {
  test("is flagged as dangerous and off-origin in any URL attribute", () => {
    fc.assert(
      fc.property(disguised, fc.constantFrom(undefined, "href", "src"), (value, attribute) => {
        expect(isDangerousUrl(value, attribute)).toBe(true);
        expect(isOffOriginUrl(value, attribute)).toBe(true);
      }),
      { seed: 1, numRuns: 300 },
    );
  });

  test("hides no scheme behind a numeric reference without its `;`", () => {
    expect(isDangerousUrl("javascript&#58alert(1)")).toBe(true);
    expect(isDangerousUrl("javascript&#x3A%0Aalert(1)")).toBe(true);
  });
});

describe("a srcset read as a browser reads it", () => {
  test("splits a candidate at ASCII whitespace, where a browser splits it", () => {
    expect(isDangerousUrl("java\tscript:alert(1)")).toBe(true);
    expect(isDangerousUrl("java\tscript:alert(1) 1x", "srcset")).toBe(false);
    expect(isOffOriginUrl("/a.png 1x,\u{2003}https://evil.example/x.png 2x", "srcset")).toBe(false);
    expect(isOffOriginUrl("/a.png 1x, https://evil.example/x.png 2x", "srcset")).toBe(true);
  });

  test("a whitespace reference splits a candidate exactly as the literal whitespace does", () => {
    for (const [name, value] of ASCII_REFERENCE_ENTRIES) {
      if (value.trim() !== "") continue;
      expect(isDangerousUrl(`java&${name};script:alert(1) 1x`, "srcset")).toBe(
        isDangerousUrl(`java${value}script:alert(1) 1x`, "srcset"),
      );
    }
  });

  test("one dangerous candidate among safe ones flags the whole srcset", () => {
    expect(isDangerousUrl("/a.png 1x, javascript:alert(1) 2x, /b.png 3x", "srcset")).toBe(true);
    expect(isOffOriginUrl("/a.png 1x, //evil.example/b.png 2x", "srcset")).toBe(true);
  });

  test("names a served file when any one candidate is served", () => {
    expect(namesServedFile(`/a.png 1x, ${fileUrl("k")} 2x`, "srcset")).toBe(true);
    expect(namesServedFile("/a.png 1x, /b.png 2x", "srcset")).toBe(false);
  });

  test("an empty trailing candidate names nothing", () => {
    expect(isOffOriginUrl("/a.png 1x, ", "srcset")).toBe(false);
    expect(namesServedFile(`${fileUrl("k")} 1x,`, "srcset")).toBe(true);
  });
});

describe("isDangerousUrl", () => {
  test("flags script schemes, including whitespace-obfuscated ones", () => {
    expect(isDangerousUrl("javascript:alert(1)")).toBe(true);
    expect(isDangerousUrl("  JavaScript:alert(1)")).toBe(true);
    expect(isDangerousUrl("java\tscript:alert(1)")).toBe(true);
    expect(isDangerousUrl("vbscript:msgbox")).toBe(true);
  });

  test("allows inline data:image but flags other data payloads", () => {
    expect(isDangerousUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isDangerousUrl("data:text/html,<script>")).toBe(true);
    expect(isDangerousUrl(" data:text/html,<script>")).toBe(true);
  });

  test("allows ordinary http(s) and relative URLs", () => {
    expect(isDangerousUrl("https://example.com/p.jpg")).toBe(false);
    expect(isDangerousUrl("/media/p.jpg")).toBe(false);
    expect(isDangerousUrl("p.jpg")).toBe(false);
  });
});

describe("isOffOriginUrl", () => {
  test("keeps same-origin paths and inline images", () => {
    for (const value of [
      "/media/p.jpg",
      "p.jpg",
      "data:image/png;base64,AAAA",
      "DATA:IMAGE/png,x",
    ]) {
      expect(isOffOriginUrl(value)).toBe(false);
    }
  });

  test("flags any scheme and any protocol-relative authority, however it is prefixed or slashed", () => {
    for (const value of [
      "https://evil.example/x.png",
      " https://evil.example/x.png",
      "\u0001https://evil.example/x.png",
      "mailto:a@evil.example",
      "//evil.example/x.png",
      "\\\\evil.example\\x.png",
      "/\\evil.example/x.png",
    ]) {
      expect(isOffOriginUrl(value)).toBe(true);
    }
  });
});

describe("namesServedFile", () => {
  test("names a file only at the served prefix on this origin", () => {
    expect(namesServedFile(fileUrl("abc"))).toBe(true);
    expect(namesServedFile(` ${fileUrl("abc")}`)).toBe(true);
    expect(namesServedFile("/media/abc")).toBe(false);
    expect(namesServedFile(`https://evil.example${fileUrl("abc")}`)).toBe(false);
    expect(namesServedFile(`//evil.example${fileUrl("abc")}`)).toBe(false);
  });
});
