// Capability data-table infrastructure — Module 2, Epic 2.2. This subsystem
// holds the deterministic DDL mapper now and the scoped data tool next.

export {
  applyCapabilityTableDdl,
  CAPABILITY_TABLE_PREFIX,
  type CapabilityTableDdl,
  deriveCapabilityTableDdl,
  SQLITE_TYPE_BY_FIELD_TYPE,
} from "./ddl.ts";
