// The OLE2 compound file ([MS-CFB]) that DOC, XLS, PPT and MSG share, and that Office wraps a
// password-protected DOCX in. Admission reads only the names in its directory, to tell a locked
// Word document (an `EncryptedPackage` stream) from any other file named `.docx`. A leaf: it
// imports nothing.

/** Reads `length` bytes of a written file from `start`; fewer at its end. */
export type ReadAt = (start: number, length: number) => Promise<Uint8Array>;

export const COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

export function isCompoundFile(head: Uint8Array): boolean {
  return COMPOUND_FILE_MAGIC.every((byte, at) => head[at] === byte);
}

const HEADER_BYTES = 512;
const HEADER_FAT_SECTORS = 109;
const END_OF_CHAIN = 0xfffffffe;
const DIRECTORY_ENTRY_BYTES = 128;
/** A directory longer than this is not one a Word document's wrapper has. */
const MAX_DIRECTORY_SECTORS = 1024;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Where a compound file's FAT sits, found lazily: only the sectors a directory walk needs. */
class Fat {
  readonly #read: ReadAt;
  readonly #bytes: number;
  readonly #listed: number[];
  readonly #count: number;
  #nextDifat: number;
  readonly #sectors = new Map<number, DataView>();

  constructor(read: ReadAt, bytes: number, header: DataView) {
    this.#read = read;
    this.#bytes = bytes;
    this.#count = header.getUint32(0x2c, true);
    this.#listed = Array.from({ length: Math.min(this.#count, HEADER_FAT_SECTORS) }, (_, at) =>
      header.getUint32(0x4c + at * 4, true),
    );
    this.#nextDifat = header.getUint32(0x44, true);
  }

  /** The DIFAT sectors the header says there are: as many as the FAT past its first 109 needs. */
  static difatSectors(count: number, bytes: number): number {
    return count > HEADER_FAT_SECTORS
      ? Math.ceil((count - HEADER_FAT_SECTORS) / (bytes / 4 - 1))
      : 0;
  }

  /** The sector after `sector` in its chain, or undefined when the FAT cannot say. */
  async next(sector: number): Promise<number | undefined> {
    const perSector = this.#bytes / 4;
    const index = Math.floor(sector / perSector);
    const fat = index < this.#count ? await this.#fatSector(index) : undefined;
    return fat?.getUint32((sector % perSector) * 4, true);
  }

  async #fatSector(index: number): Promise<DataView | undefined> {
    const sector = await this.#listedAt(index);
    if (sector === undefined) return undefined;
    const cached = this.#sectors.get(sector);
    if (cached) return cached;
    const bytes = await this.#read((sector + 1) * this.#bytes, this.#bytes);
    if (bytes.byteLength < this.#bytes) return undefined;
    this.#sectors.set(sector, view(bytes));
    return this.#sectors.get(sector);
  }

  /** The `index`th FAT sector, walking the DIFAT chain only as far as it. */
  async #listedAt(index: number): Promise<number | undefined> {
    while (this.#listed.length <= index && this.#nextDifat !== END_OF_CHAIN) {
      const difat = await this.#read((this.#nextDifat + 1) * this.#bytes, this.#bytes);
      if (difat.byteLength < this.#bytes) return undefined;
      const entries = this.#bytes / 4 - 1;
      for (let at = 0; at < entries; at++) this.#listed.push(view(difat).getUint32(at * 4, true));
      this.#nextDifat = view(difat).getUint32(entries * 4, true);
    }
    return this.#listed[index];
  }
}

async function layoutOf(read: ReadAt, size: number) {
  const bytes = await read(0, HEADER_BYTES);
  if (bytes.byteLength < HEADER_BYTES || !isCompoundFile(bytes)) return undefined;
  const header = view(bytes);
  const shift = header.getUint16(0x1e, true);
  if (header.getUint16(0x1c, true) !== 0xfffe || (shift !== 9 && shift !== 12)) return undefined;
  const sectorBytes = 2 ** shift;
  const fatSectors = header.getUint32(0x2c, true);
  if (fatSectors * sectorBytes > size) return undefined;
  if (header.getUint32(0x48, true) !== Fat.difatSectors(fatSectors, sectorBytes)) return undefined;
  return {
    bytes: sectorBytes,
    fat: new Fat(read, sectorBytes, header),
    firstDirectorySector: header.getUint32(0x30, true),
  };
}

function entryNames(sector: Uint8Array): string[] {
  const names: string[] = [];
  for (let at = 0; at + DIRECTORY_ENTRY_BYTES <= sector.byteLength; at += DIRECTORY_ENTRY_BYTES) {
    const entry = sector.subarray(at, at + DIRECTORY_ENTRY_BYTES);
    const length = view(entry).getUint16(0x40, true);
    if (entry[0x42] === 0 || length < 2 || length > 64) continue;
    const units = Array.from({ length: length / 2 - 1 }, (_, at) =>
      view(entry).getUint16(at * 2, true),
    );
    names.push(String.fromCharCode(...units));
  }
  return names;
}

/**
 * The names in a compound file's directory, or undefined when `read` holds no compound file this
 * reader can follow to the end of its directory.
 */
export async function compoundFileNames(
  read: ReadAt,
  size: number,
): Promise<readonly string[] | undefined> {
  const layout = await layoutOf(read, size);
  if (!layout) return undefined;
  const names: string[] = [];
  let sector: number | undefined = layout.firstDirectorySector;
  for (let hops = 0; sector !== END_OF_CHAIN; hops++) {
    if (sector === undefined || hops >= MAX_DIRECTORY_SECTORS) return undefined;
    const bytes = await read((sector + 1) * layout.bytes, layout.bytes);
    if (bytes.byteLength < layout.bytes) return undefined;
    names.push(...entryNames(bytes));
    sector = await layout.fat.next(sector);
  }
  return names;
}
