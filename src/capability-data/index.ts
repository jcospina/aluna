// Capability data-table infrastructure.

export {
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  type CapabilityTableDdl,
  deriveCapabilityTableDdl,
  SQLITE_TYPE_BY_FIELD_TYPE,
} from "./ddl.ts";
export {
  type CapabilityDataColumnValue,
  type CapabilityDataRow,
  type CapabilityDataTool,
  CapabilityDataValidationError,
  type CapabilityInsertValues,
  createCapabilityDataTool,
  MissingRequiredFieldsError,
} from "./tool.ts";
