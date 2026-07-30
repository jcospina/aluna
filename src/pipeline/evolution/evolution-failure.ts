import {
  BehavioralTestGenerationError,
  CandidateValidationError,
  CapabilityGateError,
  SnapshotVerificationError,
  UnitGenerationError,
} from "../../builder/index.ts";
import type { GenerationFailure } from "../../metrics/index.ts";

export type EvolutionStage =
  | "spec_gen"
  | "diff"
  | "assembly"
  | "delivery"
  | "publication"
  | "activation";

/** Map the exact stage where evolution stopped onto the durable metrics vocabulary. */
export function classifyEvolutionFailure(error: unknown, stage: EvolutionStage): GenerationFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CapabilityGateError) {
    return { stage: "gate", rung: error.failedRung, message };
  }
  if (error instanceof BehavioralTestGenerationError) {
    return { stage: "behavioral_test_generation", message };
  }
  if (error instanceof CandidateValidationError) {
    return { stage: "spec_gen", message };
  }
  if (error instanceof UnitGenerationError) return { stage: "unit_generation", message };
  if (error instanceof SnapshotVerificationError && stage === "publication") {
    return { stage: "publication", message };
  }
  switch (stage) {
    case "spec_gen":
      return { stage: "spec_gen", message };
    case "diff":
      return { stage: "migration", message };
    case "assembly":
      return { stage: "unit_generation", message };
    case "delivery":
    case "publication":
      return { stage: "publication", message };
    case "activation":
      return { stage: "activation", message };
  }
}
