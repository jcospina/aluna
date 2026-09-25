import { randomUUID } from "node:crypto";
import { enqueueDisplacedFile, enqueueRecordFiles } from "../../../platform/files/ledger.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import {
  activeFileFields,
  activeSpecFields,
  type CapabilitySpec,
  capabilitySpecSchema,
  isFileFieldType,
  PLATFORM_COLUMNS,
  type SpecField,
} from "../../../registry/index.ts";
import {
  FileFieldWriteError,
  MissingRequiredFieldsError,
  RecordChangedError,
  RecordNotFoundError,
} from "../internal.ts";
import { deriveCapabilityTableDdl } from "../schema/ddl.ts";
import { fileKeyFromProjection, storedFileReference } from "../schema/file-values.ts";
import { ownValue } from "../schema/own-value.ts";
import {
  type CapabilityActionRecord,
  type CapabilityDataRow,
  CapabilityDataValidationError,
  createCapabilityActionRecord,
  isMissingRequiredValue,
  isPlainObject,
  normalizeSpecFieldValues,
  normalizeStoredRow,
  type SqlValue,
  type StoredCapabilityRow,
} from "../tool.ts";
import {
  claimPendingFile,
  type FileClaimScope,
  heldFileKey,
  type SubmittedFile,
  type SubmittedFiles,
  submittedFileKey,
  submittedFileProjection,
} from "./file-claims.ts";
import { assertReadOwnership } from "./read-ownership.ts";

export { RECORD_NOT_FOUND_ERROR_CODE, RecordNotFoundError } from "../internal.ts";

export type CapabilityCreateValues = Record<string, unknown>;
export type CapabilityUpdateValues = Record<string, unknown>;

export interface CapabilityMutationPort {
  create(values: CapabilityCreateValues): CapabilityActionRecord;
}

export interface CapabilityUpdateMutationPort {
  update(values: CapabilityUpdateValues): CapabilityActionRecord;
}

export interface CapabilityDeleteMutationPort {
  delete(): void;
}

const PLATFORM_POPULATED_COLUMNS = new Set<string>(PLATFORM_COLUMNS);

/** The active fields a save writes, and the same fields split into data and files. */
function savedFields(spec: CapabilitySpec) {
  const fields = activeSpecFields(spec.schema.fields);
  return {
    fields,
    dataFields: fields.filter((field) => !isFileFieldType(field.type)),
    fileFields: activeFileFields(fields),
  };
}

/**
 * The router-checked file submission a save writes, and the scope it was checked in, whose
 * database the save writes through (Module 7 PLAN decision 17).
 */
export interface FileSubmissionBinding {
  readonly scope: FileClaimScope;
  readonly submitted: SubmittedFiles;
}

export function createCapabilityMutationPort(
  spec: CapabilitySpec,
  files: FileSubmissionBinding,
  signal?: AbortSignal,
): CapabilityMutationPort {
  const parsed = capabilitySpecSchema.parse(spec);
  const { tableName } = deriveCapabilityTableDdl(parsed);
  const quotedTable = sqlIdentifier(tableName);
  const { fields, dataFields, fileFields } = savedFields(parsed);
  const allowedInsertFields = new Set(fields.map((field) => field.name));
  const { scope } = files;
  const { database } = scope;

  // A submission's file belongs to one record: a second create cannot claim it or quietly drop it.
  const written = new Set<string>();

  return {
    create(values) {
      assertReadOwnership(signal);
      const own = insertValues(parsed.id, allowedInsertFields, values);
      const keys = writtenFileKeys(fileFields, own, files.submitted, written);
      assertRequiredFilesHeld(parsed.id, fields, own, keys, "create");
      const normalized = normalizeSpecFieldValues(parsed.id, dataFields, own);
      const id = randomUUID();
      // A savepoint inside the save's transaction: a Handler that catches a failed insert and
      // answers anyway must not commit the key it promoted for a record that was never written.
      const insert = database.transaction((): StoredCapabilityRow => {
        for (const [field, key] of keys) {
          normalized[field.name] =
            key === null
              ? null
              : storedFileReference(claimPendingFile(field, key, id, "create", scope));
        }
        const columns = ["id", ...fields.map((field) => field.name)];
        const sqlValues: SqlValue[] = [
          id,
          ...fields.map((field) => normalized[field.name] ?? null),
        ];
        const placeholders = columns.map(() => "?").join(", ");
        const quotedColumns = columns.map(sqlIdentifier).join(", ");
        return database
          .query(
            `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders}) RETURNING *`,
          )
          .get(...sqlValues) as StoredCapabilityRow;
      });
      const stored = insert();
      for (const key of keys.values()) if (key !== null) written.add(key);
      return createCapabilityActionRecord(normalizeStoredRow(fields, stored));
    },
  };
}

