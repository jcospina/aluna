// Capability data-table infrastructure.

export {
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  type CapabilityTableDdl,
  deriveCapabilityTableDdl,
  SQLITE_TYPE_BY_FIELD_TYPE,
} from "./ddl.ts";
export {
  type CapabilityCreateValues,
  type CapabilityDataColumnValue,
  type CapabilityDataRow,
  CapabilityDataValidationError,
  type CapabilityMutationPort,
  type CapabilityQueryInput,
  type CapabilityQueryParameter,
  type CapabilityQueryPort,
  type CapabilityQueryResultColumn,
  type CapabilityQueryResultType,
  type CapabilityQueryRow,
  capabilityRowDescriptor,
  createCapabilityDataPorts,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  MissingRequiredFieldsError,
  selectCapabilityRows,
} from "./tool.ts";
