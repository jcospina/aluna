// The Gate's scratch file references (Module 7 PLAN decision 38): rows in each scratch database's
// own ledger, never bytes. Generated code only ever sees a reference's projection, so a ledger row
// is all a Handler or a renderer is tested against. Admission, storage and serving are platform
// code with their own tests, as routing is.

import type { Database } from "bun:sqlite";
import { admittedTypes } from "../../platform/files/admission.ts";
import {
  insertPendingFile,
  mintFileKey,
  type PendingFile,
  promotePendingFile,
} from "../../platform/files/ledger.ts";
import {
  activeSpecFields,
  type CapabilitySpec,
  type FileFamily,
  type SpecField,
} from "../../registry/index.ts";
import {
  type CapabilityFileProjection,
  type FileClaimScope,
  type FileSubmissionBinding,
  fileClaimScope,
  projectFileLedgerRow,
  resolveSubmittedFiles,
  storedFileReference,
} from "../../runtime/data/index.ts";
import type { CapabilityInput, CapabilitySaveInput } from "../../runtime/router/index.ts";
import { withFileProjections } from "../../runtime/router/save-input.ts";

/** The incarnation every scratch reference is minted for: a scratch catalog has no real one. */
export const SCRATCH_INCARNATION_ID = "gate-scratch";

const SCRATCH_SIZE = 48_213;

/**
 * The key of every probe projection. Design lint compares probe records, so a key minted per probe
 * would move a composition that ignores the field under test.
 */
const PROBE_KEY = "5c7a7c1e-9a4b-4c1d-8e2f-000000000006";

/** The type a scratch file of `kind` is recorded as: the first admission verifies for it. */
export function scratchFileType(kind: FileFamily): string {
  const mime = admittedTypes(kind)[0];
  if (mime === undefined) throw new Error(`Admission records no type for the "${kind}" family.`);
  return mime;
}

/** A file admitted to `field`, of its first family unless one is named. */
function scratchPendingFile(
  spec: CapabilitySpec,
  field: SpecField,
  name: string,
  key: string,
  family?: FileFamily,
): PendingFile {
  const kind = family ?? field.accepts?.[0];
  if (kind === undefined) throw new Error(`File field "${field.name}" accepts no family.`);
  return {
    key,
    capability_id: spec.id,
    incarnation_id: SCRATCH_INCARNATION_ID,
    field: field.name,
    kind,
    mime: scratchFileType(kind),
    size: SCRATCH_SIZE,
    name,
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
): PendingFile {
  const file = scratchPendingFile(spec, field, name, mintFileKey(), family);
  insertPendingFile(database, file);
  if (recordId !== null) promotePendingFile(database, file.key, recordId);
  return file;
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
  return projectFileLedgerRow(scratchPendingFile(spec, field, name, PROBE_KEY));
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
  const scope = scratchFileScope(spec, database, recordId);
  const submitted = resolveSubmittedFiles(
    activeSpecFields(spec.schema.fields),
    input.values,
    recordId === undefined ? "create" : "update",
    scope,
  );
  return { input: withFileProjections(input, submitted), binding: { scope, submitted } };
}

/** Where a scratch save's files are checked and a scratch delete gives its record's files up. */
export function scratchFileScope(
  spec: CapabilitySpec,
  database: Database,
  recordId?: string,
): FileClaimScope {
  return fileClaimScope(database, spec, SCRATCH_INCARNATION_ID, recordId);
}
