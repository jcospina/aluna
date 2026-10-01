// The file rule of a save (Module 7 PLAN decisions 16, 17 and 22). A file field takes a pending key
// minted for this incarnation and this field, or nothing. An update may also carry what its record's
// field holds now, which keeps it, or the control's explicit clear. A `file[]` takes an ordered list
// of such keys, none twice and no more than the configured count, and an edit names each file it
// removes, so a file another window added is never removed by a form that never saw it. The router checks it before
// generated code runs and again inside the save's transaction, and the mutation interface checks it
// a third time as it writes, because a sweep or another save can commit between any two.

import type { Database } from "bun:sqlite";
import { resolveMaxListFiles } from "../../../platform/files/file-cap.ts";
import {
  type FileLedgerRow,
  isFileKey,
  promotePendingFile,
  readFileLedgerRow,
} from "../../../platform/files/store/ledger.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import {
  ALUNA_RESERVED_FIELD_PREFIX,
  type CapabilitySpec,
  isFileFieldType,
  isFileListFieldType,
  type SpecField,
} from "../../../registry/index.ts";
import {
  type FileListCount,
  type FileReferenceRefusal,
  InvalidFileReferenceError,
  RecordChangedError,
  RecordNotFoundError,
  TooManyFilesError,
} from "../internal.ts";
import { deriveCapabilityTableDdl } from "../schema/ddl.ts";
import {
  type CapabilityFileProjection,
  fileKeyFromProjection,
  projectFileLedgerRow,
  projectStoredFileList,
  projectStoredFileReference,
} from "../schema/file-values.ts";

/**
 * What the platform control sends to empty a file field on an edit. Nothing else clears one: an
 * empty value says the field holds nothing now, and a field left out is kept.
 */
export const FILE_CLEAR_VALUE = `${ALUNA_RESERVED_FIELD_PREFIX}clear`;

/**
 * What the list control sends, before a key, for each file an edit removes from a `file[]`: a list
 * empties only file by file, and a file it holds that the edit neither keeps nor removes says the
 * record changed in another window.
 */
export const FILE_REMOVE_PREFIX = `${ALUNA_RESERVED_FIELD_PREFIX}remove:`;

/** Where a save's references are checked: the ledger, the incarnation, and an update's record. */
export interface FileClaimScope {
  readonly database: Database;
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly record?: { readonly table: string; readonly id: string };
  /** How many files a `file[]` may hold; the configured count unless the Gate names its own. */
  readonly maxListFiles?: number;
}

/** The scope of `spec`'s incarnation, naming the record an update or a delete acts on. */
export function fileClaimScope(
  database: Database,
  spec: CapabilitySpec,
  incarnationId: string,
  recordId?: string,
): FileClaimScope {
  return {
    database,
    capabilityId: spec.id,
    incarnationId,
    ...(recordId === undefined
      ? {}
      : { record: { table: deriveCapabilityTableDdl(spec).tableName, id: recordId } }),
  };
}

/** One entry of a submitted `file[]`: a pending row it claims, or a file the record holds now. */
export type SubmittedEntry =
  | { readonly write: "claim"; readonly row: FileLedgerRow }
  | { readonly write: "keep"; readonly held: CapabilityFileProjection };

/**
 * What a save writes to one submitted file field: a pending row it claims, what the record's field
 * holds now (`null` when it holds nothing, as a create's field does), or the control's clear. A
 * `file[]` writes its entries in order, and `removes` names the files an edit took out of it.
 */
export type SubmittedFile =
  | { readonly write: "claim"; readonly row: FileLedgerRow }
  | { readonly write: "keep"; readonly held: CapabilityFileProjection | null }
  | { readonly write: "clear" }
  | {
      readonly write: "list";
      readonly entries: readonly SubmittedEntry[];
      readonly removes: readonly string[];
    };

export type SubmittedFiles = ReadonlyMap<string, SubmittedFile>;

/** What a file field holds as generated code sees it: one file, none, or a list. */
export type HeldFiles = CapabilityFileProjection | readonly CapabilityFileProjection[] | null;

