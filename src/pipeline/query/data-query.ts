// Where a classified `data_query` becomes a read (PLAN decision 5, ADR-0008).
//
// The resolver already classifies `data_query` and has since Module 2; until now that
// classification only ever reached `deflectionNarration`'s *I can't answer across your
// things yet*. This is the seam where it stops being a deflection: the intent opens
// 6.2/02's whole-catalog scope, one turn runs inside it, and the scope closes.
//
// **It lives in the pipeline, not the runtime**, because it is the one thing on this path
// that needs an `IntentClassification`. `src/runtime/query/` owns the tool, the turn, the
// scope and the worker, and knows nothing about how a prompt was classified — the same
// direction every other dependency in this repo runs.
//
// **One turn, and the scope closes behind it.** 6.3/02 turns the single
// `runQuestionTurn` below into a bounded loop over the same scope; nothing else about this
// function changes when it does. There is deliberately no step budget, no deadline and no
// retry here — a turn that failed is a result the model reads, and reading it is the loop's
// job rather than this one's.
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
  buildQuestionTurnPrompt,
  type QueryWorker,
  type QuestionStep,
  runQuestionTurn,
  scopedCapabilitySpecs,
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
}

export interface DataQueryTurn {
  readonly step: QuestionStep;
  /**
   * The prompt the model would be handed next, with this step's result already in it.
   *
   * This is what *the result reaching the model* means concretely, and it is returned
   * rather than left implicit so a test can hold it. 6.3/02 stops returning it and starts
   * generating against it.
   */
  readonly nextPrompt: string;
}

/**
 * Open the whole-catalog scope for one classified question and take one turn in it.
 *
 * Throws `NotADataQuestionError` for any other intent, `ReadGateUnavailableError` when the
 * complete token set cannot be acquired, and whatever ended the question when one is
 * cancelled. A statement that merely failed is not a throw — it comes back inside `step`.
 */
export async function runDataQueryTurn(
  deps: DataQueryDeps,
  input: DataQuestion,
): Promise<DataQueryTurn> {
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
    async (scope) => {
      const step = await runQuestionTurn(
        { provider: deps.provider, scope, database },
        { question: input.question },
      );
      return {
        step,
        nextPrompt: buildQuestionTurnPrompt({
          question: input.question,
          specs: scopedCapabilitySpecs(scope.catalog, scope.incarnations),
          steps: [step],
        }),
      };
    },
  );
}
