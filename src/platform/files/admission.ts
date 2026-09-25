// File admission for the image rows (Module 7 PLAN decisions 1 to 4, ADR-0009). The table below is
// the allowlist. The extension names a family, and the bytes may then pick any row of it, so a PNG
// called `.jpg` is recorded as the PNG it is. A HEIC or HEIF major brand, TIFF and SVG match no
// row. 7.2 adds the other families' rows. A leaf.

/** The most of a body the bytes are read from before the rows must have decided. */
export const SIGNATURE_WINDOW_BYTES = 64 * 1024;

export type AdmissionRefusalReason = "extension" | "not_accepted" | "declared_type" | "signature";

/** A file the platform will not store, and which stage refused it. */
export class FileAdmissionRefusal extends Error {
  override readonly name = "FileAdmissionRefusal";

  constructor(readonly reason: AdmissionRefusalReason) {
    super(`File admission refused the upload at its ${reason}.`);
  }
}

/** What admission lets a file be recorded as: its family and the type its bytes proved. */
export interface AdmittedType {
  readonly kind: string;
  readonly mime: string;
}

interface SignatureRow {
  readonly kind: string;
  readonly mime: string;
  readonly extensions: readonly string[];
  /** How many leading bytes {@link SignatureRow.matches} reads. */
  readonly headBytes: number;
  readonly matches: (head: Uint8Array) => boolean;
}

function bytesAt(head: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => head[offset + index] === byte);
}

function asciiAt(head: Uint8Array, offset: number, text: string): boolean {
  return bytesAt(
    head,
    offset,
    [...text].map((char) => char.charCodeAt(0)),
  );
}

/** An ISO-BMFF `ftyp` box whose major brand is one of `brands`; HEIC's and HEIF's are not here. */
function majorBrandIn(head: Uint8Array, brands: readonly string[]): boolean {
  return asciiAt(head, 4, "ftyp") && brands.some((brand) => asciiAt(head, 8, brand));
}

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
];

/** Every extension admission takes, lowercase and without the dot, in table order. */
export const ADMITTED_EXTENSIONS: readonly string[] = SIGNATURES.flatMap((row) => row.extensions);

/** Every type admission records a file of `kind` as, in table order: what its picker offers. */
export function admittedTypes(kind: string): readonly string[] {
  return [...new Set(SIGNATURES.filter((row) => row.kind === kind).map((row) => row.mime))];
}

/** Whether admission could have recorded a file of `kind` as `mime`. */
export function isAdmittedType(kind: string, mime: string): boolean {
  return SIGNATURES.some((row) => row.kind === kind && row.mime === mime);
}

const TYPE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/pjpeg", "image/jpeg"],
  ["image/x-png", "image/png"],
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
 * The first two stages, before a byte is read: the name's extension must be on the allowlist and
 * in a family `accepts` names, and `declared` must be no claim or the extension's own type.
 * Answers the family the bytes are then checked against.
 */
export function admitClaims(
  name: string,
  declared: string | undefined,
  accepts: readonly string[],
): string {
  const extension = extensionOf(name);
  const row = SIGNATURES.find((candidate) => candidate.extensions.includes(extension));
  if (!row) throw new FileAdmissionRefusal("extension");
  if (!accepts.includes(row.kind)) throw new FileAdmissionRefusal("not_accepted");
  const claimed = declaredType(declared);
  if (!NO_CLAIM.has(claimed) && claimed !== row.mime) {
    throw new FileAdmissionRefusal("declared_type");
  }
  return row.kind;
}

/**
 * The third stage, fed each chunk as it arrives. It holds only the head its rows read, never more
 * than {@link SIGNATURE_WINDOW_BYTES}, decides as soon as that head is in, and throws the moment no
 * row of `kind` matches, so a mismatch aborts the upload there instead of after the whole body.
 */
export class SignatureCheck {
  readonly #rows: readonly SignatureRow[];
  readonly #needed: number;
  #head = new Uint8Array(0);
  #admitted: SignatureRow | undefined;

  constructor(kind: string) {
    this.#rows = SIGNATURES.filter((row) => row.kind === kind);
    this.#needed = Math.min(
      SIGNATURE_WINDOW_BYTES,
      Math.max(0, ...this.#rows.map((row) => row.headBytes)),
    );
  }

  inspect(chunk: Uint8Array): void {
    if (this.#admitted) return;
    const room = this.#needed - this.#head.byteLength;
    const head = new Uint8Array(this.#head.byteLength + Math.min(room, chunk.byteLength));
    head.set(this.#head);
    head.set(chunk.subarray(0, room), this.#head.byteLength);
    this.#head = head;
    if (head.byteLength >= this.#needed) this.#decide();
  }

  /** At the end of the body: the type the bytes proved, or the refusal a short body earns. */
  finish(): AdmittedType {
    const row = this.#admitted ?? this.#decide();
    return { kind: row.kind, mime: row.mime };
  }

  #decide(): SignatureRow {
    const head = this.#head;
    const row = this.#rows.find(
      (candidate) => head.byteLength >= candidate.headBytes && candidate.matches(head),
    );
    if (!row) throw new FileAdmissionRefusal("signature");
    this.#admitted = row;
    this.#head = new Uint8Array(0);
    return row;
  }
}
