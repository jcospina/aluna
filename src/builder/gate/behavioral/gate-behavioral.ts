// From the 4.4 reset every admitted capability has the same five-Action behavioral
// contract, and from 4.7/01 each Action's tests are generated independently from that
// Action's total inputs and frozen before any Handler work. Keep this public module as the
// stable Gate seam: the rung executes frozen tests, the freeze stage authors them.

export {
  type BehavioralActionExecution,
  type BehavioralExecutionImpact,
  type BehavioralExecutionPlan,
  type BehavioralExecutionPlanInput,
  type BehavioralExecutionReason,
  behavioralSuiteCoverage,
  planBehavioralExecution,
  selectedBehavioralCases,
} from "./behavioral-execution-plan.ts";
export {
  attributeBehavioralFailure,
  BEHAVIORAL_ATTRIBUTION_REASONS,
  BEHAVIORAL_FAILURE_SURFACES,
  type BehavioralAttributionReason,
  type BehavioralFailureAttribution,
  type BehavioralFailureSurface,
  declaredHandlerSet,
} from "./behavioral-failure-attribution.ts";
export {
  BEHAVIORAL_TEST_GENERATION_CONCURRENCY,
  type BehavioralTestActionProgress,
  type BehavioralTestActionProgressStatus,
  type BehavioralTestActionReport,
  type BehavioralTestFreezeProgress,
  BehavioralTestGenerationError,
  type BehavioralTestInputSummary,
  type FreezeBehavioralTestsInput,
  type FrozenBehavioralTestsResult,
  freezeBehavioralTests,
} from "./behavioral-test-freeze.ts";
export {
  type ActionTestInputs,
  actionTestInputDigest,
  actionTestInputs,
  specActionTestInputs,
} from "./behavioral-test-inputs.ts";
export { runFullBehavioralRung as runBehavioralRung } from "./gate-behavioral-full.ts";
export {
  assertActionSuiteContract,
  assertFrozenTestsContract,
} from "./gate-behavioral-full-contract.ts";
export { buildActionBehavioralTestPrompt as buildBehavioralTestPrompt } from "./gate-behavioral-full-prompt.ts";
export {
  type FrozenActionTests,
  type FrozenBehavioralTests,
  type FullBehavioralTestCase,
  frozenBehavioralTestCases,
  frozenBehavioralTestsSchema,
} from "./gate-behavioral-full-schema.ts";
export {
  BehavioralRungFailure,
  type BehavioralRungFailureMeasurement,
  type BehavioralRungRun,
  FrozenIntentMutatedError,
} from "./gate-behavioral-repair.ts";