/**
 * The key each file field writes: always the router-checked submission. A Handler may hand back the
 * projection it was given, or leave the field out; any other value is refused before any write.
 */
function writtenFileKeys(
  fileFields: readonly SpecField[],
  values: CapabilityCreateValues,
  submitted: SubmittedFiles,
  written: ReadonlySet<string>,
): ReadonlyMap<SpecField, string | null> {
  const keys = new Map<SpecField, string | null>();
  for (const field of fileFields) {
    const file = submitted.get(field.name);
    const submittedKey = file === undefined ? null : submittedFileKey(file);
    assertHandedBack(values, field, submittedKey);
    if (submittedKey !== null && written.has(submittedKey)) {
      throw new FileFieldWriteError(field.name);
    }
    keys.set(field, submittedKey);
  }
  return keys;
}

/** Refuse a Handler's value for a file field unless it is left out or names the submission. */
function assertHandedBack(
  values: Readonly<Record<string, unknown>>,
  field: SpecField,
  submittedKey: string | null,
): void {
  const given = ownValue(values, field.name);
  if (given === undefined) return;
  const named =
    given === null
      ? submittedKey === null
      : submittedKey !== null && fileKeyFromProjection(given) === submittedKey;
  if (!named) throw new FileFieldWriteError(field.name);
}

/**
 * Refuse a save that leaves a required file field empty, naming with it every required data field
 * the same save leaves empty, in schema order, as the refusal of a data field alone names them.
 */
function assertRequiredFilesHeld(
  capabilityId: string,
  fields: readonly SpecField[],
  values: Readonly<Record<string, unknown>>,
  fileKeys: ReadonlyMap<SpecField, string | null>,
  action: "create" | "update",
): void {
  const empty = new Set(
    [...fileKeys].filter(([field, key]) => field.required && key === null).map(([field]) => field),
  );
  if (empty.size === 0) return;
  const missing = fields.filter((field) =>
    isFileFieldType(field.type)
      ? empty.has(field)
      : field.required && isMissingRequiredValue(field, ownValue(values, field.name)),
  );
  throw new MissingRequiredFieldsError(
    capabilityId,
    missing.map((field) => field.name),
    action,
  );
}

/** The key each active file field holds once an update is written: its submission's, or the record's. */
function resultingFileKeys(
  fileFields: readonly SpecField[],
  current: CapabilityDataRow,
  fileWrites: FileWrites,
): ReadonlyMap<SpecField, string | null> {
  const submitted = new Map(fileWrites);
  return new Map(
    fileFields.map((field) => {
      const file = submitted.get(field);
      return [field, file === undefined ? heldKey(current, field) : submittedFileKey(file)];
    }),
  );
}

export function createCapabilityUpdateMutationPort(
  spec: CapabilitySpec,
  recordTarget: string,
  submittedFields: ReadonlySet<string>,
  files: FileSubmissionBinding,
  signal?: AbortSignal,
): CapabilityUpdateMutationPort {
  const parsed = capabilitySpecSchema.parse(spec);
  const input: BoundUpdateAuthority = {
    capabilityId: parsed.id,
    quotedTable: sqlIdentifier(deriveCapabilityTableDdl(parsed).tableName),
    target: validateBoundRecordTarget(recordTarget),
    ...savedFields(parsed),
    fieldsByName: new Map(parsed.schema.fields.map((field) => [field.name, field])),
    submittedFields: new Set(submittedFields),
    files: new Map(files.submitted),
    scope: files.scope,
  };
  validateBoundSubmittedFields(input);
  // How many updates are running: one a Handler starts from inside another commits only with it.
  let depth = 0;

  return {
    update(values) {
      assertReadOwnership(signal);
      if (!isPlainObject(values)) {
        throw new CapabilityDataValidationError(
          `Capability "${parsed.id}" update values must be an object.`,
        );
      }
      const own = { ...values };
      validateUpdateKeys(parsed.id, input.fieldsByName, input.submittedFields, own);
      const fileWrites = submittedFileWrites(input, own);
      // A savepoint inside the save's transaction, as a create's is: a Handler that catches a failed
      // write and answers anyway must not commit a promoted or given-up key without its record.
      depth += 1;
      let updated: CapabilityDataRow;
      try {
        updated = input.scope.database.transaction(() =>
          updateBoundTarget(input, own, fileWrites),
        )();
      } finally {
        depth -= 1;
      }
      // Written once: the same submission again keeps what this call wrote.
      for (const [field, file] of depth === 0 ? fileWrites : []) {
        input.files.set(field.name, { write: "keep", held: submittedFileProjection(file) });
      }
      return createCapabilityActionRecord(updated);
    },
  };
}

