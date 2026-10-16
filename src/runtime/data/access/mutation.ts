import { randomUUID } from "node:crypto";
import { enqueueDisplacedFile, enqueueRecordFiles } from "../../../platform/files/store/ledger.ts";
import { sqlIdentifier } from "../../../platform/persistence/sql-identifier.ts";
import {
  activeFileFields,
  activeSpecFields,
  type CapabilitySpec,
  capabilitySpecSchema,
  isFileFieldType,
  isFileListFieldType,
  type SpecField,
} from "../../../registry/index.ts";
import {
  FileFieldWriteError,
  MissingRequiredFieldsError,
  RecordChangedError,
  RecordNotFoundError,
} from "../internal.ts";
import { pickedTexts, refreshLinkedText } from "../links/linked-text.ts";
import {
  type LinkBinding,
  linkCreatedRecord,
  NO_LINKS,
  PickWriteError,
  relinkUpdatedRecord,
  unlinkDeletedRecord,
} from "../links/picks.ts";
import { deriveCapabilityTableDdl } from "../schema/ddl.ts";
import {
  fileKeyFromProjection,
  storedFileList,
  storedFileReference,
  storedFromProjection,
} from "../schema/file-values.ts";
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
  heldFileKeys,
  keepsWhatChanged,
  keptAfterWrite,
  type SubmittedFile,
  type SubmittedFiles,
  submittedFileKeys,
} from "./file-claims.ts";
import { assertReadOwnership } from "./read-ownership.ts";
import {
  insertValues,
  submittedUpdateValue,
  validateBoundRecordTarget,
  validateUpdateKeys,
} from "./values/handed-values.ts";

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
 * database the save writes through.
 */
export interface FileSubmissionBinding {
  readonly scope: FileClaimScope;
  readonly submitted: SubmittedFiles;
}

/** @param links the relations that hold and the checked picks, from the router; the Gate's has none */
export function createCapabilityMutationPort(
  spec: CapabilitySpec,
  files: FileSubmissionBinding,
  signal?: AbortSignal,
  links: LinkBinding = NO_LINKS,
): CapabilityMutationPort {
  const parsed = capabilitySpecSchema.parse(spec);
  const { tableName } = deriveCapabilityTableDdl(parsed);
  const quotedTable = sqlIdentifier(tableName);
  const { fields, dataFields, fileFields } = savedFields(parsed);
  const allowedInsertFields = new Set(fields.map((field) => field.name));
  const { scope } = files;
  const { database } = scope;

  // A submission's files and picks belong to one record: a second create cannot claim them.
  const written = new Set<string>();
  let picked = false;

  return {
    create(values) {
      assertReadOwnership(signal);
      // The id wins: each picked field holds its target's text, whatever the Handler handed over.
      const own = {
        ...insertValues(parsed.id, allowedInsertFields, values),
        ...pickedTexts(database, links),
      };
      const keys = writtenFileKeys(fileFields, own, files.submitted, written);
      assertRequiredFilesHeld(parsed.id, fields, own, keys, "create");
      const normalized = normalizeSpecFieldValues(parsed.id, dataFields, own);
      const id = randomUUID();
      // A savepoint inside the save's transaction: a Handler that catches a failed insert and
      // answers anyway must not commit the key it promoted for a record that was never written.
      const insert = database.transaction((): StoredCapabilityRow => {
        // Here, past every value a Handler handed over: reading one can start a create of its own.
        if (picked && links.picks.size > 0) throw new PickWriteError();
        for (const [field, fieldKeys] of keys) {
          normalized[field.name] = claimedColumn(field, fieldKeys, id, scope);
        }
        const columns = ["id", ...fields.map((field) => field.name)];
        const sqlValues: SqlValue[] = [
          id,
          ...fields.map((field) => normalized[field.name] ?? null),
        ];
        const placeholders = columns.map(() => "?").join(", ");
        const quotedColumns = columns.map(sqlIdentifier).join(", ");
        linkCreatedRecord(database, parsed.id, id, links);
        return database
          .query(
            `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders}) RETURNING *`,
          )
          .get(...sqlValues) as StoredCapabilityRow;
      });
      const stored = insert();
      picked = true;
      for (const fieldKeys of keys.values()) for (const key of fieldKeys) written.add(key);
      return createCapabilityActionRecord(normalizeStoredRow(fields, stored));
    },
  };
}

