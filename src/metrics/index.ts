// The generation-metrics store (ARCH §6.3 "Generation Metrics", §6.2).
//
// The single public entry point for the metrics subsystem: the validated row
// shape a generation assembles, the writer that persists one row per generation
// (build, failed build, or deflection), and the read surface the experiment harness
// queries the dataset through. Callers import from here and depend on nothing inside.

export {
  type CarriedResolverMeasurement,
  carriedResolverMeasurementSchema,
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  GENERATION_LIFECYCLE_STATUSES,
  GENERATION_LIFECYCLE_TABLE,
  GENERATION_STAGE_STATES,
  GENERATION_TERMINAL_OUTCOMES,
  type GenerationBuildMeasurement,
  type GenerationFailureOutcome,
  type GenerationLifecycle,
  type GenerationLifecycleStatus,
  type GenerationStageMeasurement,
  type GenerationStageState,
  type GenerationSuccessOutcome,
  type GenerationTerminalOutcome,
  generationBuildMeasurementSchema,
  generationLifecycleSchema,
  generationLifecycleStatusSchema,
  generationStageMeasurementSchema,
  generationStageStateSchema,
  generationTerminalOutcomeSchema,
  getGenerationLifecycle,
  listGenerationLifecycles,
  reconcileRunningGenerationLifecycles,
  type StartGenerationLifecycleInput,
  type StoredGenerationLifecycle,
  startGenerationLifecycle,
  storedGenerationLifecycleSchema,
  updateGenerationLifecycleIdentity,
} from "./lifecycle-store.ts";
export {
  FAILURE_STAGES,
  type FailureStage,
  failureStageSchema,
  type GenerationFailure,
  type UnitAttemptSummary,
} from "./shared-schema.ts";
export {
  type GateRungOutcome,
  GENERATION_METRICS_TABLE,
  GENERATION_OUTCOMES,
  type GenerationIntent,
  type GenerationMetrics,
  type GenerationOutcome,
  type GenerationTimings,
  generationMetricsSchema,
  generationOutcomeSchema,
  getGenerationMetrics,
  listGenerationMetrics,
  type StoredGenerationMetrics,
  storedGenerationMetricsSchema,
  sumTokenUsage,
  writeGenerationMetrics,
} from "./store.ts";
