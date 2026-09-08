// The loop: 6.3/01's turn, repeated until the model answers or its reads run out (PLAN decisions
// 5, 8, 9, 15; ADR-0008). Every result goes back to the model and it chooses again, so an empty
// result and a failed statement are ordinary turns rather than retry branches. Ten reads is a guess
// a real question never approaches; bytes are the second budget, in `question-payload.ts`.
//
// Nothing on this path arms a wall-clock deadline (decision 9); `question-loop.test.ts` pins the
// absence by warping every clock years forward, watching a whole budget finish, then sweeping ten
// files. Waiting is a cost the user accepts; freezing was the liveness bug, which epic 6.2 fixed by
// moving execution into a worker. The one clock that does bound a question is ADR-0003's
// five-minute per-generation deadline, inherited because the SDK leaves handles pending on a fault.
//
// The sentence a person reads is Aluna's (decision 15, ADR-0001), in `question-narration.ts`.
//
// An answered question costs one generation more than it took reads: `question-answer.ts` writes
// what she found, out of the steps alone. It runs no statement, so it spends no read (decision 8).

import { runQuestionAnswer } from "./question-answer.ts";
import type { QuestionStep, QuestionTurn, QuestionTurnDeps } from "./question-turn.ts";
import { runQuestionTurn } from "./question-turn.ts";

/**
 * How many reads one question gets (decision 8). Not injectable: a budget a caller could
 * lower is a budget no test proves, and this number is the one 6.6/04 goes on to measure.
 */
export const QUESTION_STEP_BUDGET = 10;

/** How a question stopped reading. */
export type QuestionEnding = "answered" | "budget_spent";

/**
 * What the loop hands back, in two shapes: a spent budget is the one ending that must not produce
 * an answer, so it hands back a count instead of the rows and nothing downstream has the choice.
 */
export type QuestionLoopResult =
  | {
      readonly ending: "answered";
      readonly steps: readonly QuestionStep[];
      /** What she says she found, written from those steps and from nothing else (decision 4). */
      readonly answer: string;
    }
  | { readonly ending: "budget_spent"; readonly stepsTaken: number };

export interface QuestionLoopInput {
  /** What the user asked, in their own words. */
  readonly question: string;
  /**
   * Called with each step as it completes, so a caller can watch the loop without the result
   * carrying rows past a spent budget. 6.5/03 streams the narration through this seam.
   */
  readonly onStep?: (step: QuestionStep) => void;
}

/**
 * Run the model's chosen steps in sequence, feeding each result back, until it answers or the
 * budget is spent. Rejects only for what ends a question outright: cancellation, a closing gate,
 * and an answer that came back as a shape nobody can be told.
 */
export async function runQuestionLoop(
  deps: QuestionTurnDeps,
  input: QuestionLoopInput,
): Promise<QuestionLoopResult> {
  const steps: QuestionStep[] = [];

  const turn = (): Promise<QuestionTurn> =>
    runQuestionTurn(deps, { question: input.question, steps, budget: QUESTION_STEP_BUDGET });

  // The scope lends the answer its cancellation and nothing else. Handing the whole of `deps`
  // over would hand over `scope.read`, and the answer would be able to go and fetch the rows.
  // The catalog is still held while these words are written, which is what keeps a deletion able
  // to end the question (decision 13); releasing first would leave the generation unstoppable.
  const answered = async (): Promise<QuestionLoopResult> => ({
    ending: "answered",
    steps,
    answer: await runQuestionAnswer(
      { provider: deps.provider, signal: deps.scope.signal },
      { question: input.question, steps },
    ),
  });

  while (steps.length < QUESTION_STEP_BUDGET) {
    const next = await turn();
    if (next.kind === "answer") return await answered();
    if (next.kind === "spent") return { ending: "budget_spent", stepsTaken: steps.length };
    steps.push(next.step);
    input.onStep?.(next.step);
  }

  // The budget counts reads, not turns, so the tenth read's result is worth one more decision;
  // bounding turns would leave a question needing exactly ten reads unanswerable.
  const last = await turn();
  if (last.kind === "answer") return await answered();
  return { ending: "budget_spent", stepsTaken: steps.length };
}