/** The keys a field holding `held` holds, in order: one or none for a `file`, each for a list. */
export function heldFileKeys(held: unknown): readonly string[] {
  if (held === null || held === undefined) return [];
  const projections = Array.isArray(held) ? held : [held];
  return projections.flatMap((projection) => fileKeyFromProjection(projection) ?? []);
}

/** The keys a submitted file field leaves in its column, in order. */
export function submittedFileKeys(file: SubmittedFile): readonly string[] {
  switch (file.write) {
    case "claim":
      return [file.row.key];
    case "keep":
      return heldFileKeys(file.held);
    case "clear":
      return [];
    case "list":
      return file.entries.map(entryKey);
  }
}

function entryKey(entry: SubmittedEntry): string {
  return entry.write === "claim" ? entry.row.key : (fileKeyFromProjection(entry.held) ?? "");
}

/** What generated code is handed for a submitted file field: what the save will store. */
export function submittedFileProjection(file: SubmittedFile): HeldFiles {
  switch (file.write) {
    case "claim":
      return projectFileLedgerRow(file.row);
    case "keep":
      return file.held;
    case "clear":
      return null;
    case "list":
      return Object.freeze(
        file.entries.map((entry) =>
          entry.write === "claim" ? projectFileLedgerRow(entry.row) : entry.held,
        ),
      );
  }
}

/** The submission that keeps what `file` wrote, so the same submission again changes nothing. */
export function keptAfterWrite(file: SubmittedFile): SubmittedFile {
  if (file.write !== "list") {
    return {
      write: "keep",
      held: submittedFileProjection(file) as CapabilityFileProjection | null,
    };
  }
  const held = submittedFileProjection(file) as readonly CapabilityFileProjection[];
  return {
    write: "list",
    entries: held.map((each) => ({ write: "keep", held: each })),
    removes: [],
  };
}

/**
 * Whether `file` disagrees with what its record holds now: a kept file another save replaced, a
 * field said to hold nothing that holds something, or a list that neither keeps nor removes a file
 * its record holds. A `file`'s replace or clear says nothing of it.
 */
export function keepsWhatChanged(file: SubmittedFile, held: readonly string[]): boolean {
  if (file.write === "keep") return (held[0] ?? null) !== (heldFileKeys(file.held)[0] ?? null);
  if (file.write !== "list") return false;
  const kept = file.entries.filter((entry) => entry.write === "keep").map(entryKey);
  return kept.some((key) => !held.includes(key)) || uncovered(held, kept, file.removes);
}

/** Whether a list leaves a file its record holds unnamed: neither kept nor removed. */
function uncovered(
  held: readonly string[],
  kept: readonly string[],
  removes: readonly string[],
): boolean {
  const named = new Set([...kept, ...removes]);
  return held.some((key) => !named.has(key));
}

/**
 * Resolve every submitted file field to what the save writes, refusing the whole save, with every
 * offending field named, when any names something else. An update reads its record first, so a
 * record that is gone answers as not found before any key is judged.
 *
 * @param values the parsed wire values, where a file field is a key, `""` or {@link FILE_CLEAR_VALUE},
 * and a `file[]` is its keys in order and a {@link FILE_REMOVE_PREFIX}ed key for each it removes
 */
