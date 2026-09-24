// Capability data-table infrastructure.

export {
  claimPendingFile,
  type FileClaimScope,
  resolveSubmittedFiles,
  type SubmittedFiles,
} from "./access/file-claims.ts";
export {
  type CapabilityCreateValues,
  type CapabilityDeleteMutationPort,
  type CapabilityMutationPort,
  type CapabilityUpdateMutationPort,
  type CapabilityUpdateValues,
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityUpdateMutationPort,
  type FileSubmissionBinding,
  RECORD_NOT_FOUND_ERROR_CODE,
  RecordNotFoundError,
} from "./access/mutation.ts";
export { assertReadOwnership } from "./access/read-ownership.ts";
export { countCapabilityRecords } from "./access/record-count.ts";
export { MAX_SEARCH_QUERY_LENGTH, MAX_SEARCH_TERMS } from "./access/search-bounds.ts";
export { assertSubmittedFieldValues } from "./access/submitted-values.ts";
export {
  type AdditiveCapabilityMigration,
  applyAdditiveCapabilityMigration,
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  type CapabilityTableDdl,
  deriveAdditiveCapabilityMigration,
  deriveCapabilityTableDdl,
  SQLITE_TYPE_BY_FIELD_TYPE,
} from "./schema/ddl.ts";
export {
  type CapabilityFileProjection,
  FILE_URL_PREFIX,
  fileKeyFromProjection,
  projectFileLedgerRow,
} from "./schema/file-values.ts";
export {
  assertScopedQuery,
  type CapabilityActionRecord,
  type CapabilityDataColumnValue,
  type CapabilityDataRow,
  CapabilityDataValidationError,
  type CapabilityQueryInput,
  type CapabilityQueryParameter,
  type CapabilityQueryPort,
  type CapabilityQueryResultColumn,
  type CapabilityQueryResultType,
  type CapabilityQueryRow,
  type CapabilityQueryScope,
  type CapabilityRecordHandle,
  type CapabilityRecordQueryInput,
  type CapabilityRecordQueryRow,
  ChoiceDisabledError,
  capabilityQueryScopeTableNames,
  createCapabilityActionRecord,
  createCapabilityQueryPort,
  encodeCapabilityFieldForStorage,
  type FileReferenceRefusal,
  InvalidChoiceError,
  InvalidFileReferenceError,
  isCapabilityActionRecord,
  MaxLengthExceededError,
  MissingRequiredFieldsError,
  materializeCapabilityActionRecord,
  normalizeSearchText,
  selectCapabilityRows,
} from "./tool.ts";
