// The Capability Builder — Module 2, Epic 2.5 (ARCH §6.2 "Capability Builder").
//
// The public surface for the builder's pipeline stages. Spec generation is the
// first stage (issue 02): prompt + intent → a Zod-valid capability spec, the
// diffable source of truth the migration, units, and tests all derive from. Later
// stages (migration, unit generation, gate, commit) join here behind this same
// entry point.

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
