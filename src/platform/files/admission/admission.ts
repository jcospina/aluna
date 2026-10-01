// File admission (Module 7 PLAN decisions 1 to 4, ADR-0009). The table below is the allowlist. The
// extension names a family, and the bytes may then pick any row of it, so a PNG called `.jpg` is
// recorded as the PNG it is. Containers are checked and codecs are not. A HEIC or HEIF brand, TIFF,
// SVG and a Matroska that isn't WebM match no row. A document's extension alone picks its row,
// since a document downloads under its name. It imports only the byte tests, leaves, and a type.
//
// The image extensions admitted: jpg, jpeg, jfif, pjpeg, pjp, png, gif, webp and avif.
// The video extensions admitted: mp4, m4v, mov, webm, ogv and ogg.
// The audio extensions admitted: mp3, m4a, aac, wav, ogg, oga, opus, webm and flac.
// The document extensions admitted: pdf, doc, docx, md and txt.

import type { FileFamily } from "../../../registry/fields/file.ts";
import { adtsFrame, type FrameReader, FrameScan, mpegAudioFrame } from "./audio-frames.ts";
import {
  asciiAt,
  bytesAt,
  EBML_HEAD_BYTES,
  isoMovie,
  majorBrandIn,
  oggFamily,
  quickTimeFits,
  quickTimeMovie,
  webmDocument,
  webmFamily,
} from "./container-signatures.ts";
import { isCompoundFile, type ReadAt } from "./documents/compound-file.ts";
import { TextScan } from "./documents/text-scan.ts";
import { WORD_DOCUMENT_TYPE, wordPackageOf } from "./documents/word-package.ts";

/** The most of a body the bytes are read from before the rows must have decided. */
export const SIGNATURE_WINDOW_BYTES = 64 * 1024;

export type AdmissionRefusalReason =
  | "extension"
  | "not_accepted"
  | "declared_type"
  | "signature"
  | "locked";

/** A file the platform will not store, and which stage refused it. */
export class FileAdmissionRefusal extends Error {
  override readonly name = "FileAdmissionRefusal";

  constructor(readonly reason: AdmissionRefusalReason) {
    super(`File admission refused the upload at its ${reason}.`);
  }
}

/** What admission lets a file be recorded as: its family, the type its bytes proved, and a
 *  text's encoding. */
export interface AdmittedType {
  readonly kind: FileFamily;
  readonly mime: string;
  readonly encoding?: string;
}

interface RowClaims {
  readonly kind: FileFamily;
  readonly mime: string;
  readonly extensions: readonly string[];
  /** Declared types that name the container and no family, which the row takes as no claim. */
  readonly familyless?: readonly string[];
  /** The extensions its picker offers, when not every one it admits. */
  readonly offers?: readonly string[];
  /** A row only a file named with one of its extensions may match. */
  readonly byName?: true;
  /** A container read after the write, from its end: the refusal it earns, if any. */
  readonly afterWrite?: (read: ReadAt, size: number) => Promise<AdmissionRefusalReason | undefined>;
}

/** A row its container's leading bytes decide. */
interface HeadRow extends RowClaims {
  /** How many leading bytes {@link HeadRow.matches} reads. */
  readonly headBytes: number;
  readonly matches: (head: Uint8Array) => boolean;
  /** At the end of the body: whether what `matches` read fits the `total` bytes that arrived. */
  readonly fits?: (head: Uint8Array, total: number) => boolean;
  /** For a container that holds sound or picture alike, which one these bytes hold, if they say. */
  readonly holds?: (head: Uint8Array) => "video" | "audio" | undefined;
  /** A sound a tagger may put an ID3v2 tag in front of, and is then recognized behind it. */
  readonly behindTags?: true;
}

/** A row with no container: a run of frames, found past any ID3v2 tag by a {@link FrameScan}. */
interface FrameRow extends RowClaims {
  readonly frames: FrameReader;
}

/** A row with no signature, whose whole body must read as text. */
interface TextRow extends RowClaims {
  readonly text: true;
}

type SignatureRow = HeadRow | FrameRow | TextRow;

const isHeadRow = (row: SignatureRow): row is HeadRow => "headBytes" in row;
const isFrameRow = (row: SignatureRow): row is FrameRow => "frames" in row;
const isTextRow = (row: SignatureRow): row is TextRow => "text" in row;

