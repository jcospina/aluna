import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  capFileName,
  decodeFileName,
  inlineContentDisposition,
  MAX_EXTENSION_BYTES,
  MAX_NAME_BYTES,
} from "./file-name.ts";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const char = (codePoint: number) => String.fromCodePoint(codePoint);
const decoded = (name: string) => decodeFileName(encodeURIComponent(name));
const FAMILY = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map(char).join("");

describe("a filename from the upload header", () => {
  test("is percent-decoded, so a name beyond Latin-1 round-trips", () => {
    expect(decoded("日本.jpg")).toBe("日本.jpg");
    expect(decodeFileName("harbour%20at%20dawn.jpg")).toBe("harbour at dawn.jpg");
  });

  test("accepts every printable ASCII character as written, from the space through the tilde", () => {
    // The escape and the two slashes mean something before they are characters, so they are
    // written escaped here; the slashes' own meaning is the case further down.
    const printable = fc.integer({ min: 0x20, max: 0x7e }).map(char);
    const plain = printable.filter((c) => !"%/\\".includes(c));
    fc.assert(
      fc.property(fc.string({ unit: plain, minLength: 1 }), (name) => {
        expect(decodeFileName(name)).toBe(name);
      }),
      { seed: 20260926, numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.string({ unit: printable.filter((c) => !"/\\".includes(c)) }), (name) => {
        expect(decoded(name)).toBe(name);
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });

  test("is normalized to NFC, as macOS sends NFD", () => {
    expect(decoded(`cafe${char(0x301)}.jpg`)).toBe(`caf${char(0xe9)}.jpg`);
  });

  test("loses its control, bidirectional, line-breaking and zero-width characters", () => {
    const controls = [0x0, 0x9, 0xa, 0xd, 0x1b, 0x7f, 0x85, 0x9f];
    const bidi = [0x61c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e];
    const isolates = [0x2066, 0x2067, 0x2068, 0x2069];
    const invisible = [0x200b, 0x2028, 0x2029, 0x2060, 0xfeff];
    const noisy = [...controls, ...bidi, ...isolates, ...invisible].map(char).join("");
    expect(decoded(`gpj${noisy}.jpg`)).toBe("gpj.jpg");
  });

  test("keeps the joiners an emoji or a script needs", () => {
    const flag = [0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f].map(char).join("");
    const persian = `${char(0x645)}${char(0x200c)}${char(0x6cc)}.png`;
    for (const name of [`${FAMILY}.png`, `${flag}.png`, persian]) expect(decoded(name)).toBe(name);
  });

  test("keeps only what follows its last slash, forward or back", () => {
    expect(decoded("../../etc/passwd.jpg")).toBe("passwd.jpg");
    expect(decoded("C:\\Users\\ana\\harbour.png")).toBe("harbour.png");
    expect(decoded("photos/")).toBe("");
  });

  test("joins across a stripped character instead of stopping at it", () => {
    expect(decodeFileName("notes.txt%00.jpg")).toBe("notes.txt.jpg");
  });

  test("is refused when it is not printable ASCII, or its escapes are not UTF-8", () => {
    expect(decodeFileName("100%.jpg")).toBeUndefined();
    expect(decodeFileName("%E6%97.jpg")).toBeUndefined();
    const latin1 = [0xe6, 0x97, 0xa5].map(char).join("");
    expect(decodeFileName(`${latin1}.jpg`)).toBeUndefined();
    expect(decodeFileName(`tab${char(0x9)}.jpg`)).toBeUndefined();
  });
});

const segments = (text: string): string[] =>
  [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
    ({ segment }) => segment,
  );

const anyName = fc
  .tuple(
    fc.string({
      unit: fc.oneof(
        fc.constantFrom(".", "a", "e\u0301"),
        fc.constant("日"),
        fc.string({ unit: "grapheme", minLength: 1, maxLength: 1 }),
      ),
      maxLength: 160,
    }),
    fc.nat({ max: 4 }).map((n) => "x".repeat(n * 60)),
  )
  .map(([name, padding]) => padding + name);

/**
 * A tail after a final dot, with whether the cap keeps it, known by how it was built rather than
 * read back off the name: a tail within the extension limit in bytes is kept, a longer one is
 * part of the name. The last is no tail at all, so the name it ends carries no dot.
 */
const tails = fc.oneof(
  fc.nat({ max: MAX_EXTENSION_BYTES - 1 }).map((n) => ({ tail: `.${"e".repeat(n)}`, kept: true })),
  fc
    .integer({ min: MAX_EXTENSION_BYTES, max: MAX_EXTENSION_BYTES + 24 })
    .map((n) => ({ tail: `.${"e".repeat(n)}`, kept: false })),
  // Three bytes a character: `.` and as many as fit, then one more than fits.
  fc
    .nat({ max: Math.floor((MAX_EXTENSION_BYTES - 1) / 3) })
    .map((n) => ({ tail: `.${"日".repeat(n)}`, kept: true })),
  fc.constant({
    tail: `.${"日".repeat(Math.floor((MAX_EXTENSION_BYTES - 1) / 3) + 1)}`,
    kept: false,
  }),
  fc.constant({ tail: "", kept: false }),
);

/** A name over the cap, and the extension the cap must keep on it. */
const longFile = fc
  .tuple(anyName, tails)
  .map(([stem, { tail, kept }]) => ({
    name: (tail === "" ? stem.replaceAll(".", "") : stem) + tail,
    extension: kept ? tail : "",
  }))
  .filter(({ name }) => bytes(name) > MAX_NAME_BYTES);

describe("the cap on a filename", () => {
  test("keeps any name within the byte cap whole, and cuts a longer one to fit", () => {
    fc.assert(
      fc.property(anyName, (name) => {
        const capped = capFileName(name);
        expect(bytes(capped)).toBeLessThanOrEqual(MAX_NAME_BYTES);
        if (bytes(name) <= MAX_NAME_BYTES) expect(capped).toBe(name);
      }),
      { seed: 1, numRuns: 400 },
    );
  });

  test("keeps a short extension and as many whole graphemes of the rest as fit before it", () => {
    fc.assert(
      fc.property(longFile, ({ name, extension }) => {
        const capped = capFileName(name);
        expect(capped.endsWith(extension)).toBe(true);
        const stem = segments(name.slice(0, name.length - extension.length));
        const kept = segments(capped.slice(0, capped.length - extension.length));
        expect(kept).toEqual(stem.slice(0, kept.length));
        const next = stem[kept.length] ?? "";
        expect(bytes(capped) + bytes(next)).toBeGreaterThan(MAX_NAME_BYTES);
      }),
      { seed: 1, numRuns: 400 },
    );
  });

  test("is the byte cap, keeping the extension and cutting between characters", () => {
    for (const stem of ["a".repeat(300), "日".repeat(120), `${"e".repeat(250)}${char(0x301)}x`]) {
      const name = capFileName(`${stem}.jpeg`);
      expect(bytes(name)).toBeLessThanOrEqual(MAX_NAME_BYTES);
      expect(name.endsWith(".jpeg")).toBe(true);
      expect(stem.startsWith(name.slice(0, -".jpeg".length))).toBe(true);
    }
    const capped = capFileName(`${FAMILY.repeat(20)}.gif`);
    expect(
      capped
        .replace(".gif", "")
        .split(FAMILY)
        .every((part) => part === ""),
    ).toBe(true);
  });

  test("keeps a name of exactly the cap, and cuts a long tail that is no extension from the end", () => {
    const exact = `${"b".repeat(MAX_NAME_BYTES - 4)}.png`;
    expect(capFileName(exact)).toBe(exact);
    const name = `photo.${"x".repeat(MAX_NAME_BYTES)}`;
    expect(capFileName(name)).toBe(name.slice(0, MAX_NAME_BYTES));
  });

  test("keeps an extension of exactly the extension limit, and drops one a byte longer", () => {
    const stem = "s".repeat(MAX_NAME_BYTES);
    const longest = `.${"e".repeat(MAX_EXTENSION_BYTES - 1)}`;
    const capped = capFileName(`${stem}${longest}`);
    expect(capped).toBe(`${stem.slice(0, MAX_NAME_BYTES - longest.length)}${longest}`);
    const tooLong = `${stem}.${"e".repeat(MAX_EXTENSION_BYTES)}`;
    expect(capFileName(tooLong)).toBe(tooLong.slice(0, MAX_NAME_BYTES));
  });

  test("cuts a long name with no dot to its first bytes", () => {
    const name = `${"n".repeat(MAX_NAME_BYTES)}XYZ`;
    expect(capFileName(name)).toBe(name.slice(0, MAX_NAME_BYTES));
  });
});

describe("the disposition a served file carries", () => {
  test("names the file in ASCII and, whole, in RFC 8187's encoding", () => {
    expect(inlineContentDisposition("日本.jpg")).toBe(
      `inline; filename="__.jpg"; filename*=UTF-8''%E6%97%A5%E6%9C%AC.jpg`,
    );
  });

  test("keeps every printable ASCII character but quotes, backslashes and percent signs in the fallback", () => {
    const printable = fc.integer({ min: 0x20, max: 0x7e }).map(char);
    fc.assert(
      fc.property(fc.string({ unit: printable }), (name) => {
        const fallback = /^inline; filename="([^"]*)"; /.exec(inlineContentDisposition(name))?.[1];
        expect(fallback).toHaveLength(name.length);
        [...name].forEach((written, at) => {
          const expected = ['"', "\\", "%"].includes(written) ? "_" : written;
          expect({ written, kept: fallback?.[at] }).toEqual({ written, kept: expected });
        });
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });

  test("keeps quotes, backslashes and percent signs out of the fallback", () => {
    expect(inlineContentDisposition(`a"b\\c%d's (1)*.png`)).toBe(
      `inline; filename="a_b_c_d's (1)*.png"; filename*=UTF-8''a%22b%5Cc%25d%27s%20%281%29%2A.png`,
    );
  });

  test("is a header value Bun will send, whatever the name holds", () => {
    const loneSurrogate = String.fromCharCode(0xd800);
    for (const name of ["日本.jpg", `tab${char(0x9)}.png`, `${loneSurrogate}.gif`, "a\r\nb", ""]) {
      const response = new Response(null, {
        headers: { "content-disposition": inlineContentDisposition(name) },
      });
      expect(response.headers.get("content-disposition")).toStartWith("inline; filename=");
    }
  });
});
