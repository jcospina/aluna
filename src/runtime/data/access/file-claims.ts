// The file rule of a save (Module 7 PLAN decisions 16, 17 and 22). A file field takes a pending key
// minted for this incarnation and this field, or nothing. An update may also carry what its record's
// field holds now, which keeps it, or the control's explicit clear. The router checks it before
// generated code runs and again inside the save's transaction, and the mutation interface checks it
// a third time as it writes, because a sweep or another save can commit between any two.

import type { Database } from "bun:sqlite";
import {
  type FileLedgerRow,
  isFileKey,
  promotePendingFile,
  readFileLedgerRow,
} from "../../../platform/files/ledger.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import {
  ALUNA_RESERVED_FIELD_PREFIX,
  type CapabilitySpec,
  isFileFieldType,
  type SpecField,
} from "../../../registry/index.ts";
import {
  type FileReferenceRefusal,
  InvalidFileReferenceError,
  RecordChangedError,
  RecordNotFoundError,
} from "../internal.ts";
import { deriveCapabilityTableDdl } from "../schema/ddl.ts";
import {
  type CapabilityFileProjection,
  fileKeyFromProjection,
  projectFileLedgerRow,
  projectStoredFileReference,
} from "../schema/file-values.ts";

/**
 * What the platform control sends to empty a file field on an edit. Nothing else clears one: an
 * empty value says the field holds nothing now, and a field left out is kept.
 */
export const FILE_CLEAR_VALUE = `${ALUNA_RESERVED_FIELD_PREFIX}clear`;

/** Where a save's references are checked: the ledger, the incarnation, and an update's record. */
export interface FileClaimScope {
  readonly database: Database;
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly record?: { readonly table: string; readonly id: string };
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

/**
 * What a save writes to one submitted file field: a pending row it claims, what the record's field
 * holds now (`null` when it holds nothing, as a create's field does), or the control's clear.
 */
export type SubmittedFile =
  | { readonly write: "claim"; readonly row: FileLedgerRow }
  | { readonly write: "keep"; readonly held: CapabilityFileProjection | null }
  | { readonly write: "clear" };

export type SubmittedFiles = ReadonlyMap<string, SubmittedFile>;

/** The key a field holding the projection `held` holds, or `null` when it holds nothing. */
export function heldFileKey(held: unknown): string | null {
  return held === null || held === undefined ? null : (fileKeyFromProjection(held) ?? null);
}

/** The key a submitted file field leaves in its column, or `null` for none. */
export function submittedFileKey(file: SubmittedFile): string | null {
  if (file.write === "claim") return file.row.key;
  return file.write === "keep" ? heldFileKey(file.held) : null;
}

/** What generated code is handed for a submitted file field: what the save will store. */
export function submittedFileProjection(file: SubmittedFile): CapabilityFileProjection | null {
  if (file.write === "claim") return projectFileLedgerRow(file.row);
  return file.write === "keep" ? file.held : null;
}

/**
 * Resolve every submitted file field to what the save writes, refusing the whole save, with every
 * offending field named, when any names something else. An update reads its record first, so a
 * record that is gone answers as not found before any key is judged.
 *
 * @param values the parsed wire values, where a file field is a key, `""` or {@link FILE_CLEAR_VALUE}
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
    const holding = held === undefined ? undefined : (held.get(field.name) ?? null);
    return [field.name, resolveSubmittedFile(field, values[field.name], holding, scope)] as const;
  });
  const changed = outcomes.filter(([, outcome]) => outcome === "changed").map(([name]) => name);
  if (changed.length > 0) throw new RecordChangedError(scope.capabilityId, changed);
  const refused = outcomes.filter(
    (entry): entry is readonly [string, FileReferenceRefusal] => typeof entry[1] === "string",
  );
  if (refused.length > 0) {
    throw new InvalidFileReferenceError(scope.capabilityId, Object.fromEntries(refused), action);
  }
  return new Map(
    outcomes.filter(
      (entry): entry is readonly [string, SubmittedFile] => typeof entry[1] !== "string",
    ),
  );
}

/** @param holding what an update's record holds in the field, or `undefined` on a create */
function resolveSubmittedFile(
  field: SpecField,
  value: unknown,
  holding: CapabilityFileProjection | null | undefined,
  scope: FileClaimScope,
): SubmittedFile | FileReferenceRefusal | "changed" {
  if (holding !== undefined && value === FILE_CLEAR_VALUE) return { write: "clear" };
  if (value === "") return holding ? "changed" : { write: "keep", held: null };
  if (!isFileKey(value)) return "malformed";
  if (holding && heldFileKey(holding) === value) return { write: "keep", held: holding };
  return resolveSubmittedKey(field, value, holding !== undefined, scope);
}

/** A key the record does not hold now: one it once held here, or a pending key to claim. */
function resolveSubmittedKey(
  field: SpecField,
  key: string,
  onRecord: boolean,
  scope: FileClaimScope,
): SubmittedFile | FileReferenceRefusal | "changed" {
  const row = readFileLedgerRow(scope.database, key);
  if (!row) return "unknown";
  if (onRecord && heldByThisRecord(row, field, scope)) return "changed";
  return claimRefusal(row, field, scope) ?? { write: "claim", row };
}

/** What each submitted file field of an update's record holds now, as generated code sees it. */
function readHeldFiles(
  fields: readonly SpecField[],
  scope: FileClaimScope,
): ReadonlyMap<string, CapabilityFileProjection | null> {
  const { record } = scope;
  if (!record) throw new Error("An update's file rule needs the record its files are kept on.");
  const columns = fields.map((field) => sqlIdentifier(field.name)).join(", ");
  const stored = scope.database
    .query(`SELECT ${columns} FROM ${sqlIdentifier(record.table)} WHERE "id" = ?`)
    .get(record.id) as Record<string, unknown> | null;
  if (!stored) throw new RecordNotFoundError(scope.capabilityId, "update");
  return new Map(
    fields.map((field) => {
      const value = stored[field.name];
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
