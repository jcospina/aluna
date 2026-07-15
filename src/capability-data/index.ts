// Capability data-table infrastructure — Module 2, Epic 2.2.

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
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  MissingRequiredFieldsError,
} from "./tool.ts";
