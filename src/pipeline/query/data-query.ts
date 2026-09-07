// Where a classified `data_query` becomes a read (PLAN decision 5, ADR-0008).
//
// The resolver already classifies `data_query` and has since Module 2; until now that
// classification only ever reached `deflectionNarration`'s *I can't answer across your
// things yet*. This is the seam where it stops being a deflection: the intent opens
// 6.2/02's whole-catalog scope, the bounded loop runs inside it, and the scope closes.
//
// **It lives in the pipeline, not the runtime**, because it is the one thing on this path
// that needs an `IntentClassification`. `src/runtime/query/` owns the tool, the turn, the
// scope and the worker, and knows nothing about how a prompt was classified — the same
// direction every other dependency in this repo runs.
//
// **The whole loop, and the scope closes behind it.** One scope is opened, the loop takes
// as many turns inside it as the model asks for up to its budget, and the scope closes on
// every ending — an answer, a spent budget, a cancellation, a throw — because
// `withWholeCatalogReadScope` releases in its own `finally` (decision 11). There is
// deliberately no deadline here and none in the loop: slow is allowed (decision 9), and this
// is the seam a convenience one would be smuggled into.
//
// **The scope creates nothing** (decision 2). No registry row, no version, no artifact, no
// cache, no persisted read dependency and no conversation thread: the same question asked
// twice opens two scopes and runs twice, and there is nothing in between for the second one
// to find.

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
}

/**
 * Open the whole-catalog scope for one classified question and run the loop inside it.
 *
 * Throws `NotADataQuestionError` for any other intent, `ReadGateUnavailableError` when the
 * complete token set cannot be acquired, and whatever ended the question when one is
 * cancelled. A statement that merely failed is not a throw — it is one of the loop's steps.
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

  return await withWholeCatalogReadScope(
    {
      readGates: deps.readGates,
      database,
      readActiveCatalog: deps.readActiveCatalog,
      createWorker: deps.createWorker,
    },
    (scope) =>
      runQuestionLoop(
        { provider: deps.provider, scope, database },
        { question: input.question, ...(input.onStep ? { onStep: input.onStep } : {}) },
      ),
  );
}
