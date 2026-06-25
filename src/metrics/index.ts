// The generation-metrics store (ARCH §6.3 "Generation Metrics", §6.2).
//
// The single public entry point for the metrics subsystem: the validated row
// shape a generation assembles, the writer that persists one row per generation
// (build, failed build, or deflection), and the read surface the experiment harness
// queries the dataset through. Callers import from here and depend on nothing inside.

export {
  FAILURE_STAGES,
  type FailureStage,
  failureStageSchema,
  type GateRungOutcome,
  GENERATION_METRICS_TABLE,
  GENERATION_OUTCOMES,
  type GenerationFailure,
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
  type UnitAttemptSummary,
  writeGenerationMetrics,
} from "./store.ts";
