// What a file column stores and what generated code sees of it (Module 7 PLAN decisions 17 and 20).
//
// The column holds `{key, kind, mime, size, name}`, built from the ledger row at the save. Every
// record generated code is handed carries the projection `{url, name, kind, mime, size}` instead,
// and the mutation interface reads the key back out of that `url`, so a Handler passes a file on by
// handing back what it was given.

import { FILE_URL_PREFIX, fileUrl } from "../../../platform/files/file-url.ts";
import { isFileKey, type PendingFile } from "../../../platform/files/store/ledger.ts";
import { FILE_FAMILIES, type FileFamily } from "../../../registry/fields/file.ts";

export { FILE_URL_PREFIX } from "../../../platform/files/file-url.ts";

export interface CapabilityFileProjection {
  readonly url: string;
  readonly name: string;
  readonly kind: FileFamily;
  readonly mime: string;
  readonly size: number;
}

const STORED_KEYS = ["key", "kind", "mime", "size", "name"] as const;
const PROJECTION_KEYS = ["url", "name", "kind", "mime", "size"] as const;

/** The column value a ledger row stands for. Nothing the browser posted reaches it. */
export function storedFileReference(row: PendingFile): string {
  return JSON.stringify(storedFile(row));
}

/** A `file[]` column's value for `files`, in their order, each built as a `file` column's is. */
export function storedFileList(files: readonly StoredFile[]): string {
  return JSON.stringify(files.map(storedFile));
}

type StoredFile = Pick<PendingFile, (typeof STORED_KEYS)[number]>;

function storedFile(row: StoredFile): StoredFile {
  return { key: row.key, kind: row.kind, mime: row.mime, size: row.size, name: row.name };
}

/** What a projection the platform made says about its file, as its column stored it. */
export function storedFromProjection(
  projection: CapabilityFileProjection,
): StoredFileReference | undefined {
  const key = fileKeyFromProjection(projection);
  if (key === undefined) return undefined;
  const { kind, mime, size, name } = projection;
  return { key, kind, mime, size, name };
}

/** What a save of `row` will store, as generated code sees it: the router's input to a Handler. */
export function projectFileLedgerRow(row: PendingFile): CapabilityFileProjection {
  return projectStoredFileReference(row.field, storedFileReference(row));
}

/**
 * A stored reference as generated code sees it. Only the save writes the column, so a value of any
 * other shape is corruption and fails closed, as a malformed `string[]` column does.
 */
export function projectStoredFileReference(
  column: string,
  value: unknown,
): CapabilityFileProjection {
  const stored = parseStoredReference(value);
  if (!stored) throw new Error(`Expected file column "${column}" to hold a stored file reference.`);
  return Object.freeze({
    url: fileUrl(stored.key),
    name: stored.name,
    kind: stored.kind,
    mime: stored.mime,
    size: stored.size,
  });
}

/**
 * A stored `file[]` as generated code sees it, in order. `NULL`, which older rows hold when an
 * evolution adds the column, is `[]`. Any other shape, or a key twice, is corruption.
 */
export function projectStoredFileList(
  column: string,
  value: unknown,
): readonly CapabilityFileProjection[] {
  if (value === null) return Object.freeze([]);
  const parsed = typeof value === "string" ? parseJson(value) : undefined;
  const files = Array.isArray(parsed) ? parsed.map(parseStoredObject) : undefined;
  const whole = files?.every((file) => file !== undefined);
  const keys = new Set(files?.map((file) => file?.key));
  if (!files || !whole || keys.size !== files.length) {
    throw new Error(`Expected file column "${column}" to hold a list of stored file references.`);
  }
  return Object.freeze(
    files.map((file) => projectStoredFileReference(column, JSON.stringify(file))),
  );
}

/**
 * A stored reference, or a stored `file[]` of them, with every key dropped, as a question's model
 * may read it (decision 37), or `undefined` for a value that is neither.
 */
export function keylessStoredFileReference(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = parseJson(value);
  const listed = Array.isArray(parsed);
  const files = (listed ? parsed : [parsed]).map(parseStoredObject);
  if (files.length === 0 || files.some((file) => file === undefined)) return undefined;
  const keyless = files.map((file) => {
    const { kind, mime, size, name } = file as StoredFileReference;
    return { kind, mime, size, name };
  });
  return JSON.stringify(listed ? keyless : keyless[0]);
}

/**
 * The key a projection handed back names, or `undefined` for anything that is not a projection.
 * Only `url` is read: a copied or edited projection still names its file, and saves the ledger's.
 */
export function fileKeyFromProjection(value: unknown): string | undefined {
  if (!hasExactKeys(value, PROJECTION_KEYS)) return undefined;
  const { url } = value;
  if (typeof url !== "string" || !url.startsWith(FILE_URL_PREFIX)) return undefined;
  const key = url.slice(FILE_URL_PREFIX.length);
  return isFileKey(key) ? key : undefined;
}

export interface StoredFileReference {
  readonly key: string;
  readonly kind: FileFamily;
  readonly mime: string;
  readonly size: number;
  readonly name: string;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseStoredReference(value: unknown): StoredFileReference | undefined {
  return typeof value === "string" ? parseStoredObject(parseJson(value)) : undefined;
}

function parseStoredObject(parsed: unknown): StoredFileReference | undefined {
  if (!hasExactKeys(parsed, STORED_KEYS)) return undefined;
  const { key, kind, mime, size, name } = parsed;
  const valid =
    isFileKey(key) &&
    (FILE_FAMILIES as readonly unknown[]).includes(kind) &&
    typeof mime === "string" &&
    mime.length > 0 &&
    Number.isSafeInteger(size) &&
    (size as number) >= 0 &&
    typeof name === "string";
  return valid ? (parsed as unknown as StoredFileReference) : undefined;
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
