// A filename is data (Module 7 PLAN decision 6): kept as the name the person gave their file, and
// sent back in a disposition header Bun can write. A leaf: it imports nothing.

export const MAX_NAME_BYTES = 255;
/** Longer than this after its last dot, the tail is part of the name and the cap may cut it. */
const MAX_EXTENSION_BYTES = 16;

/**
 * Invisible characters with no place in a name: the marks, embeddings, overrides and isolates of
 * the bidirectional algorithm (UAX #9), the line and paragraph separators, the zero-width space,
 * the word joiner and the byte-order mark. The zero-width joiners stay: emoji and scripts use them.
 */
const INVISIBLE = new Set([
  0x061c, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060,
  0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

const encoder = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

function codePointOf(char: string): number {
  return char.codePointAt(0) ?? 0;
}

/** C0, DEL and C1 controls, and the invisible characters above. */
function isStripped(char: string): boolean {
  const codePoint = codePointOf(char);
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) || INVISIBLE.has(codePoint);
}

/** A percent-encoded header value is printable ASCII; Bun reads any other byte as Latin-1. */
function isPrintableAscii(value: string): boolean {
  return [...value].every((char) => codePointOf(char) >= 0x20 && codePointOf(char) <= 0x7e);
}

/**
 * The name a person gave their file, from the upload's percent-encoded header value: decoded,
 * stripped of control and invisible characters, reduced to what follows its last slash, and
 * normalized to NFC. Undefined when the value holds anything but printable ASCII, or its escapes
 * are not UTF-8. Admission reads its extension here, before {@link capFileName} can move it.
 */
export function decodeFileName(encoded: string): string | undefined {
  if (!isPrintableAscii(encoded)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  const kept = [...decoded].filter((char) => !isStripped(char)).join("");
  const base = kept.slice(Math.max(kept.lastIndexOf("/"), kept.lastIndexOf("\\")) + 1);
  return base.normalize("NFC");
}

/** At most 255 bytes of UTF-8, cut between graphemes, keeping an extension of up to 16 bytes. */
export function capFileName(name: string): string {
  if (byteLength(name) <= MAX_NAME_BYTES) return name;
  const dot = name.lastIndexOf(".");
  const tail = dot >= 0 ? name.slice(dot) : "";
  const extension = byteLength(tail) <= MAX_EXTENSION_BYTES ? tail : "";
  let used = byteLength(extension);
  let stem = "";
  for (const { segment } of graphemes.segment(name.slice(0, name.length - extension.length))) {
    used += byteLength(segment);
    if (used > MAX_NAME_BYTES) break;
    stem += segment;
  }
  return stem + extension;
}

/** Printable ASCII a quoted `filename` may carry as it is; `%` because some browsers decode it. */
function isPlainAscii(char: string): boolean {
  return isPrintableAscii(char) && !`"\\%`.includes(char);
}

/** RFC 8187's `attr-char` leaves `'`, `(`, `)` and `*` out, and `encodeURIComponent` keeps them. */
function encodeExtValue(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * An inline disposition naming the file (RFC 6266 and RFC 8187): an ASCII fallback for a client
 * that reads only `filename`, and the whole name, percent-encoded, in `filename*`.
 */
export function inlineContentDisposition(name: string): string {
  const wellFormed = name.toWellFormed();
  const fallback = [...wellFormed].map((char) => (isPlainAscii(char) ? char : "_")).join("");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeExtValue(wellFormed)}`;
}
