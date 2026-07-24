// The Capability Builder — Module 2, Epic 2.5 (ARCH §6.2 "Capability Builder").
//
// The public surface for the builder's pipeline stages. Spec generation is the
// first stage (issue 02): prompt + intent → a Zod-valid capability spec, the
// diffable source of truth the migration, units, and tests all derive from. Later
// stages (migration, unit generation, gate, commit) join here behind this same
// entry point.

export {
  type ActivatePublishedSnapshotInput,
  type ActivationFaultHooks,
  activatePublishedSnapshot,
  expectedAbsentCapability,
  expectedActiveCapability,
  nextCapabilityVersion,
} from "./activation.ts";
export {
  assertVerifiedPublishedSnapshot,
  type PublishCapabilitySnapshotInput,
  publishCapabilitySnapshot,
  type SnapshotFileEntry,
  type SnapshotManifest,
  SnapshotVerificationError,
  snapshotManifestSchema,
  type UnitGenerationProvenance,
  type VerifiedCapabilitySnapshot,
  type VerifiedPublishedSnapshot,
  verifyCapabilitySnapshot,
} from "./artifact-lifecycle.ts";
export {
  DERIVED_UNIT_FILES,
  type DerivedUnitFile,
  type EvolutionUnitProvenanceInput,
  evolutionUnitProvenance,
  type UnitProvenanceManifest,
  unitProvenanceManifestSchema,
} from "./artifact-provenance.ts";
export {
  ArtifactReconciliationError,
  type ArtifactReconciliationResult,
  type CommittedCapabilityVersions,
  type ReconcileCapabilityArtifactsInput,
  reconcileCapabilityArtifacts,
  type TombstonedCapabilityIncarnation,
} from "./artifact-reconciliation.ts";
export {
  buildCandidateSpecPrompt,
  type CandidateSpecGenResult,
  type GenerateCandidateSpecInput,
  generateCandidateSpec,
  handSuppliedEvolutionIntent,
} from "./candidate-spec-gen.ts";
export {
  CandidateValidationError,
  type CandidateValidationIssue,
  committedSpecView,
  type ValidateCandidateSpecInput,
  validateCandidateSpec,
} from "./candidate-validation.ts";
export {
  type CommitCapabilityInput,
  type CommitCapabilityResult,
  commitCapability,
  DEFAULT_ARTIFACTS_ROOT,
  FIRST_CAPABILITY_VERSION,
} from "./commit.ts";
export {
  buildDependencyGenerationCatalog,
  type DependencyGenerationCatalogEntry,
} from "./dependency-catalog.ts";
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
} from "./diff-engine.ts";
export {
  BEHAVIORAL_TIER_ENV_VAR,
  type BehavioralGateResult,
  type BehavioralTestCaseOutcome,
  type BehavioralTestGenerationMetrics,
  type BehavioralTestRunMetrics,
  type BehavioralTierInput,
  buildBehavioralTestPrompt,
  CapabilityGateError,
  type CapabilityGateInput,
  type CapabilityGateResult,
  type DesignLintAttempt,
  type DesignLintGateResult,
  type DesignLintTierInput,
  type GateRungName,
  type GateRungOutcome,
  type GateRungStatus,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
  type ScratchCatalogCapability,
  type SmokeGateResult,
} from "./gate.ts";
export {
  StructuralGateError,
  type StructuralGateResult,
  type StructuralUnitOutcome,
} from "./gate-structural.ts";
export { createCapabilityIncarnationId } from "./incarnation.ts";
export {
  type ApplyCapabilityMigrationInput,
  applyCapabilityMigration,
  type CapabilityMigrationResult,
  type CapabilityMigrationTransactionResult,
  withCapabilityMigrationTransaction,
} from "./migration.ts";
export {
  buildSpecPrompt,
  type GenerateSpecInput,
  generateSpec,
  hardcodedNewCapabilityIntent,
  type SpecGenResult,
} from "./spec-gen.ts";
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
} from "./units.ts";
