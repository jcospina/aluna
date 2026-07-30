// Foreground explicit-loop presentation for one capability evolution.
//
// The evolution engine owns mutation, Gate, publication, and activation. This
// adapter owns only the product-facing terminal story: one committed View swap
// after activation, or canonical restoration for every non-activating outcome.

import { CandidateValidationError } from "../../builder/index.ts";
import type { PlatformDatabase } from "../../persistence/db.ts";
import type { CapabilityRow } from "../../registry/index.ts";
import { renderCachedCapabilityCommitSwap } from "../../web/index.ts";
import type { BuildJob, BuildPipelineCompletion, SendBuildEvent } from "../jobs/build-jobs.ts";
import { renderRestorationFragment } from "../jobs/restoration.ts";
import type { RecordMetrics } from "../metrics-recorder.ts";
import {
  buildCommitPreview,
  buildEvolutionCandidateNoChangePreview,
  buildEvolutionCandidateRejectedPreview,
} from "../streaming/previews.ts";
import {
  deliverActivatedPresentation,
  deliverActivatedRecoveryPresentation,
  deliverCandidateNoChangePresentation,
  deliverCandidateRejectedPresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
} from "../streaming/terminal-presentation.ts";
import type { CapabilityEvolutionOutcome } from "./evolution-run.ts";

export interface ExplicitEvolutionPresentation {
  readonly active: CapabilityRow;
  readonly intentText: string;
  readonly job: BuildJob;
  readonly send: SendBuildEvent;
  readonly canPresent: () => boolean;
  readonly isAborted: () => boolean;
  readonly database: PlatformDatabase["readonly"];
  readonly recordMetrics: RecordMetrics;
}

async function presentActivated(
  input: ExplicitEvolutionPresentation,
  activation: Extract<CapabilityEvolutionOutcome, { kind: "activated" }>,
): Promise<BuildPipelineCompletion> {
  if (!input.canPresent()) return undefined;
  const commit = activation.commit;
  const delivered = await deliverActivatedPresentation(
    input.send,
    JSON.stringify(buildCommitPreview(commit, activation.assembly.behavioralTierTransition)),
    renderCachedCapabilityCommitSwap(commit.row, commit.previousLabel),
    undefined,
    JSON.stringify(input.recordMetrics.get(input.job.id, input.active.incarnation_id)),
  );
  if (!delivered) await deliverActivatedRecoveryPresentation(input.send);
  return "terminal-sent";
}

export async function presentEvolutionOutcome(
  input: ExplicitEvolutionPresentation,
  outcome: CapabilityEvolutionOutcome,
): Promise<BuildPipelineCompletion> {
  if (outcome.kind === "activated") {
    if (input.isAborted()) {
      if (!input.canPresent()) return undefined;
      await deliverActivatedRecoveryPresentation(input.send);
      return "terminal-sent";
    }
    return presentActivated(input, outcome);
  }

  const restoration = renderRestorationFragment(input.job.restoration, input.database);
  if (outcome.kind === "cancelled") {
    if (input.canPresent()) {
      await deliverRestoredPresentation(input.send, restoration, "cancelled");
    }
    return "terminal-sent";
  }
  if (!input.canPresent()) return undefined;
  await deliverCandidateNoChangePresentation(
    input.send,
    JSON.stringify(
      buildEvolutionCandidateNoChangePreview(
        input.active,
        input.intentText,
        outcome.candidate,
        outcome.diff,
      ),
    ),
    restoration,
    JSON.stringify(input.recordMetrics.get(input.job.id, input.active.incarnation_id)),
  );
  return "terminal-sent";
}

export async function presentEvolutionFailure(
  input: ExplicitEvolutionPresentation,
  error: unknown,
): Promise<BuildPipelineCompletion> {
  const lifecycle = input.recordMetrics.get(input.job.id, input.active.incarnation_id);
  if (lifecycle?.lifecycleStatus === "success" && lifecycle.outcome === "activated") {
    if (!input.canPresent()) return undefined;
    await deliverActivatedRecoveryPresentation(input.send);
    return "terminal-sent";
  }
  if (!input.canPresent()) return undefined;

  const restoration = renderRestorationFragment(input.job.restoration, input.database);
  if (input.isAborted()) {
    await deliverRestoredPresentation(input.send, restoration, "cancelled");
    return "terminal-sent";
  }
  if (error instanceof CandidateValidationError) {
    await deliverCandidateRejectedPresentation(
      input.send,
      JSON.stringify(
        buildEvolutionCandidateRejectedPreview(input.active, input.intentText, error.issues),
      ),
      restoration,
    );
    return "terminal-sent";
  }
  await deliverFailedPresentation(
    input.send,
    error,
    restoration,
    undefined,
    JSON.stringify(input.recordMetrics.get(input.job.id, input.active.incarnation_id)),
  );
  return "terminal-sent";
}
