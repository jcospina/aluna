// The byte tests admission's table reads a file's container by (Module 7 PLAN decision 3): the
// ISO-BMFF `ftyp` box, a QuickTime movie's first atom, and an EBML header's DocType. Containers are
// checked and codecs are not. A leaf: it imports nothing.

export function bytesAt(head: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => head[offset + index] === byte);
}

export function asciiAt(head: Uint8Array, offset: number, text: string): boolean {
  return bytesAt(
    head,
    offset,
    [...text].map((char) => char.charCodeAt(0)),
  );
}

/** An ISO-BMFF `ftyp` box whose major brand is one of `brands`; HEIC's and HEIF's are not here. */
export function majorBrandIn(head: Uint8Array, brands: readonly string[]): boolean {
  return asciiAt(head, 4, "ftyp") && brands.some((brand) => asciiAt(head, 8, brand));
}

/**
 * The still-image brands of HEIF, AVIF, JPEG XL, their kin and Canon's raw photo. Many an `.m4a`
 * carries `isom` or `mp42`, as a video does, so a video row takes any other brand and leaves the family to the
 * extension.
 */
const STILL_IMAGE_BRANDS = [
  ...["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "avci", "avcs"],
  ...["mif1", "mif2", "mif3", "msf1", "miaf", "avif", "avis", "avio", "jxl ", "j2ki", "j2is"],
  ...["jpeg", "jpgs", "vvic", "vvis", "uvvu", "crx "],
];

const QUICKTIME_BRAND = "qt  ";

/** An ISO-BMFF file of any brand but a still image's or QuickTime's. */
export function isoMovie(head: Uint8Array): boolean {
  return asciiAt(head, 4, "ftyp") && !majorBrandIn(head, [...STILL_IMAGE_BRANDS, QUICKTIME_BRAND]);
}

/** The atoms a QuickTime movie written before `ftyp` existed opens with. */
const QUICKTIME_FIRST_ATOMS = ["moov", "mdat", "wide", "free", "skip"];

function u32(head: Uint8Array, at: number): number {
  return (
    (head[at] ?? 0) * 0x1000000 +
    (head[at + 1] ?? 0) * 0x10000 +
    ((head[at + 2] ?? 0) << 8) +
    (head[at + 3] ?? 0)
  );
}

/**
 * The first atom's size: `0` runs to the end of the file, and `1` means the next eight bytes hold
 * it. Undefined for a size no atom has.
 */
function firstAtomSize(head: Uint8Array): number | undefined {
  const size = u32(head, 0);
  if (size === 0) return Number.POSITIVE_INFINITY;
  if (size === 1) return u32(head, 8) * 0x100000000 + u32(head, 12);
  return size >= 8 ? size : undefined;
}

/**
 * A QuickTime movie: the `qt  ` brand, or a first atom of a movie's with a size an atom can have.
 * Only the media data may run to the end or need a long size, and `wide` is eight bytes before the
 * atom it makes room for.
 */
export function quickTimeMovie(head: Uint8Array): boolean {
  if (majorBrandIn(head, [QUICKTIME_BRAND])) return true;
  const atom = QUICKTIME_FIRST_ATOMS.find((type) => asciiAt(head, 4, type));
  const size = firstAtomSize(head);
  if (atom === undefined || size === undefined) return false;
  if (u32(head, 0) < 8 && atom !== "mdat") return false;
  if (atom !== "wide") return true;
  return size === 8 && QUICKTIME_FIRST_ATOMS.some((next) => asciiAt(head, 12, next));
}

/** Whether a QuickTime movie's first atom fits in the `total` bytes the file turned out to hold. */
export function quickTimeFits(head: Uint8Array, total: number): boolean {
  if (majorBrandIn(head, [QUICKTIME_BRAND])) return true;
  const size = firstAtomSize(head);
  return size !== undefined && (size === Number.POSITIVE_INFINITY || size <= total);
}

/** How far into a file its EBML header is read. */
export const EBML_HEAD_BYTES = 64;

/**
 * An EBML variable-length integer at `at`: its width from the leading zeros of its first byte, and
 * its value, the width's marker bit kept for an element ID and cleared for a size.
 */
function vint(head: Uint8Array, at: number, marker: boolean) {
  const first = head[at];
  if (first === undefined || first === 0) return undefined;
  const width = Math.clz32(first) - 23;
  if (at + width > head.byteLength) return undefined;
  let value = marker ? first : first & (0xff >> width);
  for (let index = 1; index < width; index += 1) value = value * 256 + (head[at + index] ?? 0);
  return { value, width };
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const DOC_TYPE_ID = 0x4282;

/** A DocType string, which EBML lets a writer pad with zero bytes. */
function docTypeIs(value: Uint8Array, name: string): boolean {
  let end = value.byteLength;
  while (end > 0 && value[end - 1] === 0) end -= 1;
  return end === name.length && asciiAt(value, 0, name);
}

/**
 * An EBML header whose DocType element reads `webm`, found by walking the header's elements, each
 * an ID and a size. A Matroska file shares the header and names itself `matroska`.
 */
export function webmDocument(head: Uint8Array): boolean {
  if (!bytesAt(head, 0, EBML_MAGIC)) return false;
  const header = vint(head, EBML_MAGIC.length, false);
  if (!header) return false;
  let at = EBML_MAGIC.length + header.width;
  const end = Math.min(head.byteLength, at + header.value);
  while (at < end) {
    const id = vint(head, at, true);
    const size = id && vint(head, at + id.width, false);
    if (!id || !size) return false;
    at += id.width + size.width;
    if (id.value === DOC_TYPE_ID) return docTypeIs(head.subarray(at, at + size.value), "webm");
    at += size.value;
  }
  return false;
}
