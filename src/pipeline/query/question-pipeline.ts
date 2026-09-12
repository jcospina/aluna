// Where a question becomes something a person watches (PLAN decisions 1, 3, 15, 24; ADR-0008).
//
// Three endings arrive here. The loop's own two speak for themselves through the result; the
// third is a throw, and this file owns the sentence for it, because a question that could not be
// finished still speaks in product voice (ADR-0001, ARCH §9.7).
//
// Nothing on this path writes to the desk. The scope creates nothing (`data-query.ts`), and the
// one row a question leaves behind is the resolver measurement every non-build prompt leaves.

import { intentResolutionMetrics } from "../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import type { Provider } from "../../platform/provider/index.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import type { ReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import {
  QUESTION_COULD_NOT_FINISH,
  questionResultSentence,
  questionStepNarration,
} from "../../runtime/query/index.ts";
import { renderAnswerWindowOpening, renderAnswerWindowSaying } from "../../server/http/index.ts";
import type { Send } from "../../server/sse/index.ts";
import type { PromptResolutionMemory } from "../build/admission/resolved-request.ts";
import type { BuildPipelineCompletion } from "../jobs/build-jobs.ts";
import { type RecordMetrics, writeResolverOnlyMetrics } from "../metrics-recorder.ts";
import {
  deliverRestoredPresentation,
  runBoundedTerminalPresentation,
} from "../streaming/terminal-presentation.ts";
import { NotADataQuestionError, runDataQuery } from "./data-query.ts";

export interface QuestionPipelineInput {
  readonly promptJobId: string;
  readonly resolution: PromptResolutionMemory;
  readonly question: string;
  readonly provider: Provider;
  readonly readGates: ReadGateCoordinator;
  readonly recordMetrics: RecordMetrics;
  readonly send: Send;
  readonly isAborted: () => boolean;
  readonly canPresent: () => boolean;
  /**
   * This job's cancellation, which is how the person's own two triggers reach the read scope
   * (PLAN decision 10). `isAborted` answers the same question and cannot be waited on, so the
   * frames are gated by one and the loop is stopped by the other. Required for the reason
   * `DataQuestion.signal` gives: nothing but the compiler notices it going missing.
   */
  readonly signal: AbortSignal | undefined;
  /**
   * The capability standing in the window when this sentence was sent, read off the same
   * restoration the resolver was classified against (PLAN decision 28). Null for a bare desk.
   */
  readonly standing: string | null;
  readonly mutationCoordinator: MutationCoordinator;
  /** Where the catalog and the collections are read. Nothing on this path writes to either. */
  readonly databases: PlatformDatabase;
  readonly terminalPresenterTimeoutMs: number;
}

/**
 * What the platform writes down when a question could not be finished. Exported because the suite
 * that proves a cancelled question writes nothing has to ask about this line by name.
 */
export const COULD_NOT_FINISH_LOG = "Aluna could not finish that question:";

/** The resolver measurement every non-build prompt leaves, written the way a deflection's is. */
function rememberTheResolver(
  input: QuestionPipelineInput,
  outcome: "completed" | "cancelled",
): string {
  const metrics = intentResolutionMetrics({
    promptJobId: input.promptJobId,
    outcome,
    resolver: input.resolution.resolver,
  });
  void input.mutationCoordinator
    .withPlatformWrite(() => writeResolverOnlyMetrics(input.recordMetrics, metrics))
    .catch((error) => {
      console.error(
        "Aluna resolver metrics write did not complete:",
        error instanceof Error ? error.message : error,
      );
    });
  return JSON.stringify(metrics);
}

/**
 * The narration seam. `onStep` is synchronous and a throw from it ends the question, so nothing
 * that can fail happens inside it: the sentence is looked up and written on a chain the ending
 * waits on, and a frame that could not be delivered costs the reader that sentence and no more.
 */
function answerWindowVoice(input: QuestionPipelineInput) {
  let said: Promise<void> = Promise.resolve();
  const say = (saying: () => string): void => {
    said = said
      .then(async () => {
        /* `canPresent` is the socket and `isAborted` is the job: a question cancelled while its
         * last statement runs must not go on narrating into a window the person stopped. */
        if (!input.canPresent() || input.isAborted()) return;
        await input.send("fragment", renderAnswerWindowSaying(saying()));
      })
      .catch((error) => {
        // Not a cancelled question's: the frame failed because the person took the stream away,
        // which is the desk working rather than a fault to explain.
        if (input.isAborted()) return;
        console.error(
          "Aluna could not say that in the answer window:",
          error instanceof Error ? error.message : error,
        );
      });
  };
  return { say, settled: () => said };
}

/**
 * Open the answer window. A stream that is already gone ends the question here rather than by
 * throwing: the generic build failure carries its own reason, and a question may not (decision 15).
 */
async function openTheAnswerWindow(
  input: QuestionPipelineInput,
  metricsPreview: string,
): Promise<boolean> {
  try {
    await input.send("metrics-preview", metricsPreview);
    await input.send("fragment", renderAnswerWindowOpening(input.question));
    return true;
  } catch (error) {
    console.error(
      "Aluna could not open the answer window:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/** The sentence this question ends on, whichever of its three endings it reached. */
async function runToAnEnding(
  input: QuestionPipelineInput,
  say: (saying: () => string) => void,
): Promise<string> {
  try {
    const result = await runDataQuery(
      {
        provider: input.provider,
        readGates: input.readGates,
        database: input.databases.readonly,
      },
      {
        intent: input.resolution.intent,
        standing: input.standing,
        question: input.question,
        onStep: (step) => say(() => questionStepNarration(step.call)),
        signal: input.signal,
      },
    );
    return questionResultSentence(result);
  } catch (error) {
    // A prompt that is not a question reached the one path that only answers questions: that is a
    // wiring mistake, not an ending, and it goes to the pipeline's own failure handling.
    if (error instanceof NotADataQuestionError) throw error;
    // The reason is the platform's to log and never the reader's to be handed: an error string on
    // the desk is decision 15's whole ban. The sentence carries its own causes.
    //
    // A question the person gave up on is not one of those causes: the loop rejects because that
    // is what a cancel does to it, so the log stays quiet (6.5/04: cancelling is not an error).
    if (!input.isAborted()) {
      console.error(COULD_NOT_FINISH_LOG, error instanceof Error ? error.message : error);
    }
    return QUESTION_COULD_NOT_FINISH;
  }
}

/**
 * The window is opened before the loop starts rather than at the first step: the loop's first
 * read costs a generation, and a person who has just pressed the key gets the frame and Aluna's
 * first sentence now (PLAN decision 21).
 */
export async function streamQuestion(
  input: QuestionPipelineInput,
): Promise<BuildPipelineCompletion> {
  const metricsPreview = rememberTheResolver(input, input.isAborted() ? "cancelled" : "completed");
  if (!input.canPresent()) return;

  if (!(await openTheAnswerWindow(input, metricsPreview))) return "terminal-sent";

  const voice = answerWindowVoice(input);
  const ending = await runToAnEnding(input, voice.say);

  // Every step's sentence is on the wire before the ending replaces the last of them.
  await voice.settled();
  if (input.isAborted()) {
    // Stopped, not broken. A person who cancelled their own question is not owed a sentence
    // about it going wrong, so the window keeps the last thing she said and the run ends here.
    // The stream is often already gone with them, and telling a socket nobody is holding that
    // the run ended is a failure the platform would then write down.
    if (input.canPresent()) {
      await runBoundedTerminalPresentation(
        input.send,
        (send) => send("done", "error"),
        input.terminalPresenterTimeoutMs,
      );
    }
    return "terminal-sent";
  }
  await deliverRestoredPresentation(
    input.send,
    renderAnswerWindowSaying(ending),
    "ok",
    input.terminalPresenterTimeoutMs,
  );
  return "terminal-sent";
}
