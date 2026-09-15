// The loop: 6.3/01's turn, repeated until the model answers or its steps run out (PLAN decisions
// 5, 8, 9, 15; ADR-0008). Every result goes back to the model and it chooses again, so an empty
// result and a failed statement are ordinary turns rather than retry branches. Ten steps is a guess
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
// An answered question costs one generation more than it took steps: `question-answer.ts` writes
// what she found, out of the steps alone. It runs no statement, so it spends no read (decision 8).
// A question that matched no rows costs none: nothing-found is the platform's own sentence. So is
// the gap, bar the one call that names what there is nowhere for, in this person's own words.

import { runQuestionAnswer } from "./question-answer.ts";
import { QUESTION_NOTHING_WORKED, questionNothingFoundSentence } from "./question-narration.ts";
import { runQuestionNoHome } from "./question-no-home.ts";
import { questionFoundNothing, questionReadSomething } from "./question-nothing-found.ts";
import type { QuestionStep, QuestionTurn, QuestionTurnDeps } from "./question-turn.ts";
import { runQuestionTurn } from "./question-turn.ts";

/**
 * How many steps one question gets (decision 8). Not injectable: a budget a caller could
 * lower is a budget no test proves, and this number is the one 6.6/04 goes on to measure.
 */
export const QUESTION_STEP_BUDGET = 10;

/** How a question stopped reading. */
export type QuestionEnding =
  | "answered"
  | "nothing_found"
  | "nothing_worked"
  | "no_home"
  | "budget_spent";

/**
 * What the loop hands back, in two shapes: a spent budget is the one ending that must not produce
 * an answer, so it hands back a count instead of the rows and nothing downstream has the choice.
 */
export type QuestionLoopResult =
  | {
      /** The endings that speak. Nothing-found is not found-nothing, and neither is a question
       * whose every statement failed: she never searched, so she may not report a search. Nor is
       * either of them the gap, which is about the desk rather than about one search of it. */
      readonly ending: "answered" | "nothing_found" | "nothing_worked" | "no_home";
      readonly steps: readonly QuestionStep[];
      /** What she says she found, written from those steps and from nothing else (decision 4). */
      readonly answer: string;
    }
  | { readonly ending: "budget_spent"; readonly stepsTaken: number };

/**
 * How many steps a finished question took, off whichever of the two shapes it came back in. A
 * question ended by a cancellation reaches neither, and is counted through `onStep` instead.
 */
export function questionStepsTaken(result: QuestionLoopResult): number {
  return result.ending === "budget_spent" ? result.stepsTaken : result.steps.length;
}

export interface QuestionLoopInput {
  /** What the user asked, in their own words. */
  readonly question: string;
  /**
   * Called with each step as it completes, so a caller can watch the loop without the result
   * carrying rows past a spent budget. 6.5/03 streams the narration through this seam.
   */
  readonly onStep?: (step: QuestionStep) => void;
  /**
   * The capability whose window the question was asked in front of, or null. Carried to every
   * turn and nowhere else: the loop reads the whole catalog whatever is standing (decision 28).
   */
  readonly openCapability: string | null;
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
    runQuestionTurn(deps, {
      question: input.question,
      steps,
      budget: QUESTION_STEP_BUDGET,
      openCapability: input.openCapability,
    });

  // The scope lends the answer its cancellation and nothing else. Handing the whole of `deps`
  // over would hand over `scope.read`, and the answer would be able to go and fetch the rows.
  // The catalog is still held while these words are written, which is what keeps a deletion able
  // to end the question (decision 13); releasing first would leave the generation unstoppable.
  // A question that matched nothing skips all of it: no generation, so nothing to claim in.
  const spoken = async (): Promise<QuestionLoopResult> => {
    if (!questionReadSomething(steps)) {
      return { ending: "nothing_worked", steps, answer: QUESTION_NOTHING_WORKED };
    }
    if (questionFoundNothing(steps)) {
      return { ending: "nothing_found", steps, answer: questionNothingFoundSentence(steps) };
    }
    return {
      ending: "answered",
      steps,
      answer: await runQuestionAnswer(
        { provider: deps.provider, signal: deps.scope.signal },
        { question: input.question, steps },
      ),
    };
  };

  // The gap, or the ending this question truthfully has instead. A search that matched nothing
  // keeps its own (decision 17): that ending is about her search, and this one is about the desk,
  // and the weaker claim is the true one. `runQuestionNoHome` then runs decision 30's two checks
  // against the held catalog. **This is where Module 8 wires its proposal surface when it has
  // one** (decision 20); until then the sentence ships with no control of any kind.
  const named = async (): Promise<QuestionLoopResult> => {
    if (questionFoundNothing(steps)) return await spoken();
    const said = await runQuestionNoHome(
      {
        provider: deps.provider,
        signal: deps.scope.signal,
        catalog: deps.scope.catalog,
        openCapability: input.openCapability,
      },
      input.question,
    );
    return said === null ? await spoken() : { ending: "no_home", steps, answer: said };
  };

  // How a question ends once the model has stopped reading. The gap's own words are settled here
  // rather than in the turn, so the one thing a turn hands back about it stays the decision.
  const stopped = async (
    ending: Exclude<QuestionTurn, { kind: "step" }>,
  ): Promise<QuestionLoopResult> => {
    switch (ending.kind) {
      case "answer":
        return await spoken();
      case "no_home":
        return await named();
      case "spent":
        return { ending: "budget_spent", stepsTaken: steps.length };
      default: {
        const unreachable: never = ending;
        throw new Error(`no ending is written for ${String(unreachable)}`);
      }
    }
  };

  while (steps.length < QUESTION_STEP_BUDGET) {
    const next = await turn();
    if (next.kind !== "step") return await stopped(next);
    steps.push(next.step);
    input.onStep?.(next.step);
  }

  // The budget counts steps, not turns, so the tenth step's result is worth one more decision;
  // bounding turns would leave a question needing exactly ten steps unanswerable.
  const last = await turn();
  if (last.kind !== "step") return await stopped(last);
  return { ending: "budget_spent", stepsTaken: steps.length };
}
