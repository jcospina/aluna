import { describe, expect, test } from "bun:test";
import { TextScan } from "./text-scan.ts";

/** Scan `bytes` cut into `chunkSize` pieces: the encoding, or undefined when refused. */
function scan(bytes: Uint8Array, chunkSize = bytes.byteLength || 1) {
  const scanner = new TextScan();
  for (let at = 0; at < bytes.byteLength; at += chunkSize) {
    if (!scanner.feed(bytes.subarray(at, at + chunkSize))) return undefined;
  }
  return scanner.finish();
}

const SPANISH = "Presupuesto del año: café, té y más. ¿Cuánto? ¡Todo!\n";
const utf8 = (text: string) => new TextEncoder().encode(text);
const bom8 = (text: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]);

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const data = new DataView(bytes.buffer);
  data.setUint16(0, 0xfeff, littleEndian);
  for (let at = 0; at < text.length; at++)
    data.setUint16(2 + at * 2, text.charCodeAt(at), littleEndian);
  return bytes;
}

/** The text as Excel's Windows-1252 writes it: one byte a letter, `ñ` as 0xF1. */
function latin1(text: string): Uint8Array {
  return new Uint8Array([...text].map((char) => char.charCodeAt(0)));
}

describe("a text file", () => {
  test("is admitted in each encoding, with the label TextDecoder reads it back by", () => {
    const ascii = "# Plain ASCII notes\n";
    const cases = [
      [utf8(SPANISH), "utf-8", SPANISH],
      [bom8(SPANISH), "utf-8", SPANISH],
      [utf16(SPANISH, true), "utf-16le", SPANISH],
      [utf16(SPANISH, false), "utf-16be", SPANISH],
      [latin1(SPANISH), "windows-1252", SPANISH],
      [utf8(ascii), "utf-8", ascii],
    ] as const;
    for (const [bytes, label, text] of cases) {
      for (const chunkSize of [1, 2, 3, 7, bytes.byteLength]) {
        expect(scan(bytes, chunkSize), `${label} in ${chunkSize}s`).toBe(label);
      }
      // Bun's types list fewer labels than its TextDecoder reads, UTF-16's byte orders among them.
      const decoder = new TextDecoder(label as ConstructorParameters<typeof TextDecoder>[0]);
      expect(decoder.decode(bytes)).toBe(text);
    }
  });

  test("is admitted empty, or holding only a byte-order mark", () => {
    expect(scan(new Uint8Array(0))).toBe("utf-8");
    expect(scan(new Uint8Array([0xef, 0xbb, 0xbf]))).toBe("utf-8");
    expect(scan(new Uint8Array([0xff, 0xfe]))).toBe("utf-16le");
  });

  test("turns 8-bit where UTF-8 stops holding, however far in", () => {
    const late = new Uint8Array([...utf8("a".repeat(100_000)), ...latin1("año")]);
    expect(scan(late, 4096)).toBe("windows-1252");
    const cut = utf8("año").subarray(0, 2);
    expect(scan(cut)).toBe("windows-1252");
  });

  test("is refused for a zero byte anywhere, which UTF-16 without its BOM is full of", () => {
    const noBom = utf16(SPANISH, true).subarray(2);
    expect(scan(noBom)).toBeUndefined();
    for (const bytes of [utf8(`${SPANISH}\0`), bom8(`\0${SPANISH}`), latin1(`añ\0o`)]) {
      expect(scan(bytes, 5)).toBeUndefined();
    }
  });

  test("is refused the moment a zero byte arrives", () => {
    const scanner = new TextScan();
    expect(scanner.feed(utf8(SPANISH))).toBe(true);
    expect(scanner.feed(new Uint8Array([0x41, 0]))).toBe(false);
    expect(scanner.feed(utf8("more"))).toBe(false);
    expect(scanner.finish()).toBeUndefined();
  });

  test("with a UTF-8 BOM is refused when what follows is not UTF-8", () => {
    expect(scan(new Uint8Array([0xef, 0xbb, 0xbf, ...latin1("año")]))).toBeUndefined();
    expect(scan(bom8("año").subarray(0, 5))).toBeUndefined();
  });

  test("in UTF-16 is refused cut mid-unit, with a lone surrogate, or holding a zero unit", () => {
    const le = (units: number[]) => {
      const bytes = new Uint8Array(2 + units.length * 2);
      const data = new DataView(bytes.buffer);
      data.setUint16(0, 0xfeff, true);
      units.forEach((unit, at) => {
        data.setUint16(2 + at * 2, unit, true);
      });
      return bytes;
    };
    expect(scan(le([0xd83c, 0xdf05]))).toBe("utf-16le");
    expect(scan(le([0x41]).subarray(0, 3))).toBeUndefined();
    for (const units of [[0xd83c], [0xdf05], [0xd83c, 0x41], [0xdf05, 0xd83c], [0x41, 0]]) {
      expect(scan(le(units), 1), units.join()).toBeUndefined();
    }
    // UTF-32LE's BOM reads as UTF-16LE's followed by a zero unit.
    expect(scan(new Uint8Array([0xff, 0xfe, 0, 0, 0x41, 0, 0, 0]))).toBeUndefined();
  });
});
