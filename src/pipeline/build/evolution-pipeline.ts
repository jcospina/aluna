// Route one resolver-classified existing-capability change through the platform's
// single evolution engine and the explicit foreground presenter.

import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { CarriedResolverMeasurement } from "../../metrics/index.ts";
import type { MutationCoordinator } from "../../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../../persistence/db.ts";
import type { Provider, TokenUsage } from "../../provider/index.ts";
import { type CapabilityRow, getCapability } from "../../registry/index.ts";
import { runCapabilityEvolution } from "../evolution/evolution-run.ts";
import {
  presentEvolutionFailure,
  presentEvolutionOutcome,
} from "../evolution/explicit-presentation.ts";
import type { BuildPipelineCompletion, BuildPipelineContext } from "../jobs/build-jobs.ts";
import type { RecordMetrics } from "../metrics-recorder.ts";

export interface ResolvedEvolutionPipelineInput extends BuildPipelineContext {
  readonly active: CapabilityRow;
  readonly intent: IntentClassification;
  readonly resolver: CarriedResolverMeasurement & { readonly usage: TokenUsage };
  readonly provider: Provider;
  readonly recordMetrics: RecordMetrics;
  readonly buildDatabases: PlatformDatabase;
  readonly artifactsRoot: string;
  readonly mutationCoordinator: MutationCoordinator;
}

export async function streamResolvedEvolution(
  input: ResolvedEvolutionPipelineInput,
): Promise<BuildPipelineCompletion> {
  const reservation = input.mutationCoordinator.reserveBuild();
  const presentation = {
    active: input.active,
    intentText: input.job.prompt,
    job: input.job,
    send: input.send,
    canPresent: input.canPresent,
    isAborted: input.isAborted,
    database: input.buildDatabases.readonly,
    recordMetrics: input.recordMetrics,
  };

  try {
    return await input.mutationCoordinator.withBuildLease(
      reservation,
      async () => {
        const current = getCapability(input.active.id, input.buildDatabases.readonly);
        if (
          current?.incarnation_id !== input.active.incarnation_id ||
          current.version !== input.active.version
        ) {
          throw new Error("Selected capability changed before its evolution began.");
        }
        const outcome = await runCapabilityEvolution({
          active: current,
          intentText: input.job.prompt,
          resolvedIntent: input.intent,
          resolver: input.resolver,
          provider: input.provider,
          buildId: input.job.id,
          database: input.buildDatabases,
          artifactsRoot: input.artifactsRoot,
          recordMetrics: input.recordMetrics,
          send: input.send,
          isAborted: input.isAborted,
        });
        return presentEvolutionOutcome(presentation, outcome);
      },
      input.signal ? { signal: input.signal } : {},
    );
  } catch (error) {
    return presentEvolutionFailure(presentation, error);
  }
}