/** A create's file column: each key promoted to `recordId` as it is written, in order. */
function claimedColumn(
  field: SpecField,
  keys: readonly string[],
  recordId: string,
  scope: FileClaimScope,
): SqlValue {
  const rows = keys.map((key) => claimPendingFile(field, key, recordId, "create", scope));
  if (isFileListFieldType(field.type)) return storedFileList(rows);
  return rows[0] === undefined ? null : storedFileReference(rows[0]);
}

/**
 * The keys each file field writes, in order: always the router-checked submission. A Handler may
 * hand back the projection it was given, or leave the field out; any other value is refused before
 * any write.
 */
function writtenFileKeys(
  fileFields: readonly SpecField[],
  values: CapabilityCreateValues,
  submitted: SubmittedFiles,
  written: ReadonlySet<string>,
): ReadonlyMap<SpecField, readonly string[]> {
  const keys = new Map<SpecField, readonly string[]>();
  for (const field of fileFields) {
    const file = submitted.get(field.name);
    const submittedKeys = file === undefined ? [] : submittedFileKeys(file);
    assertHandedBack(values, field, submittedKeys);
    if (submittedKeys.some((key) => written.has(key))) throw new FileFieldWriteError(field.name);
    keys.set(field, submittedKeys);
  }
  return keys;
}

/**
 * Refuse a Handler's value for a file field unless it is left out or names the submission: the
 * same file or `null` for a `file`, and for a `file[]` the same files in the same order.
 */
