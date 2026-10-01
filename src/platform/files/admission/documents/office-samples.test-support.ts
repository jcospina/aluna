// Office files built byte by byte: a zip of named parts, an OOXML package whose content types
// declare a given main part, and an OLE2 compound file whose directory holds given names. Not a
// test file itself, so bun never runs it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import type { ReadAt } from "./compound-file.ts";
import { RELATIONSHIPS_NAMESPACE, TYPES_NAMESPACE } from "./word-package.ts";

/** The Word document design/ picks: a minimal package of three parts. */
export const PRESUPUESTO_DOCX = new Uint8Array(
  readFileSync(join(import.meta.dir, "../../../../../design/assets/media/presupuesto.docx")),
);

/** A Word document as a word processor saved it, in each format (`samples/README.md`). */
export const SAVED_DOCX = new Uint8Array(
  readFileSync(join(import.meta.dir, "samples/textutil.docx")),
);
export const SAVED_DOC = new Uint8Array(
  readFileSync(join(import.meta.dir, "samples/textutil.doc")),
);

export interface ZipPart {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** Stored rather than deflated. */
  readonly stored?: true;
  /** The name its local header carries, when not the directory's. */
  readonly localName?: string;
  /** Overrides what the directory says of the part: its sizes, CRC and flags. */
  readonly listed?: Partial<{ size: number; compressed: number; crc: number; flags: number }>;
}

function le(bytes: number, value: number): number[] {
  return Array.from({ length: bytes }, (_, at) => Math.floor(value / 256 ** at) % 256);
}

function bytesOf(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

/** A zip of `parts`, in order, with `comment` after its end-of-directory record. */
export function zipOf(parts: readonly ZipPart[], comment = ""): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  const central: number[] = [];
  for (const part of parts) {
    const data = bytesOf(part.data);
    const packed = part.stored ? data : new Uint8Array(deflateRawSync(data));
    const name = [...new TextEncoder().encode(part.name)];
    const listed = {
      size: data.byteLength,
      compressed: packed.byteLength,
      crc: Bun.hash.crc32(data),
      flags: 0,
      ...part.listed,
    };
    const method = part.stored ? 0 : 8;
    const shared = [...le(2, 20), ...le(2, listed.flags), ...le(2, method), ...le(4, 0)];
    const sizes = [...le(4, listed.crc), ...le(4, listed.compressed), ...le(4, listed.size)];
    const offset = out.length;
    const localName = part.localName ? [...new TextEncoder().encode(part.localName)] : name;
    out.push(...le(4, 0x04034b50), ...shared, ...sizes, ...le(2, localName.length), ...le(2, 0));
    out.push(...localName, ...packed);
    central.push(...le(4, 0x02014b50), ...le(2, 20), ...shared, ...sizes);
    central.push(...le(2, name.length), ...le(2, 0), ...le(2, 0), ...le(2, 0), ...le(2, 0));
    central.push(...le(4, 0), ...le(4, offset), ...name);
  }
  const directoryAt = out.length;
  const note = [...new TextEncoder().encode(comment)];
  out.push(...central, ...le(4, 0x06054b50), ...le(4, 0), ...le(2, parts.length));
  out.push(...le(2, parts.length), ...le(4, central.length), ...le(4, directoryAt));
  out.push(...le(2, note.length), ...note);
  return new Uint8Array(out);
}

export const MAIN_PART_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  docm: "application/vnd.ms-word.document.macroEnabled.main+xml",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
} as const;

/** Where a package's main part sits, as Word lays a document out. */
export const MAIN_PART = "word/document.xml";

/** The content types of a package whose main part is of `mainType`. */
export function contentTypes(mainType: string, extra = ""): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${TYPES_NAMESPACE}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${MAIN_PART}" ContentType="${mainType}"/>${extra}</Types>`;
}

