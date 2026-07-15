// The capability registry (ARCH §6.3).
//
// The single public entry point for the registry subsystem: the validated spec
// shape every build-loop piece consumes (DDL mapper, router, spec generation,
// behavioral tier) and the lean read/write access to the registry table. Callers
// import from here and depend on nothing inside.

export { canonicalCapabilityLabel, isCapabilityNameLabel } from "./labels.ts";
export {
  activeSpecFields,
  BEHAVIORAL_ERROR_MARKERS,
  type BehavioralErrorCase,
  type BehavioralErrorMarkers,
  behavioralErrorCaseSchema,
  behavioralErrorMarkersSchema,
  type CapabilityRow,
  type CapabilitySpec,
  type CapabilityTool,
  CREATED_AT_DESCRIPTOR,
  capabilityRowSchema,
  capabilitySpecSchema,
  capabilityToolSchema,
  defaultBehavioralErrorsForSchema,
  type FieldLifecycle,
  type FieldType,
  fieldLifecycleSchema,
  fieldTypeSchema,
  incarnationIdSchema,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
  type PresentationFieldDescriptor,
  presentationFieldDescriptors,
  type SpecField,
  specFieldSchema,
  type UiCollectionLayout,
  type UiIntent,
  uiCollectionLayoutSchema,
  uiIntentSchema,
} from "./spec.ts";
export {
  getCapability,
  insertCapability,
  isRegistryInitialized,
  listCapabilities,
  REGISTRY_TABLE,
} from "./store.ts";
