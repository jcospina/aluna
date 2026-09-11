// Where a classified `data_query` becomes a read (PLAN decision 5, ADR-0008).
//
// A question stops being a deflection here: the intent opens 6.2/02's whole-catalog scope, the
// bounded loop runs inside it, and the scope closes. What a person sees of it is
// `question-pipeline.ts`, which narrates this into the answer window (6.5/03).
//
// It lives in the pipeline rather than the runtime because it is the one thing on this path that
// needs an `IntentClassification`; `src/runtime/query/` owns the tool, the turn, the scope and
// the worker.
//
// The scope closes on every ending — an answer, a spent budget, a cancellation, a throw — because
// `withWholeCatalogReadScope` releases in its own `finally` (decision 11). There is deliberately
// no deadline here and none in the loop, and this is the seam a convenience one would enter by.

import { dbReadonly, type PlatformDatabase } from "../../platform/persistence/db.ts";
import type { Provider } from "../../platform/provider/index.ts";
import type { ActiveCatalogReader } from "../../registry/index.ts";
import type { ReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import {
  type QueryWorker,
  type QuestionLoopResult,
  type QuestionStep,
  runQuestionLoop,
  withWholeCatalogReadScope,
} from "../../runtime/query/index.ts";
import type { IntentClassification } from "../intent/index.ts";

/** A prompt the resolver classified as something other than a question about saved data. */
export class NotADataQuestionError extends Error {
  override readonly name = "NotADataQuestionError";
}

export interface DataQueryDeps {
  readonly provider: Provider;
  readonly readGates: ReadGateCoordinator;
  /** Where the catalog snapshot and the table bound's `EXPLAIN` are read. */
  readonly database?: PlatformDatabase["readonly"];
  readonly readActiveCatalog?: ActiveCatalogReader;
  readonly createWorker?: () => QueryWorker;
}

export interface DataQuestion {
  readonly intent: IntentClassification;
  /** The prompt bar text, in the person's own words. */
  readonly question: string;
  /**
   * Each step as it completes, so a caller can watch the loop without the result having to
   * carry the rows past a spent budget. Threaded straight through to the loop's own seam.
   */
  readonly onStep?: (step: QuestionStep) => void;
  /**
   * The person giving up on this question — they asked something else, or dismissed the answer
   * (PLAN decision 10) — arriving as this job's cancellation and reaching the scope's one entry
   * point. Asked for rather than optional, `undefined` and all: what it stops is a worker
   * mid-statement, which no test reaching this through a route can stage, so a caller that
   * quietly stopped passing it would leave every test green.
   */
  readonly signal: AbortSignal | undefined;
}

/**
 * Opens the whole-catalog scope for a classified question and runs the loop inside it. Throws
 * `NotADataQuestionError`, `ReadGateUnavailableError`, `QuestionAnswerUnreadableError` or a
 * cancellation; a failed statement is none of them.
 */
export async function runDataQuery(
  deps: DataQueryDeps,
  input: DataQuestion,
): Promise<QuestionLoopResult> {
  if (input.intent.type !== "data_query") {
    throw new NotADataQuestionError(
      `Only a data_query opens a read scope; this prompt was classified ${input.intent.type}.`,
    );
  }
  const database = deps.database ?? dbReadonly;

  // The scope creates nothing (decision 2): no registry row, version, artifact, cache or thread.
  // The same question asked twice opens two scopes and runs twice.
  return await withWholeCatalogReadScope(
    {
      readGates: deps.readGates,
      database,
      readActiveCatalog: deps.readActiveCatalog,
      createWorker: deps.createWorker,
    },
    async (scope) => {
      // The raiser 6.2/03 left for 6.5/04. The gate's trigger is wired inside the scope; the
      // person's two are wired here, and all three call the same `cancel()`. Nothing else stops
      // a question: a synchronous statement in the worker cannot be asked to stop, only killed.
      const abandon = () => {
        scope.cancel();
      };
      if (input.signal?.aborted) abandon();
      input.signal?.addEventListener("abort", abandon, { once: true });
      try {
        return await runQuestionLoop(
          { provider: deps.provider, scope, database },
          { question: input.question, ...(input.onStep ? { onStep: input.onStep } : {}) },
        );
      } finally {
        // Off before the scope releases, so a job cancelled after its own question ended cannot
        // reach back into a scope that is already over.
        input.signal?.removeEventListener("abort", abandon);
      }
    },
  );
}