/** Package relationships whose office document is `target`. */
export function relationships(target = MAIN_PART, extra = ""): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>${extra}</Relationships>`;
}

/** An OOXML package of `types` and `rels` around a main part, as Office lays one out. */
export function packageOf(types: string | Uint8Array, rels: string = relationships()) {
  return zipOf([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: rels },
    { name: MAIN_PART, data: `<document>${"Presupuesto del año. ".repeat(200)}</document>` },
  ]);
}

/** An OOXML package of the kind `format` names. */
export function officePackage(format: keyof typeof MAIN_PART_TYPES): Uint8Array<ArrayBuffer> {
  return packageOf(contentTypes(MAIN_PART_TYPES[format]));
}

const SECTOR = 512;
const FREE = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;
const DIFAT_SECTOR = 0xfffffffc;

interface CompoundLayout {
  readonly fatSectors: number;
  readonly difat: number;
  readonly directory: number;
  readonly directorySectors: number;
  readonly total: number;
}

/** Where each part sits: the FAT first, then any DIFAT sectors, then the directory. */
function compoundLayout(entries: number, directoryAt = 0): CompoundLayout {
  const directorySectors = Math.ceil(entries / 4);
  let fatSectors = 1;
  for (;;) {
    const difat = fatSectors > 109 ? Math.ceil((fatSectors - 109) / 127) : 0;
    const directory = Math.max(directoryAt, fatSectors + difat);
    const total = directory + directorySectors;
    if (Math.ceil(total / 128) <= fatSectors) {
      return { fatSectors, difat, directory, directorySectors, total };
    }
    fatSectors = Math.ceil(total / 128);
  }
}

function fatOf(layout: CompoundLayout, loop: boolean): number[] {
  const fat = new Array<number>(layout.fatSectors * 128).fill(FREE);
  fat.fill(FAT_SECTOR, 0, layout.fatSectors);
  fat.fill(DIFAT_SECTOR, layout.fatSectors, layout.fatSectors + layout.difat);
  for (let at = 0; at < layout.directorySectors; at++) {
    const sector = layout.directory + at;
    const last = at === layout.directorySectors - 1;
    fat[sector] = !last ? sector + 1 : loop ? sector : END_OF_CHAIN;
  }
  return fat;
}

function writeHeader(file: Uint8Array, data: DataView, layout: CompoundLayout): void {
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  data.setUint16(0x18, 0x3e, true);
  data.setUint16(0x1a, 3, true);
  data.setUint16(0x1c, 0xfffe, true);
  data.setUint16(0x1e, 9, true);
  data.setUint16(0x20, 6, true);
  data.setUint32(0x2c, layout.fatSectors, true);
  data.setUint32(0x30, layout.directory, true);
  data.setUint32(0x38, 4096, true);
  data.setUint32(0x3c, END_OF_CHAIN, true);
  data.setUint32(0x44, layout.difat ? layout.fatSectors : END_OF_CHAIN, true);
  data.setUint32(0x48, layout.difat, true);
  for (let at = 0; at < 109; at++) {
    data.setUint32(0x4c + at * 4, at < layout.fatSectors ? at : FREE, true);
  }
}

function writeDifat(data: DataView, layout: CompoundLayout): void {
  for (let at = 0; at < layout.difat; at++) {
    const base = SECTOR * (layout.fatSectors + at + 1);
    for (let slot = 0; slot < 127; slot++) {
      const listed = 109 + at * 127 + slot;
      data.setUint32(base + slot * 4, listed < layout.fatSectors ? listed : FREE, true);
    }
    const next = at === layout.difat - 1 ? END_OF_CHAIN : layout.fatSectors + at + 1;
    data.setUint32(base + 127 * 4, next, true);
  }
}

/**
 * An OLE2 compound file (version 3, 512-byte sectors) whose directory holds a root entry and a
 * stream of each of `names`. `directoryAt` moves the directory to a later sector, so far that its
 * FAT entry sits in a FAT sector the DIFAT chain lists; `loop` points its last sector at itself.
 */
export function compoundFileOf(
  names: readonly string[],
  options: { directoryAt?: number; loop?: true } = {},
): Uint8Array<ArrayBuffer> {
  const entries = ["Root Entry", ...names];
  const layout = compoundLayout(entries.length, options.directoryAt);
  const file = new Uint8Array(SECTOR * (layout.total + 1));
  const data = new DataView(file.buffer);
  fatOf(layout, options.loop === true).forEach((entry, at) => {
    data.setUint32(SECTOR * (Math.floor(at / 128) + 1) + (at % 128) * 4, entry, true);
  });
  writeHeader(file, data, layout);
  writeDifat(data, layout);
  entries.forEach((name, index) => {
    const base = SECTOR * (layout.directory + Math.floor(index / 4) + 1) + (index % 4) * 128;
    for (let at = 0; at < name.length; at++)
      data.setUint16(base + at * 2, name.charCodeAt(at), true);
    data.setUint16(base + 0x40, (name.length + 1) * 2, true);
    file[base + 0x42] = index === 0 ? 5 : 2;
  });
  return file;
}

/** What Office writes when it locks a Word document with a password. */
export const LOCKED_WORD_STREAMS = [
  "\u0006DataSpaces",
  "EncryptionInfo",
  "EncryptedPackage",
] as const;

/** A written file's reader, over `bytes`. */
export function readerOf(bytes: Uint8Array): ReadAt {
  return async (start, length) => bytes.slice(start, start + length);
}