function assertHandedBack(
  values: Readonly<Record<string, unknown>>,
  field: SpecField,
  submittedKeys: readonly string[],
): void {
  const given = ownValue(values, field.name);
  if (given === undefined) return;
  const named = isFileListFieldType(field.type)
    ? Array.isArray(given) &&
      given.length === submittedKeys.length &&
      given.every((each, index) => fileKeyFromProjection(each) === submittedKeys[index])
    : given === null
      ? submittedKeys.length === 0
      : submittedKeys.length === 1 && fileKeyFromProjection(given) === submittedKeys[0];
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
  fileKeys: ReadonlyMap<SpecField, readonly string[]>,
  action: "create" | "update",
): void {
  const empty = new Set(
    [...fileKeys]
      .filter(([field, keys]) => field.required && keys.length === 0)
      .map(([field]) => field),
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

/** The keys each active file field holds once an update is written: its submission's, or the record's. */
function resultingFileKeys(
  fileFields: readonly SpecField[],
  current: CapabilityDataRow,
  fileWrites: FileWrites,
): ReadonlyMap<SpecField, readonly string[]> {
  const submitted = new Map(fileWrites);
  return new Map(
    fileFields.map((field) => {
      const file = submitted.get(field);
      return [field, file === undefined ? heldKeys(current, field) : submittedFileKeys(file)];
    }),
  );
}

export function createCapabilityUpdateMutationPort(
  spec: CapabilitySpec,
  recordTarget: string,
  submittedFields: ReadonlySet<string>,
  files: FileSubmissionBinding,
  signal?: AbortSignal,
  links: LinkBinding = NO_LINKS,
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
  const edited = {
    capability: parsed.id,
    incarnation: files.scope.incarnationId,
    record: input.target,
  };
  // A field of the record's own linked to it is refreshed too, so the edit reads the record again.
  const linkedToItself = links.reach.relations.some(
    ({ source, holds }) => holds && source.capability === parsed.id,
  );
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
      Object.assign(own, pickedTexts(input.scope.database, links));
      const fileWrites = submittedFileWrites(input, own);
      // A savepoint inside the save's transaction, as a create's is: a Handler that catches a failed
      // write and answers anyway must not commit a promoted or given-up key without its record.
      depth += 1;
      let updated: CapabilityDataRow;
      try {
        updated = input.scope.database.transaction(() => {
          const { before, row } = updateBoundTarget(input, own, fileWrites);
          const changed = (field: string) => before[field] !== row[field];
          const edit = { capabilityId: parsed.id, recordId: input.target, changed };
          relinkUpdatedRecord(input.scope.database, edit, links, submittedFields);
          refreshLinkedText(input.scope.database, edited, before, row, links.reach);
          return linkedToItself ? readBoundTarget(input) : row;
        })();
      } finally {
        depth -= 1;
      }
      // Written once: the same submission again keeps what this call wrote.
      for (const [field, file] of depth === 0 ? fileWrites : []) {
        input.files.set(field.name, keptAfterWrite(file));
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
        unlinkDeletedRecord(database, {
          capability: parsed.id,
          incarnation: scope.incarnationId,
          record: target,
        });
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

/** The bound record as it stands. */
function readBoundTarget(authority: BoundUpdateAuthority): CapabilityDataRow {
  const stored = authority.scope.database
    .query(`SELECT * FROM ${authority.quotedTable} WHERE "id" = ?`)
    .get(authority.target) as StoredCapabilityRow | null;
  if (!stored) throw new RecordNotFoundError(authority.capabilityId, "update");
  return normalizeStoredRow(authority.fields, stored);
}

/**
 * The record just before the update writes it, and as the update leaves it. Normalising the values
 * can run a Handler's code, and so an update of its own, so the record is read again before.
 */
function updateBoundTarget(
  authority: BoundUpdateAuthority,
  values: CapabilityUpdateValues,
  fileWrites: FileWrites,
): { readonly before: CapabilityDataRow; readonly row: CapabilityDataRow } {
  const current = readBoundTarget(authority);
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
  const before = readBoundTarget(authority);
  if (Object.keys(columns).length === 0) return { before, row: before };
  return { before, row: persistBoundUpdate(authority, columns) };
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
    assertHandedBack(values, field, submittedFileKeys(file));
    return [[field, file] as const];
  });
}

/**
 * Write each submitted file field that changes what its record holds, and give up every key it
 * displaces, in the update's savepoint: for a `file[]`, each entry the
 * list no longer holds. A kept key the record no longer holds is refused first, so the file another
 * window saved stays where it is.
 */
function writeSubmittedFiles(
  authority: BoundUpdateAuthority,
  current: CapabilityDataRow,
  fileWrites: FileWrites,
): Record<string, SqlValue> {
  const changed = fileWrites
    .filter(([field, file]) => keepsWhatChanged(file, heldKeys(current, field)))
    .map(([field]) => field.name);
  if (changed.length > 0) throw new RecordChangedError(authority.capabilityId, changed);

  const columns: Record<string, SqlValue> = {};
  for (const [field, file] of fileWrites) {
    const held = heldKeys(current, field);
    const next = submittedFileKeys(file);
    if (file.write === "keep" || sameKeys(held, next)) continue;
    columns[field.name] = storedFileColumn(authority, field, file);
    const owner = { ...authority.scope, field: field.name, recordId: authority.target };
    for (const displaced of held.filter((key) => !next.includes(key))) {
      if (!enqueueDisplacedFile(authority.scope.database, owner, displaced)) {
        throw new Error(`The file "${field.name}" held is not owned by its record in the ledger.`);
      }
    }
  }
  return columns;
}

/** The column a submitted file field writes, each claimed key promoted as it is written. */
function storedFileColumn(
  authority: BoundUpdateAuthority,
  field: SpecField,
  file: SubmittedFile,
): SqlValue {
  const claim = (key: string) =>
    claimPendingFile(field, key, authority.target, "update", authority.scope);
  if (file.write === "claim") return storedFileReference(claim(file.row.key));
  if (file.write !== "list") return isFileListFieldType(field.type) ? "[]" : null;
  return storedFileList(
    file.entries.map((entry) => {
      if (entry.write === "claim") return claim(entry.row.key);
      const kept = storedFromProjection(entry.held);
      if (!kept) throw new Error(`A file "${field.name}" keeps is not a stored reference.`);
      return kept;
    }),
  );
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function heldKeys(current: CapabilityDataRow, field: SpecField): readonly string[] {
  return heldFileKeys(ownValue(current, field.name));
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
