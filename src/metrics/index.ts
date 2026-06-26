// The generation-metrics store — Module 2, Epic 2.7 (ARCH §6.3 "Generation
// Metrics", §6.2, PLAN flow step 8).
//
// The single public entry point for the metrics subsystem: the validated row
// shape a generation assembles, the writer that persists one row per generation
// (build, failed build, or deflection), and the read surface M8 queries the
// dataset through. Later modules import from here and depend on nothing inside.

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
