// The file rule of a save (Module 7 PLAN decisions 16, 17 and 22). A file field takes a pending key
// minted for this incarnation and this field, or nothing. The router checks it before generated
// code runs and again inside the save's transaction, and the mutation interface checks it a third
// time as it promotes the key, because a sweep or another save can commit between any two.

import type { Database } from "bun:sqlite";
import {
  type FileLedgerRow,
  isFileKey,
  promotePendingFile,
  readFileLedgerRow,
} from "../../../platform/files/ledger.ts";
import { isFileFieldType, type SpecField } from "../../../registry/index.ts";
import { type FileReferenceRefusal, InvalidFileReferenceError } from "../internal.ts";

/** Where a save's references are checked: the ledger, and the incarnation claiming them. */
export interface FileClaimScope {
  readonly database: Database;
  readonly capabilityId: string;
  readonly incarnationId: string;
}

/** Each submitted file field's pending row, or `null` for one submitted empty. */
export type SubmittedFiles = ReadonlyMap<string, FileLedgerRow | null>;

/**
 * Resolve every submitted file field to the pending row its key names, refusing the whole save,
 * with every offending field named, when any names something else.
 *
 * @param values the parsed wire values, where a file field is its key or `""`
 */
export function resolveSubmittedFiles(
  fields: readonly SpecField[],
  values: Readonly<Record<string, unknown>>,
  action: "create" | "update",
  scope: FileClaimScope,
): SubmittedFiles {
  const resolved = new Map<string, FileLedgerRow | null>();
  const refused: Record<string, FileReferenceRefusal> = {};
  for (const field of fields) {
    if (!isFileFieldType(field.type) || !Object.hasOwn(values, field.name)) continue;
    const outcome = resolveSubmittedFile(field, values[field.name], scope);
    if (typeof outcome === "string") refused[field.name] = outcome;
    else resolved.set(field.name, outcome);
  }
  if (Object.keys(refused).length > 0) {
    throw new InvalidFileReferenceError(scope.capabilityId, refused, action);
  }
  return resolved;
}

function resolveSubmittedFile(
  field: SpecField,
  value: unknown,
  scope: FileClaimScope,
): FileLedgerRow | null | FileReferenceRefusal {
  if (value === "") return null;
  if (!isFileKey(value)) return "malformed";
  const row = readFileLedgerRow(scope.database, value);
  if (!row) return "unknown";
  return claimRefusal(row, field, scope) ?? row;
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
