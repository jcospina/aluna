// The capability registry (ARCH §6.3).
//
// The single public entry point for the registry subsystem: the validated spec
// shape every build-loop piece consumes (DDL mapper, router, spec generation,
// behavioral tier) and the lean read/write access to the registry table. Callers
// import from here and depend on nothing inside.

export {
  type CapabilityRow,
  type CapabilitySpec,
  type CapabilityTool,
  capabilityRowSchema,
  capabilitySpecSchema,
  capabilityToolSchema,
  type FieldType,
  fieldTypeSchema,
  PLATFORM_COLUMNS,
  type SpecField,
  type SpecView,
  specFieldSchema,
  specViewSchema,
} from "./spec.ts";
export { getCapability, insertCapability, listCapabilities, REGISTRY_TABLE } from "./store.ts";
