// One entry of a zip, read from a written file (Module 7 PLAN decision 3). A zip's central
// directory sits at its end, so this runs after the write. Every size it trusts is capped, the
// entry is inflated under the cap and its CRC checked, and anything it cannot read plainly (ZIP64,
// several disks, an encrypted entry, two entries of one name) answers undefined.

import { inflateRawSync } from "node:zlib";
import type { ReadAt } from "./compound-file.ts";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const END_BYTES = 22;
const LOCAL_BYTES = 30;
const CENTRAL_BYTES = 46;
const MAX_COMMENT_BYTES = 0xffff;
/** A central directory longer than this lists more parts than a Word document has. */
export const MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;

const STORED = 0;
const DEFLATED = 8;

interface Directory {
  readonly entries: number;
  readonly offset: number;
  readonly bytes: number;
}

interface Entry {
  readonly nameBytes: Uint8Array;
  readonly method: number;
  readonly crc: number;
  readonly compressed: number;
  readonly size: number;
  readonly localOffset: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_LOCATOR_BYTES = 20;

/** Where the end record nearest the end sits, when it is whole and its comment ends the file. */
function nearestEnd(data: DataView): number | undefined {
  let at = data.byteLength - 4;
  while (at >= 0 && data.getUint32(at, true) !== END_OF_DIRECTORY) at--;
  if (at < 0 || at > data.byteLength - END_BYTES) return undefined;
  return at + END_BYTES + data.getUint16(at + 20, true) === data.byteLength ? at : undefined;
}

/**
 * The end-of-directory record nearest the file's end, as the readers that scan backward take it,
 * when its comment ends the file exactly, no ZIP64 locator sits before it, and its directory runs
 * right up to it: any other layout is one readers find different directories in.
 */
async function directoryOf(read: ReadAt, size: number): Promise<Directory | undefined> {
  const start = Math.max(0, size - END_BYTES - MAX_COMMENT_BYTES);
  const tail = await read(start, size - start);
  const data = view(tail);
  const at = nearestEnd(data);
  if (at === undefined) return undefined;
  const end = start + at;
  const locator = end >= ZIP64_LOCATOR_BYTES ? await read(end - ZIP64_LOCATOR_BYTES, 4) : undefined;
  if (locator?.byteLength === 4 && view(locator).getUint32(0, true) === ZIP64_LOCATOR)
    return undefined;
  const entries = data.getUint16(at + 10, true);
  const directory = {
    entries,
    bytes: data.getUint32(at + 12, true),
    offset: data.getUint32(at + 16, true),
  };
  const oneDisk = data.getUint32(at + 4, true) === 0 && data.getUint16(at + 8, true) === entries;
  const adjoins = directory.offset + directory.bytes === end;
  return oneDisk && adjoins && directory.bytes <= MAX_CENTRAL_DIRECTORY_BYTES
    ? directory
    : undefined;
}

/** The directory entry at `at`, and where the next begins, or undefined past the listing's end. */
function entryAt(listing: Uint8Array, at: number) {
  const data = view(listing);
  if (at + CENTRAL_BYTES > listing.byteLength || data.getUint32(at, true) !== CENTRAL_HEADER)
    return undefined;
  const nameLength = data.getUint16(at + 28, true);
  const next = at + CENTRAL_BYTES + nameLength + data.getUint16(at + 30, true);
  const end = next + data.getUint16(at + 32, true);
  if (end > listing.byteLength) return undefined;
  const encrypted = (data.getUint16(at + 8, true) & 1) === 1;
  const nameBytes = listing.subarray(at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameLength);
  const entry: Entry = {
    nameBytes,
    method: encrypted ? -1 : data.getUint16(at + 10, true),
    crc: data.getUint32(at + 16, true),
    compressed: data.getUint32(at + 20, true),
    size: data.getUint32(at + 24, true),
    localOffset: data.getUint32(at + 42, true),
  };
  return { entry, name: new TextDecoder().decode(nameBytes), end };
}

/** ASCII case aside, as a package's part names are compared. */
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * A name as the readers that disagree most would read it: ASCII case aside, cut at a NUL, with
 * a backslash as a slash, and with no leading slash.
 */
const readAs = (name: string) =>
  asciiLower(name.split("\u0000")[0] ?? "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");

/**
 * The one entry named `name`, ASCII case aside, when no other entry is one any reader would take
 * for it.
 */
function findEntry(listing: Uint8Array, count: number, name: string): Entry | undefined {
  const wanted = readAs(name);
  const found: (Entry & { readonly name: string })[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    const read = entryAt(listing, at);
    if (!read) return undefined;
    if (readAs(read.name) === wanted) found.push({ ...read.entry, name: read.name });
    at = read.end;
  }
  const [only] = found;
  // The count must use the listing up exactly, or another reader reads entries this one skips.
  return at === listing.byteLength &&
    found.length === 1 &&
    only &&
    asciiLower(only.name) === asciiLower(name)
    ? only
    : undefined;
}

/** Whether the local header at `local` says what the directory says of the entry. */
async function localAgrees(read: ReadAt, entry: Entry, local: DataView): Promise<boolean> {
  if (local.byteLength < LOCAL_BYTES || local.getUint32(0, true) !== LOCAL_HEADER) return false;
  const encrypted = (local.getUint16(6, true) & 1) === 1;
  if (encrypted || local.getUint16(8, true) !== entry.method) return false;
  const name = await read(entry.localOffset + LOCAL_BYTES, local.getUint16(26, true));
  return Buffer.from(name).equals(entry.nameBytes);
}

/** The entry's bytes as stored, found past its local header, before the directory begins. */
async function storedBytes(read: ReadAt, entry: Entry, directory: Directory) {
  const local = view(await read(entry.localOffset, LOCAL_BYTES));
  if (!(await localAgrees(read, entry, local))) return undefined;
  const start =
    entry.localOffset + LOCAL_BYTES + local.getUint16(26, true) + local.getUint16(28, true);
  if (start + entry.compressed > directory.offset) return undefined;
  const bytes = await read(start, entry.compressed);
  return bytes.byteLength === entry.compressed ? bytes : undefined;
}

function unpacked(bytes: Uint8Array, entry: Entry, cap: number): Uint8Array | undefined {
  if (entry.method === STORED) return bytes;
  if (entry.method !== DEFLATED) return undefined;
  try {
    return inflateRawSync(bytes, { maxOutputLength: cap });
  } catch {
    return undefined;
  }
}

/**
 * The bytes of the entry named `name` in the zip `read` holds, at most `cap` of them however far
 * it inflates, or undefined when this reader cannot read it plainly.
 */
export async function readZipEntry(
  read: ReadAt,
  size: number,
  name: string,
  cap: number,
): Promise<Uint8Array | undefined> {
  const directory = await directoryOf(read, size);
  if (!directory) return undefined;
  const listing = await read(directory.offset, directory.bytes);
  if (listing.byteLength !== directory.bytes) return undefined;
  const entry = findEntry(listing, directory.entries, name);
  if (!entry || entry.size > cap || entry.compressed > cap) return undefined;
  const stored = await storedBytes(read, entry, directory);
  const bytes = stored && unpacked(stored, entry, cap);
  if (!bytes || bytes.byteLength !== entry.size) return undefined;
  return Bun.hash.crc32(bytes) === entry.crc ? bytes : undefined;
}