export function createCapabilityDeleteMutationPort(
  spec: CapabilitySpec,
  recordTarget: string,
  scope: FileClaimScope,
  signal?: AbortSignal,
): CapabilityDeleteMutationPort {
  const parsed = capabilitySpecSchema.parse(spec);
  const target = validateBoundRecordTarget(recordTarget);
  const quotedTable = sqlIdentifier(deriveCapabilityTableDdl(parsed).tableName);
  const { database } = scope;

  return {
    delete() {
      assertReadOwnership(signal);
      // The record's files, hidden fields' included, are given up in the same savepoint as the row.
      database.transaction(() => {
        const deleted = database
          .query(`DELETE FROM ${quotedTable} WHERE "id" = ? RETURNING "id"`)
          .get(target);
        if (!deleted) throw new RecordNotFoundError(parsed.id, "delete");
        enqueueRecordFiles(database, scope, target);
      })();
    },
  };
}

interface BoundUpdateAuthority {
  readonly capabilityId: string;
  readonly quotedTable: string;
  readonly target: string;
  readonly fields: readonly SpecField[];
  readonly dataFields: readonly SpecField[];
  readonly fileFields: readonly SpecField[];
  readonly fieldsByName: ReadonlyMap<string, SpecField>;
  readonly submittedFields: ReadonlySet<string>;
  readonly files: Map<string, SubmittedFile>;
  readonly scope: FileClaimScope;
}

type FileWrites = readonly (readonly [SpecField, SubmittedFile])[];

function updateBoundTarget(
  authority: BoundUpdateAuthority,
  values: CapabilityUpdateValues,
  fileWrites: FileWrites,
): CapabilityDataRow {
  const stored = authority.scope.database
    .query(`SELECT * FROM ${authority.quotedTable} WHERE "id" = ?`)
    .get(authority.target) as StoredCapabilityRow | null;
  if (!stored) throw new RecordNotFoundError(authority.capabilityId, "update");

  const current = normalizeStoredRow(authority.fields, stored);
  const { dataFields } = authority;
  const merged: Record<string, unknown> = Object.fromEntries(
    dataFields.map((field) => [field.name, current[field.name]]),
  );
  for (const field of dataFields) {
    if (!authority.submittedFields.has(field.name)) continue;
    merged[field.name] = submittedUpdateValue(field, values);
  }
  assertRequiredFilesHeld(
    authority.capabilityId,
    authority.fields,
    merged,
    resultingFileKeys(authority.fileFields, current, fileWrites),
    "update",
  );

  // `current` is what the row already holds, the one thing that makes a disabled choice value
  // admissible: a record standing on an option before it was retired keeps it through an edit.
  const normalized = normalizeSpecFieldValues(
    authority.capabilityId,
    dataFields,
    merged,
    "update",
    current,
  );
  const columns: Record<string, SqlValue> = {
    ...Object.fromEntries(
      dataFields
        .filter((field) => authority.submittedFields.has(field.name))
        .map((field) => [field.name, normalized[field.name] ?? null]),
    ),
    ...writeSubmittedFiles(authority, current, fileWrites),
  };
  if (Object.keys(columns).length === 0) return current;
  return persistBoundUpdate(authority, columns);
}

/**
 * Each submitted file field's submission, checked against what a Handler handed back: the
 * projection it was given, `null` where it was given `null`, or nothing. Refused before any write.
 */
function submittedFileWrites(
  authority: BoundUpdateAuthority,
  values: CapabilityUpdateValues,
): FileWrites {
  return authority.fileFields.flatMap((field) => {
    const file = authority.submittedFields.has(field.name) && authority.files.get(field.name);
    if (!file) return [];
    assertHandedBack(values, field, submittedFileKey(file));
    return [[field, file] as const];
  });
}

/**
 * Write each submitted file the record does not already hold, and give up the key it displaces, in
 * the update's savepoint (Module 7 PLAN decision 19). A kept key the record no longer holds is
 * refused first, so the file another window saved stays where it is.
 */
function writeSubmittedFiles(
  authority: BoundUpdateAuthority,
  current: CapabilityDataRow,
  fileWrites: FileWrites,
): Record<string, SqlValue> {
  const changed = fileWrites
    .filter(
      ([field, file]) =>
        file.write === "keep" && heldKey(current, field) !== submittedFileKey(file),
    )
    .map(([field]) => field.name);
  if (changed.length > 0) throw new RecordChangedError(authority.capabilityId, changed);

  const columns: Record<string, SqlValue> = {};
  for (const [field, file] of fileWrites) {
    if (file.write === "keep") continue;
    columns[field.name] =
      file.write === "claim"
        ? storedFileReference(
            claimPendingFile(field, file.row.key, authority.target, "update", authority.scope),
          )
        : null;
    const displaced = heldKey(current, field);
    const owner = { ...authority.scope, field: field.name, recordId: authority.target };
    if (displaced !== null && !enqueueDisplacedFile(authority.scope.database, owner, displaced)) {
      throw new Error(`The file "${field.name}" held is not owned by its record in the ledger.`);
    }
  }
  return columns;
}

