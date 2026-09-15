import { intentResolutionMetrics } from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { MutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import { renderRefusedPrompt } from "../../../server/http/fragments.ts";
import type { Send } from "../../../server/sse/index.ts";
import type { BuildPipelineCompletion } from "../../jobs/build-jobs.ts";
import { type RestorationDescriptor, renderRestorationFragment } from "../../jobs/restoration.ts";
import { type RecordMetrics, rememberResolverRow } from "../../metrics-recorder.ts";
import { deliverRestoredPresentation } from "../../streaming/terminal-presentation.ts";
import { deflectionNarration } from "./deflection.ts";
import type { PromptResolutionMemory } from "./resolved-request.ts";

export interface DeflectionPipelineInput {
  readonly generationId: string;
  /**
   * What was typed. A refusal that finds an answer window standing names it; one that finds none
   * is said on the prompt bar and the words go unused (PLAN decision 31).
   */
  readonly prompt: string;
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
  prompt,
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
  rememberResolverRow(mutationCoordinator, recordMetrics, () => metrics);
  if (!canPresent()) return;

  await send("metrics-preview", JSON.stringify(metrics));
  const saying = narration ?? deflectionNarration(resolution.intent);
  /* A sentence Aluna could make nothing of is the one deflection that may land somewhere other
   * than the prompt bar: the desk puts it in the answer window standing beside it, so a stale
   * answer is not left speaking for a question nobody asked (PLAN decision 31). Where no window
   * stands, the desk places it on the bar, which is the only surface the other deflections have. */
  const refused = resolution.intent.type === "reject";
  const fragment = renderRestorationFragment(
    restoration,
    buildDatabases.readonly,
    refused ? undefined : saying,
    preserveActiveView ? "preserve" : "replace",
    // A deflection restating what is already on the desk never starts a build, so the prompt bar
    // speaks and flashes it (PLAN decision 24). Unused by a refusal, which carries its own frame
    // above and may not land on the bar at all.
    "refusal",
  );
  // Its own frame: the desk cancels the swap of whatever frame carries a refusal, and a capability
  // riding the same one would be swallowed with it rather than put back.
  if (refused) await send("fragment", renderRefusedPrompt(prompt, saying));
  await deliverRestoredPresentation(
    send,
    fragment,
    resolutionOutcome === "cancelled" ? "cancelled" : "ok",
    terminalPresenterTimeoutMs,
  );
  return "terminal-sent";
}
