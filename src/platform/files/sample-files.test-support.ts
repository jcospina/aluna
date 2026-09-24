// The leading bytes of each format admission knows, and of the ones it refuses, padded to a size,
// and a count of the files this process holds open. Not a test file itself, so bun never runs it.

import { fstatSync, readdirSync } from "node:fs";

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/** An ISO-BMFF `ftyp` box with `brand` as its major brand, then `compatible`. */
function ftyp(brand: string, compatible = "mif1miaf"): number[] {
  return [0, 0, 0, 0x18, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0, ...ascii(compatible)];
}

export const SAMPLE_HEADS = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, ...ascii("IHDR")],
  gif87: ascii("GIF87a"),
  gif89: ascii("GIF89a"),
  webp: [...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 ")],
  avif: ftyp("avif"),
  avis: ftyp("avis"),
  heic: ftyp("heic"),
  heix: ftyp("heix"),
  mif1: ftyp("mif1"),
  msf1: ftyp("msf1"),
  mif1Avif: ftyp("mif1", "avifmiaf"),
  tiffLittle: [0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0],
  tiffBig: [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08],
  svg: ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  text: ascii("A note about the harbour at dawn, and nothing like a picture at all."),
} as const;

export type SampleFormat = keyof typeof SAMPLE_HEADS;

/** `format`'s head followed by filler up to `size` bytes, each byte distinct enough to compare. */
export function sampleFile(format: SampleFormat, size = 4096): Uint8Array<ArrayBuffer> {
  const head = SAMPLE_HEADS[format];
  const bytes = new Uint8Array(Math.max(size, head.length));
  for (let index = head.length; index < bytes.length; index += 1) bytes[index] = index % 251;
  bytes.set(head);
  return bytes;
}

/** Regular files this process holds open; sockets and pipes, a test's own server's among them, are not counted. */
export function openRegularFiles(): number {
  return readdirSync("/dev/fd").filter((descriptor) => {
    try {
      return fstatSync(Number(descriptor)).isFile();
    } catch {
      return false;
    }
  }).length;
}