const oggPage = (head: Uint8Array) => asciiAt(head, 0, "OggS");

const SIGNATURES: readonly SignatureRow[] = [
  {
    kind: "image",
    mime: "image/jpeg",
    extensions: ["jpg", "jpeg", "jfif", "pjpeg", "pjp"],
    headBytes: 3,
    matches: (head) => bytesAt(head, 0, [0xff, 0xd8, 0xff]),
  },
  {
    kind: "image",
    mime: "image/png",
    extensions: ["png"],
    headBytes: 8,
    matches: (head) => bytesAt(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    kind: "image",
    mime: "image/gif",
    extensions: ["gif"],
    headBytes: 6,
    matches: (head) => asciiAt(head, 0, "GIF87a") || asciiAt(head, 0, "GIF89a"),
  },
  {
    kind: "image",
    mime: "image/webp",
    extensions: ["webp"],
    headBytes: 12,
    matches: (head) => asciiAt(head, 0, "RIFF") && asciiAt(head, 8, "WEBP"),
  },
  {
    kind: "image",
    mime: "image/avif",
    extensions: ["avif"],
    headBytes: 12,
    matches: (head) => majorBrandIn(head, ["avif", "avis"]),
  },
  {
    kind: "video",
    mime: "video/mp4",
    extensions: ["mp4", "m4v"],
    headBytes: 12,
    matches: isoMovie,
  },
  {
    kind: "video",
    mime: "video/quicktime",
    extensions: ["mov"],
    headBytes: 16,
    matches: quickTimeMovie,
    fits: quickTimeFits,
  },
  {
    kind: "video",
    mime: "video/webm",
    extensions: ["webm"],
    headBytes: EBML_HEAD_BYTES,
    matches: webmDocument,
    holds: webmFamily,
  },
  {
    kind: "video",
    mime: "video/ogg",
    extensions: ["ogv", "ogg"],
    headBytes: 4,
    matches: oggPage,
    holds: oggFamily,
    familyless: ["application/ogg", "application/x-ogg"],
    // A browser declares any `.ogg` a sound, which names the audio family, so a video's picker
    // offers only `.ogv`. An `.ogg` sent with no claim is still admitted.
    offers: ["ogv"],
  },
  { kind: "audio", mime: "audio/mpeg", extensions: ["mp3"], frames: mpegAudioFrame },
  {
    kind: "audio",
    mime: "audio/mp4",
    extensions: ["m4a"],
    headBytes: 12,
    matches: isoMovie,
  },
  { kind: "audio", mime: "audio/aac", extensions: ["aac"], frames: adtsFrame },
  {
    kind: "audio",
    mime: "audio/wav",
    extensions: ["wav"],
    behindTags: true,
    headBytes: 12,
    matches: (head) => asciiAt(head, 0, "RIFF") && asciiAt(head, 8, "WAVE"),
  },
  {
    kind: "audio",
    mime: "audio/ogg",
    extensions: ["ogg", "oga", "opus"],
    behindTags: true,
    headBytes: 4,
    matches: oggPage,
    holds: oggFamily,
    familyless: ["application/ogg", "application/x-ogg"],
  },
  {
    kind: "audio",
    mime: "audio/webm",
    extensions: ["webm"],
    headBytes: EBML_HEAD_BYTES,
    matches: webmDocument,
    holds: webmFamily,
  },
  {
    kind: "audio",
    mime: "audio/flac",
    extensions: ["flac"],
    behindTags: true,
    headBytes: 4,
    matches: (head) => asciiAt(head, 0, "fLaC"),
  },
  {
    kind: "document",
    mime: "application/pdf",
    extensions: ["pdf"],
    byName: true,
    headBytes: 5,
    matches: (head) => asciiAt(head, 0, "%PDF-"),
  },
  {
    kind: "document",
    mime: "application/msword",
    extensions: ["doc"],
    byName: true,
    headBytes: 8,
    matches: isCompoundFile,
  },
  {
    kind: "document",
    mime: WORD_DOCUMENT_TYPE,
    extensions: ["docx"],
    byName: true,
    familyless: ["application/zip", "application/x-zip-compressed"],
    headBytes: 8,
    // A locked DOCX is an OLE2 file, which the read after the write names as locked.
    matches: (head) => asciiAt(head, 0, "PK\x03\x04") || isCompoundFile(head),
    afterWrite: wordAfterWrite,
  },
  {
    kind: "document",
    mime: "text/markdown",
    extensions: ["md"],
    byName: true,
    familyless: ["text/plain"],
    text: true,
  },
  { kind: "document", mime: "text/plain", extensions: ["txt"], byName: true, text: true },
];

async function wordAfterWrite(read: ReadAt, size: number) {
  const found = await wordPackageOf(read, size);
  if (found === "word") return undefined;
  return found === "locked" ? "locked" : "signature";
}

/** Every type admission records a file of `kind` as, in table order: what its picker offers. */
export function admittedTypes(kind: string): readonly string[] {
  return [...new Set(SIGNATURES.filter((row) => row.kind === kind).map((row) => row.mime))];
}

/**
 * What a picker for `families` offers: every type admission records them as, then every extension
 * it admits, since a system names some files by a type no row records, as it does an `.m4v`. A row
 * its name alone picks offers only its extensions: a picker widens a type to every extension the
 * system maps to it, such as `text/plain` to `.log`, and admission would refuse each of those.
 */
export function offeredTypes(families: readonly string[]): readonly string[] {
  const rows = SIGNATURES.filter((row) => families.includes(row.kind));
  const types = rows.filter((row) => !row.byName).map((row) => row.mime);
  const extensions = rows.flatMap((row) =>
    (row.offers ?? row.extensions).map((extension) => `.${extension}`),
  );
  return [...new Set([...types, ...extensions])];
}

/** The extension a file admission records as `mime` is usually named with: its row's first. */
export function usualExtension(mime: string): string | undefined {
  return SIGNATURES.find((row) => row.mime === mime)?.extensions[0];
}

/** Whether admission could have recorded a file of `kind` as `mime`. */
export function isAdmittedType(kind: string, mime: string): boolean {
  return SIGNATURES.some((row) => row.kind === kind && row.mime === mime);
}

function aliasesOf(type: string, aliases: readonly string[]): [string, string][] {
  return aliases.map((alias) => [alias, type]);
}

const TYPE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/pjpeg", "image/jpeg"],
  ["image/x-png", "image/png"],
  ["video/x-m4v", "video/mp4"],
  ["video/x-quicktime", "video/quicktime"],
  ...aliasesOf("audio/mpeg", ["audio/mp3", "audio/x-mp3", "audio/mpeg3", "audio/x-mpeg-3"]),
  ...aliasesOf("audio/mpeg", ["audio/x-mpeg", "audio/mpg"]),
  ...aliasesOf("audio/mp4", ["audio/x-m4a", "audio/m4a", "audio/mp4a-latm"]),
  ...aliasesOf("audio/aac", ["audio/x-aac", "audio/aac-adts", "audio/x-hx-aac-adts"]),
  ["audio/vnd.dlna.adts", "audio/aac"],
  ...aliasesOf("audio/ogg", [
    "audio/opus",
    "audio/vorbis",
    "audio/x-opus+ogg",
    "audio/x-vorbis+ogg",
  ]),
  ...aliasesOf("audio/wav", ["audio/x-wav", "audio/wave", "audio/vnd.wave"]),
  ["audio/x-flac", "audio/flac"],
  ...aliasesOf("application/pdf", ["application/x-pdf", "application/acrobat", "text/pdf"]),
  ["application/x-msword", "application/msword"],
  ["text/x-markdown", "text/markdown"],
]);

