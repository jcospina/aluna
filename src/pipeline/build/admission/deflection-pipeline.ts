import { intentResolutionMetrics } from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { MutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import type { Send } from "../../../server/sse/index.ts";
import type { BuildPipelineCompletion } from "../../jobs/build-jobs.ts";
import { type RestorationDescriptor, renderRestorationFragment } from "../../jobs/restoration.ts";
import { type RecordMetrics, writeResolverOnlyMetrics } from "../../metrics-recorder.ts";
import { deliverRestoredPresentation } from "../../streaming/terminal-presentation.ts";
import { deflectionNarration } from "./deflection.ts";
import type { PromptResolutionMemory } from "./resolved-request.ts";

export interface DeflectionPipelineInput {
  readonly generationId: string;
  readonly resolution: PromptResolutionMemory;
  readonly recordMetrics: RecordMetrics;
  readonly send: Send;
  readonly isAborted: () => boolean;
  readonly canPresent: () => boolean;
  readonly mutationCoordinator: MutationCoordinator;
  readonly restoration: RestorationDescriptor;
  readonly buildDatabases: PlatformDatabase;
  readonly terminalPresenterTimeoutMs: number;
  readonly narration?: string;
  readonly preserveActiveView?: boolean;
}

/** Record best-effort resolver metrics and narrate the warm non-build outcome. */
export async function streamDeflection({
  generationId,
  resolution,
  recordMetrics,
  send,
  isAborted,
  canPresent,
  mutationCoordinator,
  restoration,
  buildDatabases,
  terminalPresenterTimeoutMs,
  narration,
  preserveActiveView,
}: DeflectionPipelineInput): Promise<BuildPipelineCompletion> {
  const resolutionOutcome = isAborted() ? "cancelled" : "completed";
  const metrics = intentResolutionMetrics({
    promptJobId: generationId,
    outcome: resolutionOutcome,
    resolver: resolution.resolver,
  });
  void mutationCoordinator
    .withPlatformWrite(() => writeResolverOnlyMetrics(recordMetrics, metrics))
    .catch((error) => {
      console.error(
        "Aluna resolver metrics write did not complete:",
        error instanceof Error ? error.message : error,
      );
    });
  if (!canPresent()) return;

  await send("metrics-preview", JSON.stringify(metrics));
  const fragment = renderRestorationFragment(
    restoration,
    buildDatabases.readonly,
    narration ?? deflectionNarration(resolution.intent),
    preserveActiveView ? "preserve" : "replace",
    // A deflection — a refused prompt, or one restating what is already on the desk — never
    // starts a build, so the prompt bar speaks and flashes it (PLAN decision 24).
    "refusal",
  );
  await deliverRestoredPresentation(
    send,
    fragment,
    resolutionOutcome === "cancelled" ? "cancelled" : "ok",
    terminalPresenterTimeoutMs,
  );
  return "terminal-sent";
}