function heldKey(current: CapabilityDataRow, field: SpecField): string | null {
  return heldFileKey(ownValue(current, field.name));
}

function persistBoundUpdate(
  authority: BoundUpdateAuthority,
  columns: Readonly<Record<string, SqlValue>>,
): CapabilityDataRow {
  const written = authority.fields.filter((field) => Object.hasOwn(columns, field.name));
  const assignments = written.map((field) => `${sqlIdentifier(field.name)} = ?`).join(", ");
  const sqlValues = written.map((field) => columns[field.name] ?? null);
  const updated = authority.scope.database
    .query(`UPDATE ${authority.quotedTable} SET ${assignments} WHERE "id" = ? RETURNING *`)
    .get(...sqlValues, authority.target) as StoredCapabilityRow | null;
  if (!updated) throw new RecordNotFoundError(authority.capabilityId, "update");
  return normalizeStoredRow(authority.fields, updated);
}

/** A create's values as the Handler gave them, refused before any field is judged if malformed. */
function insertValues(
  capabilityId: string,
  allowedInsertFields: ReadonlySet<string>,
  values: CapabilityCreateValues,
): CapabilityCreateValues {
  if (!isPlainObject(values)) {
    throw new CapabilityDataValidationError(
      `Capability "${capabilityId}" insert values must be an object.`,
    );
  }
  validateInsertKeys(capabilityId, allowedInsertFields, values);
  return { ...values };
}

function validateInsertKeys(
  capabilityId: string,
  allowedInsertFields: ReadonlySet<string>,
  values: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.keys(values)) {
    if (PLATFORM_POPULATED_COLUMNS.has(key)) {
      throw new CapabilityDataValidationError(
        `Column "${key}" is platform-populated and cannot be inserted by a handler.`,
      );
    }
    if (!allowedInsertFields.has(key)) {
      const fieldList = [...allowedInsertFields].sort().join(", ");
      throw new CapabilityDataValidationError(
        `Unknown field "${key}" for capability "${capabilityId}". Insert accepts only: ${fieldList}.`,
      );
    }
  }
}

function validateBoundRecordTarget(recordTarget: string): string {
  if (typeof recordTarget !== "string" || recordTarget.trim().length === 0) {
    throw new CapabilityDataValidationError(
      "A target-bound mutation requires a nonblank record id.",
    );
  }
  return recordTarget;
}

function validateBoundSubmittedFields(authority: BoundUpdateAuthority): void {
  for (const name of authority.submittedFields) {
    const field = authority.fieldsByName.get(name);
    if (field?.lifecycle !== "active") {
      throw new CapabilityDataValidationError(
        `Submitted field "${name}" is not active for capability "${authority.capabilityId}".`,
      );
    }
    // A submitted file field writes only what the router checked, so one it never checked may not.
    if (isFileFieldType(field.type) && !authority.files.has(name)) {
      throw new FileFieldWriteError(name);
    }
  }
}

function validateUpdateKeys(
  capabilityId: string,
  fieldsByName: ReadonlyMap<string, SpecField>,
  submittedFields: ReadonlySet<string>,
  values: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.keys(values)) {
    if (PLATFORM_POPULATED_COLUMNS.has(key)) {
      throw new CapabilityDataValidationError(
        `Column "${key}" is platform-populated and cannot be updated by a handler.`,
      );
    }
    const field = fieldsByName.get(key);
    if (!field) {
      throw new CapabilityDataValidationError(
        `Unknown field "${key}" for capability "${capabilityId}".`,
      );
    }
    if (field.lifecycle !== "active") {
      throw new CapabilityDataValidationError(
        `Inactive field "${key}" cannot be updated for capability "${capabilityId}".`,
      );
    }
    if (!submittedFields.has(key)) {
      throw new CapabilityDataValidationError(
        `Field "${key}" was not submitted and cannot be updated for capability "${capabilityId}".`,
      );
    }
  }
}

function submittedUpdateValue(field: SpecField, values: CapabilityUpdateValues): unknown {
  if (!Object.hasOwn(values, field.name) || values[field.name] === undefined) {
    if (field.type === "boolean") return false;
    if (field.type === "string[]") return [];
    return null;
  }

  const value = values[field.name];
  if (value === "" && !field.required && field.type !== "string[]") return null;
  return value;
}
