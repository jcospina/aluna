// The capability registry — Module 2, Epic 2.1 (ARCH §6.3, PLAN decision 8).
//
// The single public entry point for the registry subsystem: the validated spec
// shape every Module 2 piece consumes (DDL mapper, router, spec generation,
// behavioral tier) and the lean read/write access to the registry table. Later
// epics import from here and depend on nothing inside.

export {
  BEHAVIORAL_ERROR_MARKERS,
  type BehavioralErrorCase,
  type BehavioralErrorMarkers,
  behavioralErrorCaseSchema,
  behavioralErrorMarkersSchema,
  type CapabilityRow,
  type CapabilitySpec,
  type CapabilityTool,
  capabilityRowSchema,
  capabilitySpecSchema,
  capabilityToolSchema,
  defaultBehavioralErrorsForSchema,
  type FieldType,
  fieldTypeSchema,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
  type SpecField,
  type SpecView,
  specFieldSchema,
  specViewSchema,
} from "./spec.ts";
export { getCapability, insertCapability, listCapabilities, REGISTRY_TABLE } from "./store.ts";
