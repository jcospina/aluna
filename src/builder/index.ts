// The Capability Builder — Module 2, Epic 2.5 (ARCH §6.2 "Capability Builder").
//
// The public surface for the builder's pipeline stages. Spec generation is the
// first stage (issue 02): prompt + intent → a Zod-valid capability spec, the
// diffable source of truth the migration, units, and tests all derive from. Later
// stages (migration, unit generation, gate, commit) join here behind this same
// entry point.

export {
  type ActivatePublishedSnapshotInput,
  ActivationCancelledError,
  type ActivationFaultHooks,
  activatePublishedSnapshot,
  expectedAbsentCapability,
  expectedActiveCapability,
  nextCapabilityVersion,
} from "./artifacts/activation.ts";
export {
  assertVerifiedPublishedSnapshot,
  type PublishCapabilitySnapshotInput,
  publishCapabilitySnapshot,
  readFrozenBehavioralTests,
  type SnapshotFileEntry,
  type SnapshotManifest,
  SnapshotVerificationError,
  snapshotManifestSchema,
  type UnitGenerationProvenance,
  type VerifiedCapabilitySnapshot,
  type VerifiedPublishedSnapshot,
  verifyCapabilitySnapshot,
} from "./artifacts/artifact-lifecycle.ts";
export {
  DERIVED_UNIT_FILES,
  type DerivedUnitFile,
  type EvolutionUnitProvenanceInput,
  evolutionUnitProvenance,
  type UnitProvenanceManifest,
  unitProvenanceManifestSchema,
  type VerifiedDependencySnapshot,
} from "./artifacts/artifact-provenance.ts";
export {
  ArtifactReconciliationError,
  type ArtifactReconciliationResult,
  type CommittedCapabilityVersions,
  type ReconcileCapabilityArtifactsInput,
  reconcileCapabilityArtifacts,
  type TombstonedCapabilityIncarnation,
} from "./artifacts/artifact-reconciliation.ts";
export {
  type CommitCapabilityInput,
  type CommitCapabilityResult,
  commitCapability,
  DEFAULT_ARTIFACTS_ROOT,
  FIRST_CAPABILITY_VERSION,
} from "./commit/commit.ts";
export {
  buildCandidateSpecPrompt,
  type CandidateSpecGenResult,
  type GenerateCandidateSpecInput,
  generateCandidateSpec,
} from "./evolution/candidate-spec-gen.ts";
export {
  CandidateValidationError,
  type CandidateValidationIssue,
  committedSpecView,
  type ValidateCandidateSpecInput,
  validateCandidateSpec,
} from "./evolution/candidate-validation.ts";
export {
  buildDependencyGenerationCatalog,
  type DependencyGenerationCatalogEntry,
} from "./evolution/dependency-catalog.ts";
export {
  assertVerifiedDependencySnapshotCatalog,
  buildVerifiedDependencySnapshotCatalog,
} from "./evolution/dependency-snapshot-catalog.ts";
export {
  type BehavioralTestPlan,
  type CapabilityDiff,
  type ChangeFact,
  type ChangeFactKind,
  type DiffGatePlan,
  type DiffWorkPlan,
  diffCapabilitySpec,
  GENERATED_UNITS,
  type GeneratedUnitName,
  PLATFORM_WORK_KINDS,
  type PlatformWorkKind,
  UnmappedChangeFactError,
} from "./evolution/diff-engine.ts";
export {
  type ActionTestInputs,
  actionTestInputDigest,
  actionTestInputs,
  assertActionSuiteContract,
  assertFrozenTestsContract,
  BEHAVIORAL_TIER_ENV_VAR,
  type BehavioralActionExecution,
  type BehavioralExecutionImpact,
  type BehavioralExecutionPlan,
  type BehavioralExecutionPlanInput,
  type BehavioralExecutionReason,
  type BehavioralGateResult,
  type BehavioralHandlerGenerationAttempt,
  type BehavioralTestActionProgress,
  type BehavioralTestActionReport,
  type BehavioralTestCaseOutcome,
  type BehavioralTestFreezeProgress,
  BehavioralTestGenerationError,
  type BehavioralTestGenerationMetrics,
  type BehavioralTestInputSummary,
  type BehavioralTestRunMetrics,
  type BehavioralTierInput,
  behavioralSuiteCoverage,
  buildBehavioralTestPrompt,
  CapabilityGateError,
  type CapabilityGateFailureMeasurement,
  type CapabilityGateInput,
  type CapabilityGateResult,
  type DesignLintAttempt,
  type DesignLintGateResult,
  type DesignLintTierInput,
  type FreezeBehavioralTestsInput,
  type FrozenActionTests,
  type FrozenBehavioralTests,
  type FrozenBehavioralTestsInput,
  type FrozenBehavioralTestsResult,
  type FullBehavioralTestCase,
  freezeBehavioralTests,
  frozenBehavioralTestCases,
  frozenBehavioralTestsSchema,
  type GateRungName,
  type GateRungOutcome,
  type GateRungStatus,
  planBehavioralExecution,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
  type ScratchCatalogCapability,
  type SmokeGateResult,
  selectedBehavioralCases,
  specActionTestInputs,
} from "./gate/gate.ts";
export {
  StructuralGateError,
  type StructuralGateResult,
  type StructuralUnitOutcome,
} from "./gate/structural/gate-structural.ts";
export { createCapabilityIncarnationId } from "./incarnation.ts";
export {
  type ApplyCapabilityMigrationInput,
  applyCapabilityMigration,
  type CapabilityMigrationResult,
  type CapabilityMigrationTransactionResult,
  withCapabilityMigrationTransaction,
} from "./migration/migration.ts";
export {
  buildSpecPrompt,
  type GenerateSpecInput,
  generateSpec,
  hardcodedNewCapabilityIntent,
  type SpecGenResult,
} from "./spec/spec-gen.ts";
export {
  admissiblePriorSource,
  checkPriorSourceAdmissibility,
  type PriorSourceAdmissibility,
  type PriorSourceAdmissibilityInput,
  type PriorSourceDecision,
} from "./units/prior-source-admissibility.ts";
export {
  buildUnitPrompt,
  DEFAULT_UNIT_FIX_ATTEMPTS,
  type GenerateCapabilityUnitInput,
  type GenerateCapabilityUnitsInput,
  type GenerateCapabilityUnitsResult,
  type GeneratedUnit,
  generateCapabilityUnit,
  generateCapabilityUnits,
  type HandlerUnitName,
  ITEM_RENDERER_UNIT_NAME,
  type ItemRendererUnitName,
  type UnitDescriptor,
  type UnitGenerationAttempt,
  type UnitGenerationAttemptEvent,
  type UnitGenerationDiagnostic,
  UnitGenerationError,
  type UnitGenerationObserver,
  type UnitGenerationPartialEvent,
  type UnitGenerationStartEvent,
} from "./units/units.ts";
