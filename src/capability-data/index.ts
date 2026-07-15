// Capability data-table infrastructure — Module 2, Epic 2.2.

export {
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  type CapabilityTableDdl,
  deriveCapabilityTableDdl,
  SQLITE_TYPE_BY_FIELD_TYPE,
} from "./ddl.ts";
export {
  type CapabilityCreateValues,
  type CapabilityDeleteMutationPort,
  type CapabilityMutationPort,
  type CapabilityUpdateMutationPort,
  type CapabilityUpdateValues,
  createCapabilityDataPorts,
  createCapabilityDeleteMutationPort,
  createCapabilityMutationPort,
  createCapabilityUpdateMutationPort,
  RECORD_NOT_FOUND_ERROR_CODE,
  RecordNotFoundError,
} from "./mutation.ts";
export {
  type CapabilityDataColumnValue,
  type CapabilityDataRow,
  CapabilityDataValidationError,
  type CapabilityQueryInput,
  type CapabilityQueryParameter,
  type CapabilityQueryPort,
  type CapabilityQueryResultColumn,
  type CapabilityQueryResultType,
  type CapabilityQueryRow,
  capabilityRowDescriptor,
  createCapabilityQueryPort,
  encodeCapabilityFieldForStorage,
  MissingRequiredFieldsError,
  selectCapabilityRows,
} from "./tool.ts";