export function resolveSubmittedFiles(
  fields: readonly SpecField[],
  values: Readonly<Record<string, unknown>>,
  action: "create" | "update",
  scope: FileClaimScope,
): SubmittedFiles {
  const submitted = fields.filter(
    (field) => isFileFieldType(field.type) && Object.hasOwn(values, field.name),
  );
  if (submitted.length === 0) return new Map();
  const held = action === "update" ? readHeldFiles(submitted, scope) : undefined;
  const outcomes = submitted.map((field) => {
    const holding = held?.get(field.name);
    const value = values[field.name];
    const outcome = isFileListFieldType(field.type)
      ? resolveSubmittedList(field, value, holding as ListHolding, scope)
      : resolveSubmittedFile(field, value, holding as FileHolding, scope);
    return [field.name, outcome] as const;
  });
  const changed = outcomes.filter(([, outcome]) => outcome === "changed").map(([name]) => name);
  if (changed.length > 0) throw new RecordChangedError(scope.capabilityId, changed);
  const over = outcomes.filter(
    (entry): entry is readonly [string, FileListCount] =>
      typeof entry[1] === "object" && "count" in entry[1],
  );
  if (over.length > 0) {
    throw new TooManyFilesError(scope.capabilityId, Object.fromEntries(over), action);
  }
  const refused = outcomes.filter(
    (entry): entry is readonly [string, FileReferenceRefusal] => typeof entry[1] === "string",
  );
  if (refused.length > 0) {
    throw new InvalidFileReferenceError(scope.capabilityId, Object.fromEntries(refused), action);
  }
  return new Map(
    outcomes.filter(
      (entry): entry is readonly [string, SubmittedFile] =>
        typeof entry[1] === "object" && "write" in entry[1],
    ),
  );
}

/** What an update's record holds in a `file`, `null` for nothing, or `undefined` on a create. */
type FileHolding = CapabilityFileProjection | null | undefined;
/** What an update's record holds in a `file[]`, or `undefined` on a create. */
type ListHolding = readonly CapabilityFileProjection[] | undefined;
type Resolved = SubmittedFile | FileReferenceRefusal | "changed";

/**
 * A `file[]`'s keys in order, and on an edit the ones it removes. Refused as the fields of one
 * save are, the record changing first: a file the record holds that the edit leaves unnamed, or a
 * key it once held, then a list growing past the count, then a removal naming no key, a key twice
 * or one it may not claim. A list a lowered count already passes may still be edited, so long as
 * it does not grow. Each key is read once, and a list no longer than its request body allows.
 */
function resolveSubmittedList(
  field: SpecField,
  value: unknown,
  holding: ListHolding,
  scope: FileClaimScope,
): Resolved | FileListCount {
  const split = splitRemovals(value, holding);
  if (!split) return "malformed";
  const { keys, removes, misread } = split;
  const held = heldFileKeys(holding);
  if (uncovered(held, keys, removes)) return "changed";
  const read = new Map(keys.map((key) => [key, resolveListEntry(field, key, holding, scope)]));
  if ([...read.values()].includes("changed")) return "changed";
  const cap = scope.maxListFiles ?? resolveMaxListFiles();
  if (keys.length > cap && keys.length > held.length) return { count: keys.length, cap };
  const posted = [...keys, ...removes];
  if (misread) return "malformed";
  if (new Set(posted).size !== posted.length) return "duplicate";
  const resolved = keys.map((key) => read.get(key));
  const refused = resolved.find(
    (entry): entry is FileReferenceRefusal => typeof entry === "string",
  );
  return refused ?? { write: "list", entries: resolved as SubmittedEntry[], removes };
}

/**
 * A `file[]`'s posted values as the keys it holds and the keys it removes, or `undefined` for a
 * value of another shape. `misread` says a removal names no key or comes on a create, which
 * removes nothing.
 */
function splitRemovals(
  value: unknown,
  holding: ListHolding,
): { keys: string[]; removes: string[]; misread: boolean } | undefined {
  if (!Array.isArray(value) || !value.every((key) => typeof key === "string")) return undefined;
  const removing = (key: string) => key.startsWith(FILE_REMOVE_PREFIX);
  const keys = value.filter((key) => !removing(key));
  const removes = value.filter(removing).map((key) => key.slice(FILE_REMOVE_PREFIX.length));
  const misread = removes.length > 0 && (holding === undefined || !removes.every(isFileKey));
  return { keys, removes, misread };
}

function resolveListEntry(
  field: SpecField,
  key: string,
  holding: ListHolding,
  scope: FileClaimScope,
): SubmittedEntry | FileReferenceRefusal | "changed" {
  if (!isFileKey(key)) return "malformed";
  const held = holding?.find((projection) => fileKeyFromProjection(projection) === key);
  if (held) return { write: "keep", held };
  const resolved = resolveSubmittedKey(field, key, holding !== undefined, scope);
  if (typeof resolved === "string") return resolved;
  return resolved.write === "claim" ? resolved : "malformed";
}

