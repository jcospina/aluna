// TEMPORARY — Module 4.6/05 removes this hand-authored regenerate-all tracer.
//
// This is deliberately a single narrow entry point, not an evolution pipeline. It
// accepts a complete candidate that tests or the temporary developer affordance
// authored up front, then uses the normal snapshot publication and activation
// contracts. Candidate/Diff ownership belongs to 4.6.

import { reconcileCapabilityArtifacts } from "../builder/artifact-reconciliation.ts";
import {
  type ActivationFaultHooks,
  activatePublishedSnapshot,
  type CapabilityGateResult,
  expectedActiveCapability,
  type GeneratedUnit,
  nextCapabilityVersion,
  publishCapabilitySnapshot,
  type VerifiedPublishedSnapshot,
} from "../builder/index.ts";
import { applyCapabilityMigration } from "../builder/migration.ts";
import type { PlatformDatabase } from "../db.ts";
import type { CapabilityRow, CapabilitySpec } from "../registry/index.ts";
import type { DemoBuildAccumulator, RecordMetrics } from "./metrics-recorder.ts";
import {
  lifecycleMeasurement,
  lifecycleStages,
  recordGateMetrics,
  recordUnitMetrics,
} from "./metrics-recorder.ts";

export interface HandAuthoredV2Candidate {
  readonly spec: CapabilitySpec;
  readonly units: readonly GeneratedUnit[];
  readonly gate: CapabilityGateResult;
}

export type HandAuthoredV2CandidateSource =
  | HandAuthoredV2Candidate
  | (() => HandAuthoredV2Candidate | Promise<HandAuthoredV2Candidate>);

export interface HandAuthoredV2TracerInput {
  /** The exact registry pointer selected before this temporary tracer starts. */
  readonly active: CapabilityRow;
  /** A lazy factory keeps candidate/Gate failures inside the durable lifecycle. */
  readonly candidate: HandAuthoredV2CandidateSource;
  readonly buildId: string;
  readonly database: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly recordMetrics: RecordMetrics;
  readonly beforePublish?: (stagingDirectory: string) => void;
  readonly faults?: ActivationFaultHooks;
}

export interface HandAuthoredV2TracerResult {
  readonly publication: VerifiedPublishedSnapshot;
  readonly commit: Awaited<ReturnType<typeof activatePublishedSnapshot>>;
}

/**
 * Publish and activate one hand-authored next-version candidate.
 *
 * The caller supplies a complete Gate-issued candidate; this seam neither diffs nor
 * generates individual units. Its only authority is the normal v(N+1) publication
 * and CAS activation path. A pre-commit throw leaves the lifecycle failed and the
 * previous pointer live. A post-commit throw is rethrown without rewriting the
 * already-authoritative success lifecycle.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the one temporary entry point keeps its PONR handling auditable.
export async function runHandAuthoredV2Tracer(
  input: HandAuthoredV2TracerInput,
): Promise<HandAuthoredV2TracerResult> {
  const { active } = input;

  const builtAt = performance.now();
  const acc: DemoBuildAccumulator = {
    usages: [],
    timings: {},
    capabilityId: active.id,
    incarnationId: active.incarnation_id,
  };
  input.recordMetrics.start({
    buildId: input.buildId,
    incarnationId: active.incarnation_id,
    capabilityId: active.id,
    stages: [],
  });

  let candidateReady = false;
  try {
    const candidate =
      typeof input.candidate === "function" ? await input.candidate() : input.candidate;
    candidateReady = true;
    recordUnitMetrics(acc, candidate.units);
    recordGateMetrics(acc, candidate.gate);
    if (candidate.spec.id !== active.id) {
      throw new Error("Hand-authored v2 candidate must keep the selected capability identity.");
    }

    // Verify every committed v1..vN before treating the selected pointer as an
    // evolution base. A damaged historical version is authoritative corruption, not
    // a reason to try publishing another candidate.
    reconcileCapabilityArtifacts({
      database: input.database.readwrite,
      artifactsRoot: input.artifactsRoot,
    });
    const publication = publishCapabilitySnapshot({
      buildId: input.buildId,
      spec: candidate.spec,
      incarnationId: active.incarnation_id,
      version: nextCapabilityVersion(
        expectedActiveCapability({
          capabilityId: active.id,
          incarnationId: active.incarnation_id,
          version: active.version,
        }),
      ),
      units: candidate.units,
      gate: candidate.gate,
      artifactsRoot: input.artifactsRoot,
      ...(input.beforePublish ? { beforePublish: input.beforePublish } : {}),
    });
    acc.publicationAttempted = true;
    acc.activationAttempted = true;
    const commit = await activatePublishedSnapshot({
      database: input.database.readwrite,
      spec: candidate.spec,
      publication,
      expected: expectedActiveCapability({
        capabilityId: active.id,
        incarnationId: active.incarnation_id,
        version: active.version,
      }),
      applyMigration: (database) =>
        void applyCapabilityMigration({ database, spec: candidate.spec }),
      finalizeMetrics: () =>
        input.recordMetrics.succeed({
          buildId: input.buildId,
          incarnationId: active.incarnation_id,
          outcome: "activated",
          stages: lifecycleStages(acc, "activated"),
          measurement: lifecycleMeasurement(acc, builtAt),
        }),
      ...(input.faults ? { faults: input.faults } : {}),
    });
    return { publication, commit };
  } catch (error) {
    // `afterCommit` is intentionally outside the transaction. Its success row is
    // evidence that v2 is authoritative, so never overwrite it as a failure.
    if (
      input.recordMetrics.get(input.buildId, active.incarnation_id)?.lifecycleStatus !== "success"
    ) {
      input.recordMetrics.fail({
        buildId: input.buildId,
        incarnationId: active.incarnation_id,
        outcome: !candidateReady
          ? "gate_failed"
          : acc.publicationAttempted
            ? "activation_failed"
            : "publication_failed",
        stages: lifecycleStages(acc, "failed"),
        measurement: lifecycleMeasurement(acc, builtAt, {
          stage: !candidateReady ? "gate" : acc.publicationAttempted ? "activation" : "publication",
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    }
    throw error;
  }
}
