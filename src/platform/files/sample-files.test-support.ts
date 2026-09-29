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

/** An EBML header naming `docType`, laid out as Chrome's recorder writes a WebM's. */
function ebml(docType: string): number[] {
  const header = [
    ...[0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04],
    ...[0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x80 | docType.length, ...ascii(docType)],
    ...[0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02],
  ];
  return [0x1a, 0x45, 0xdf, 0xa3, 0x80 | header.length, ...header, 0x18, 0x53, 0x80, 0x67];
}

/**
 * A WebM as a recorder writes one: the EBML header, then a Segment of unknown size holding Info and
 * Tracks with one entry of each `trackTypes` (1 a picture, 2 a sound, or the type's raw bytes),
 * then a Cluster.
 */
export function webmWithTracks(
  trackTypes: readonly (number | readonly number[])[],
  voidBytes = 0,
): Uint8Array<ArrayBuffer> {
  const entries = trackTypes.flatMap((type, index) => {
    const value = typeof type === "number" ? [type] : type;
    const entry = [0xd7, 0x81, index + 1, 0x83, 0x80 | value.length, ...value];
    return [0xae, 0x80 | entry.length, ...entry];
  });
  const skip =
    voidBytes === 0
      ? []
      : [0xec, 0x20 | (voidBytes >> 16), (voidBytes >> 8) & 0xff, voidBytes & 0xff];
  const segment = [
    ...[0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    ...skip,
    ...new Array(voidBytes).fill(0),
    ...[0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40],
    ...[0x16, 0x54, 0xae, 0x6b, 0x80 | entries.length, ...entries],
    ...[0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
  ];
  // `ebml` ends with the Segment's ID.
  return new Uint8Array([...ebml("webm"), ...segment]);
}

/** An Ogg whose streams each open with a page holding one packet that starts with `packets`'s. */
export function oggWith(...packets: (readonly number[] | string)[]): Uint8Array<ArrayBuffer> {
  const pages = packets.flatMap((packet) => {
    const body = typeof packet === "string" ? ascii(packet) : [...packet];
    return [...ascii("OggS"), 0, 0x02, ...new Array(20).fill(0), 1, body.length, ...body];
  });
  return new Uint8Array([...pages, ...new Array(64).fill(0)]);
}

/** A QuickTime atom of type `atom`, with no `ftyp` before it. */
function atom(type: string): number[] {
  return [0, 0, 0x10, 0, ...ascii(type), ...ascii("mvhd")];
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
  isom: ftyp("isom", "isomiso2avc1mp41"),
  mp42: ftyp("mp42", "mp42isom"),
  m4v: ftyp("M4V ", "M4V M4A mp42isom"),
  m4a: ftyp("M4A ", "M4A mp42isom"),
  quickTime: ftyp("qt  ", "qt  "),
  moovFirst: atom("moov"),
  wideFirst: [0, 0, 0, 8, ...ascii("wide"), 0, 0, 0x0f, 0xf8, ...ascii("mdat")],
  mdatFirst: atom("mdat"),
  webm: ebml("webm"),
  matroska: ebml("matroska"),
  ogg: [...ascii("OggS"), 0, 0x02, 0, 0, 0, 0, 0, 0, 0, 0],
  opus: [...ascii("OggS"), 0, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, ...ascii("OpusHead")],
  wav: [...ascii("RIFF"), 0x24, 0x08, 0, 0, ...ascii("WAVEfmt "), 0x10, 0, 0, 0],
  flac: [...ascii("fLaC"), 0, 0, 0, 0x22],
  heicMovie: ftyp("heic", "mif1heicmp42"),
  avio: ftyp("avio", "avioavifmif1"),
  jpegInHeif: ftyp("jpeg", "mif1jpeg"),
  vvcInHeif: ftyp("vvic", "mif1vvic"),
  canonRaw: ftyp("crx ", "crx isom"),
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

/** MPEG-1 Layer III at 128 kbps and 44.1 kHz: a 417-byte frame. */
export const MP3_FRAME_HEADER = [0xff, 0xfb, 0x90, 0x00] as const;
export const MP3_FRAME_BYTES = 417;

/** An ID3v2.`major` tag whose size field says `size` bytes follow its header, filled with art. */
export function id3Tag(size: number, major = 3, flags = 0): Uint8Array {
  const tag = new Uint8Array(10 + size);
  tag.set([0x49, 0x44, 0x33, major, 0, flags]);
  tag.set([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f], 6);
  // Cover art: a JPEG, whose bytes hold every value a frame header does.
  for (let index = 10; index < tag.length; index += 1) tag[index] = (index * 7) % 256;
  if (size >= 8) tag.set([0x41, 0x50, 0x49, 0x43, 0xff, 0xd8, 0xff, 0xe0], 10);
  return tag;
}

/** `count` frames that each open with `header` and run `frameBytes`, the rest of them sound. */
export function frameRun(header: readonly number[], frameBytes: number, count = 8): Uint8Array {
  const run = new Uint8Array(frameBytes * count).fill(0x55);
  for (let frame = 0; frame < count; frame += 1) run.set(header, frame * frameBytes);
  return run;
}

/** An ADTS header for an AAC-LC frame of `frameBytes` at 44.1 kHz in stereo, with no CRC. */
export function adtsHeader(frameBytes: number): number[] {
  return [
    0xff,
    0xf1,
    0x50,
    0x80 | (frameBytes >> 11),
    (frameBytes >> 3) & 0xff,
    ((frameBytes & 7) << 5) | 0x1f,
    0xfc,
  ];
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const whole = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.byteLength;
  }
  return whole;
}

/** An MP3 behind a tag of `tagBytes` (none when undefined), `frames` frames long. */
export function mp3File(tagBytes?: number, frames = 8): Uint8Array<ArrayBuffer> {
  const run = frameRun(MP3_FRAME_HEADER, MP3_FRAME_BYTES, frames);
  return tagBytes === undefined ? concatBytes(run) : concatBytes(id3Tag(tagBytes), run);
}

/**
 * Regular files this process holds open; sockets and pipes, a test's own server's among them, are
 * not counted.
 */
export function openRegularFiles(): number {
  return readdirSync("/dev/fd").filter((descriptor) => {
    try {
      return fstatSync(Number(descriptor)).isFile();
    } catch {
      return false;
    }
  }).length;
}
