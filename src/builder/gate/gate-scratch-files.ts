// The Gate's scratch file references (Module 7 PLAN decision 38): rows in each scratch database's
// own ledger, never bytes. Generated code only ever sees a reference's projection, so a ledger row
// is all a Handler or a renderer is tested against. Admission, storage and serving are platform
// code with their own tests, as routing is.

import type { Database } from "bun:sqlite";
import { FILE_LEDGER_TABLE, type FileLedgerRow, mintFileKey } from "../../platform/files/ledger.ts";
import {
  activeSpecFields,
  type CapabilitySpec,
  type FileFamily,
  type SpecField,
} from "../../registry/index.ts";
import {
  type CapabilityFileProjection,
  deriveCapabilityTableDdl,
  type FileSubmissionBinding,
  projectFileLedgerRow,
  resolveSubmittedFiles,
  storedFileReference,
  withFileProjections,
} from "../../runtime/data/index.ts";
import type { CapabilityInput, CapabilitySaveInput } from "../../runtime/router/index.ts";

export { SCRATCH_FILE_NAME_BYTES, scratchFileName } from "./gate-scratch-names.ts";

/** The incarnation every scratch reference is minted for: a scratch catalog has no real one. */
export const SCRATCH_INCARNATION_ID = "gate-scratch";

/** What admission would have verified a scratch file of each family to be. */
const SCRATCH_MIME: Readonly<Record<FileFamily, string>> = { image: "image/jpeg" };
const SCRATCH_SIZE = 48_213;

/**
 * The key of every probe projection. Design lint compares probe records, so a key minted per probe
 * would move a composition that ignores the field under test.
 */
const PROBE_KEY = "5c7a7c1e-9a4b-4c1d-8e2f-000000000006";

/** A ledger row for `field`, pending unless a record owns it, of its first family unless named. */
function scratchLedgerRow(
  spec: CapabilitySpec,
  field: SpecField,
  name: string,
  recordId: string | null,
  key: string,
  family?: FileFamily,
): FileLedgerRow {
  const kind = family ?? field.accepts?.[0];
  if (kind === undefined) throw new Error(`File field "${field.name}" accepts no family.`);
  return {
    key,
    capability_id: spec.id,
    incarnation_id: SCRATCH_INCARNATION_ID,
    field: field.name,
    record_id: recordId,
    state: recordId === null ? "pending" : "owned",
    kind,
    mime: SCRATCH_MIME[kind],
    size: SCRATCH_SIZE,
    name,
    encoding: null,
    created_at: "2026-01-01 00:00:00",
    cleanup_attempts: 0,
    cleanup_error: null,
  };
}

/** Admit a scratch file to `database`'s ledger, pending, or owned when `recordId` is given. */
export function mintScratchFile(
  database: Database,
  spec: CapabilitySpec,
  field: SpecField,
  name: string,
  recordId: string | null = null,
  family?: FileFamily,
): FileLedgerRow {
  const row = scratchLedgerRow(spec, field, name, recordId, mintFileKey(), family);
  database
    .query(
      `INSERT INTO ${FILE_LEDGER_TABLE}
         (key, capability_id, incarnation_id, field, record_id, state, kind, mime, size, name, encoding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.key,
      row.capability_id,
      row.incarnation_id,
      row.field,
      row.record_id,
      row.state,
      row.kind,
      row.mime,
      row.size,
      row.name,
      row.encoding,
    );
  return row;
}

/** The column value of a file `recordId` holds, owned in the ledger as a committed save leaves it. */
export function scratchStoredFile(
  database: Database,
  spec: CapabilitySpec,
  field: SpecField,
  recordId: string,
  name: string,
): string {
  return storedFileReference(mintScratchFile(database, spec, field, name, recordId));
}

/** A file as a renderer receives it, for a probe that runs without a database. */
export function scratchFileProjection(
  spec: CapabilitySpec,
  field: SpecField,
  name: string,
): CapabilityFileProjection {
  return projectFileLedgerRow(scratchLedgerRow(spec, field, name, null, PROBE_KEY));
}

export interface ScratchSubmission {
  readonly input: CapabilitySaveInput;
  readonly binding: FileSubmissionBinding;
}

/**
 * Check a scratch save's file fields as the router does and bind what it writes, as
 * `runtime/router/dispatch/handler-invocation.ts` does. An update names the record it edits.
 */
export function scratchSubmission(
  spec: CapabilitySpec,
  input: CapabilityInput,
  database: Database,
  recordId?: string,
): ScratchSubmission {
  const table = deriveCapabilityTableDdl(spec).tableName;
  const submitted = resolveSubmittedFiles(
    activeSpecFields(spec.schema.fields),
    input.values,
    recordId === undefined ? "create" : "update",
    {
      database,
      capabilityId: spec.id,
      incarnationId: SCRATCH_INCARNATION_ID,
      ...(recordId === undefined ? {} : { record: { table, id: recordId } }),
    },
  );
  return {
    input: withFileProjections(input, submitted),
    binding: { incarnationId: SCRATCH_INCARNATION_ID, submitted },
  };
}