/** The extensions whose container holds sound or picture alike, and the family each usually is. */
const USUAL_FAMILY: ReadonlyMap<string, FileFamily> = new Map([
  ["webm", "video"],
  ["ogg", "audio"],
]);

/** What an operating system sends when it has no idea: no claim, so nothing to contradict. */
const NO_CLAIM = new Set(["", "application/octet-stream"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** A `Content-Type` value's essence, lowercase and without parameters, its alias resolved. */
function declaredType(header: string | undefined): string {
  const essence = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return TYPE_ALIASES.get(essence) ?? essence;
}

/**
 * A WebM or an Ogg holds sound or picture alike, and a browser names a picked file's type from its
 * extension alone. So a field that takes one of the two names the family, failing that the declared
 * type, and failing both the extension's usual family; the bytes then confirm it.
 */
function familyOf(
  extension: string,
  claimed: string,
  accepts: readonly FileFamily[],
): FileFamily | undefined {
  const usual = USUAL_FAMILY.get(extension);
  if (usual === undefined) return undefined;
  const media = accepts.filter((family) => family === "video" || family === "audio");
  if (media.length === 1) return media[0];
  const named = /^(video|audio)\//.exec(claimed)?.[1];
  return named === "video" || named === "audio" ? named : usual;
}

/**
 * The first two stages, before a byte is read: the name's extension must be on the allowlist and
 * in a family `accepts` names, and `declared` must be no claim or a type the extension's container
 * is recorded as. Answers the family the bytes are then checked against.
 */
export function admitClaims(
  name: string,
  declared: string | undefined,
  accepts: readonly FileFamily[],
): FileFamily {
  const extension = extensionOf(name);
  const rows = SIGNATURES.filter((candidate) => candidate.extensions.includes(extension));
  const [first] = rows;
  if (!first) throw new FileAdmissionRefusal("extension");
  const claimed = declaredType(declared);
  const kind = familyOf(extension, claimed, accepts) ?? first.kind;
  if (!rows.some((row) => row.kind === kind) || !accepts.includes(kind)) {
    throw new FileAdmissionRefusal("not_accepted");
  }
  const agrees = (row: SignatureRow) => row.mime === claimed || row.familyless?.includes(claimed);
  if (!NO_CLAIM.has(claimed) && !rows.some(agrees)) {
    throw new FileAdmissionRefusal("declared_type");
  }
  return kind;
}

/**
 * The families a file's bytes may record it as, for {@link SignatureCheck}: a WebM's or an Ogg's
 * may name either of sound and picture that `accepts` takes, and any other file's only `kind`.
 */
export function familiesTheBytesMayName(
  name: string,
  kind: FileFamily,
  accepts: readonly FileFamily[],
): readonly FileFamily[] {
  return USUAL_FAMILY.has(extensionOf(name)) ? accepts : [kind];
}

/** Whether a file named with `extension` may match `row`. */
function reachable(row: SignatureRow, extension: string): boolean {
  return !row.byName || row.extensions.includes(extension);
}

declare const WRITTEN: unique symbol;

/** A type admission settled with the file written: the only one a ledger row may record. */
export type WrittenAdmission = AdmittedType & { readonly [WRITTEN]: true };

/**
 * The last stage, for a row whose container is read after the write, from its end: a DOCX's. It
 * throws the refusal the written bytes earn.
 */
export async function admitWritten(
  admitted: AdmittedType,
  read: ReadAt,
  size: number,
): Promise<WrittenAdmission> {
  const row = SIGNATURES.find((candidate) => candidate.mime === admitted.mime);
  const refusal = await row?.afterWrite?.(read, size);
  if (refusal) throw new FileAdmissionRefusal(refusal);
  return admitted as WrittenAdmission;
}

/**
 * The third stage, fed each chunk as it arrives. It holds at most {@link SIGNATURE_WINDOW_BYTES}
 * of head and of the window after any ID3v2 tags, and throws the moment no row of `kind` can
 * match, so a mismatch aborts the upload there. A WebM or an Ogg whose bytes hold the other of
 * sound and picture is recorded as that family when `families` holds it, and refused when not.
 * A document's `name` picks its row, and a Markdown or text file is read to its end instead.
 */
export class SignatureCheck {
  readonly #heads: readonly HeadRow[];
  readonly #frames: readonly FrameRow[];
  readonly #families: readonly FileFamily[];
  readonly #scan: FrameScan | undefined;
  readonly #needed: number;
  #head: Uint8Array;
  #headFilled = 0;
  #total = 0;
  #headMissed = false;
  #scanMissed = false;
  #admitted: SignatureRow | undefined;
  readonly #text: { readonly row: TextRow; readonly scan: TextScan } | undefined;

  constructor(name: string, kind: FileFamily, families: readonly FileFamily[] = [kind]) {
    const extension = extensionOf(name);
    const rows = SIGNATURES.filter((row) => row.kind === kind && reachable(row, extension));
    const text = rows.find(isTextRow);
    this.#text = text && { row: text, scan: new TextScan() };
    this.#heads = rows.filter(isHeadRow);
    this.#frames = rows.filter(isFrameRow);
    this.#families = families;
    this.#scan =
      this.#frames.length === 0
        ? undefined
        : new FrameScan(
            this.#frames.map((row) => row.frames),
            SIGNATURE_WINDOW_BYTES,
          );
    // A WebM's family is read from its Tracks, past a muxer's reserved space: the whole window.
    const reads = this.#heads.map((row) => (row.holds ? SIGNATURE_WINDOW_BYTES : row.headBytes));
    this.#needed = Math.min(SIGNATURE_WINDOW_BYTES, Math.max(0, ...reads));
    this.#head = new Uint8Array(this.#needed);
  }

  inspect(chunk: Uint8Array): void {
    this.#total += chunk.byteLength;
    if (this.#text && !this.#text.scan.feed(chunk)) throw new FileAdmissionRefusal("signature");
    if (this.#admitted || this.#text) return;
    if (!this.#headMissed) {
      const taken = chunk.subarray(0, this.#needed - this.#headFilled);
      this.#head.set(taken, this.#headFilled);
      this.#headFilled += taken.byteLength;
      if (this.#headFilled >= this.#needed) this.#decideHead();
    }
    if (!this.#admitted && this.#scan && !this.#scanMissed) this.#scanned(this.#scan.feed(chunk));
    this.#refuseWhenSpent();
  }

  /** At the end of the body: the type the bytes proved, or the refusal a short body earns. */
  finish(): AdmittedType {
    if (this.#text) return this.#finishText(this.#text);
    if (!this.#admitted && !this.#headMissed) this.#decideHead();
    if (!this.#admitted && this.#scan && !this.#scanMissed) this.#scanned(this.#scan.finish());
    const row = this.#admitted;
    if (!row) throw new FileAdmissionRefusal("signature");
    if (isHeadRow(row) && row.fits && !row.fits(this.#head, this.#total)) {
      throw new FileAdmissionRefusal("signature");
    }
    return { kind: row.kind, mime: row.mime };
  }

  #finishText({ row, scan }: { row: TextRow; scan: TextScan }): AdmittedType {
    const encoding = scan.finish();
    if (!encoding) throw new FileAdmissionRefusal("signature");
    return { kind: row.kind, mime: row.mime, encoding };
  }

  #decideHead(): void {
    const head = this.#head.subarray(0, this.#headFilled);
    const row = this.#matchHead(head);
    if (row) this.#admitted = row;
    else this.#headMissed = true;
    // What `fits` reads at the end; a row without it, or no row, keeps nothing.
    this.#head = row?.fits ? head.slice(0, row.headBytes) : new Uint8Array(0);
  }

  /** The row `head` matches, as the family its bytes say they hold; throws for one not taken. */
  #matchHead(head: Uint8Array): HeadRow | undefined {
    const row = this.#heads.find(
      (candidate) => head.byteLength >= candidate.headBytes && candidate.matches(head),
    );
    const holds = row?.holds?.(head);
    if (!row || holds === undefined || holds === row.kind) return row;
    if (!this.#families.includes(holds)) throw new FileAdmissionRefusal("not_accepted");
    return SIGNATURES.find(
      (other): other is HeadRow =>
        other.kind === holds && isHeadRow(other) && other.matches === row.matches,
    );
  }

  #scanned(found: number | null | undefined): void {
    if (found === undefined) return;
    const tagged = found === null ? this.#scan?.afterTags() : undefined;
    const behindTags =
      tagged &&
      this.#heads.find(
        (row) => row.behindTags && tagged.byteLength >= row.headBytes && row.matches(tagged),
      );
    this.#admitted = found === null ? behindTags : this.#frames[found];
    if (!this.#admitted) this.#scanMissed = true;
  }

  #refuseWhenSpent(): void {
    if (this.#admitted || !this.#headMissed) return;
    if (!this.#scan || this.#scanMissed) throw new FileAdmissionRefusal("signature");
  }
}