/** @param holding what an update's record holds in the field, or `undefined` on a create */
function resolveSubmittedFile(
  field: SpecField,
  value: unknown,
  holding: FileHolding,
  scope: FileClaimScope,
): Resolved {
  if (holding !== undefined && value === FILE_CLEAR_VALUE) return { write: "clear" };
  if (value === "") return holding ? "changed" : { write: "keep", held: null };
  if (!isFileKey(value)) return "malformed";
  if (holding && heldFileKeys(holding)[0] === value) return { write: "keep", held: holding };
  return resolveSubmittedKey(field, value, holding !== undefined, scope);
}

/** A key the record does not hold now: one it once held here, or a pending key to claim. */
function resolveSubmittedKey(
  field: SpecField,
  key: string,
  onRecord: boolean,
  scope: FileClaimScope,
): Resolved {
  const row = readFileLedgerRow(scope.database, key);
  if (!row) return "unknown";
  if (onRecord && heldByThisRecord(row, field, scope)) return "changed";
  return claimRefusal(row, field, scope) ?? { write: "claim", row };
}

/** What each submitted file field of an update's record holds now, as generated code sees it. */
function readHeldFiles(
  fields: readonly SpecField[],
  scope: FileClaimScope,
): ReadonlyMap<string, HeldFiles> {
  const { record } = scope;
  if (!record) throw new Error("An update's file rule needs the record its files are kept on.");
  const columns = fields.map((field) => sqlIdentifier(field.name)).join(", ");
  const stored = scope.database
    .query(`SELECT ${columns} FROM ${sqlIdentifier(record.table)} WHERE "id" = ?`)
    .get(record.id) as Record<string, unknown> | null;
  if (!stored) throw new RecordNotFoundError(scope.capabilityId, "update");
  return new Map(
    fields.map((field): [string, HeldFiles] => {
      const value = stored[field.name];
      if (isFileListFieldType(field.type)) {
        return [field.name, projectStoredFileList(field.name, value)];
      }
      return [field.name, value === null ? null : projectStoredFileReference(field.name, value)];
    }),
  );
}

/** A key this record's field once held and another save has since replaced or cleared. */
function heldByThisRecord(row: FileLedgerRow, field: SpecField, scope: FileClaimScope): boolean {
  return (
    row.capability_id === scope.capabilityId &&
    row.incarnation_id === scope.incarnationId &&
    row.field === field.name &&
    row.record_id === scope.record?.id
  );
}

/**
 * Promote `key` to `owned` by `recordId`, re-reading its row first, and hand back the row the
 * column is built from. Refuses as the router does when the row is no longer claimable.
 */
export function claimPendingFile(
  field: SpecField,
  key: string,
  recordId: string,
  action: "create" | "update",
  scope: FileClaimScope,
): FileLedgerRow {
  const row = readFileLedgerRow(scope.database, key);
  const refusal = row ? claimRefusal(row, field, scope) : "unknown";
  if (refusal !== undefined) {
    throw new InvalidFileReferenceError(scope.capabilityId, { [field.name]: refusal }, action);
  }
  // Read and promoted on one connection holding the write lock, so the row is still `pending`.
  if (!row || !promotePendingFile(scope.database, key, recordId)) {
    throw new Error(`File key for "${field.name}" left "pending" while its save held the lock.`);
  }
  return row;
}

function claimRefusal(
  row: FileLedgerRow,
  field: SpecField,
  scope: FileClaimScope,
): FileReferenceRefusal | undefined {
  if (row.capability_id !== scope.capabilityId || row.incarnation_id !== scope.incarnationId) {
    return "other_incarnation";
  }
  if (row.field !== field.name) return "other_field";
  // The field says which families it takes; the upload admits by the same list (7.1/07).
  if (!(field.accepts as readonly string[] | undefined)?.includes(row.kind)) return "not_accepted";
  if (row.state !== "pending") return row.state;
  return undefined;
}
