// The loop 6.3/01's turn is repeated by (PLAN decisions 5, 8, 9, 15; ADR-0008).
//
// **A real loop, not a fixed pipeline** (decision 5). There is no read-the-vocabulary →
// map-the-words → compute sequence with a retry branch bolted to the side. Each turn's
// result — rows, an empty result, a failed statement — goes back to the model and it chooses
// again, so the question nobody anticipated is handled by the same machinery as the one
// everybody did. An empty result and a failure are ordinary turns here precisely because a
// pipeline would have had to grow a branch for each of them.
//
// **Ten steps** (decision 8). Capabilities in this PoC are simple and the questions asked of
// them are simple, so the budget is deliberately one a real question never approaches. It is
// a guess, and decision 33 is what will tell us whether it was generous or tight; 6.6/04
// records the number a real question actually used.
//
// **A question has a second budget, and it is not counted in reads** (decision 12). Ten
// steps bound how many times the model may look; `QUESTION_RESULT_PAYLOAD_BUDGET_BYTES`
// bounds how much those looks may put into the conversation — rows, statements and bound
// values alike — because the prompt re-renders every prior step into every later turn and ten
// small reads and ten large ones are not the same question. Both numbers and both refusals live in `question-payload.ts`, and the
// turn checks them; a refused step is an ordinary step here, spending one read and going
// back to the model to be narrowed.
//
// **No timeout** (decision 9), which is the absence of code rather than any code here. No
// file on this path — this one, `question-turn.ts`, `question-tool.ts`, `question-payload.ts`,
// the two scopes, the worker and its thread, `data-query.ts` — arms a timer, reads a clock or
// holds a deadline, and `question-loop.test.ts` pins that twice: it warps every clock forward
// by years across a whole budget and watches the loop finish anyway, and it sweeps all nine
// files for the constructs a deadline is built from. Slow is allowed: waiting is a product cost the user
// accepts, and freezing — the thing that actually mattered — was a liveness bug epic 6.2
// fixed structurally by moving execution into a worker. What ends a question early is a
// cancellation, never a clock: `question-turn.ts` wraps the provider in the scope's signal so
// even a generation that never settles is ended by the question ending, rather than parking
// the loop and holding the catalog with it.
//
// **One clock does still bound a question, and it is not this path's.** Every AI call in the
// product carries ADR-0003's per-generation stage deadline
// (`DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS`, five minutes), because the SDK leaves its handles
// permanently pending on a transport fault and something has to settle them. A question
// inherits it once per generation. It is recorded here rather than removed: taking it away
// without putting something in its place trades a bounded wait for an unbounded one that
// holds the whole catalog, and which of those decision 9 wants is a decision for whoever owns
// ADR-0003, not a detail of this loop. The issue's findings carry it.
//
// **A spent budget says so, and never answers half.** The two endings are not the same
// shape, and that is the point: `answered` carries the steps, and `budget_spent` carries only
// how many there were. 6.4 writes an answer out of a `QuestionLoopResult`, so a spent budget
// hands it nothing to write one from — half the expenses summed with the confidence of a
// whole total is the failure this module has no table left to expose.
//
// The claim is about this type and no more than this type. `onStep` below hands every row to
// whoever is watching, on every ending, because a live surface has to narrate a question
// while it runs; a caller determined to assemble a total out of what it observed can still do
// it. What the shape buys is that the default path cannot: the thing an answer is written
// from arrives without the material, so composing one takes a second, deliberate source.
//
// **The sentence is Aluna's, not the model's** (decision 15, ADR-0001). It is authored here
// and switched on a closed set, the same shape `deflectionNarration` uses in
// `src/pipeline/build/admission/deflection.ts`, so the model cannot narrate its own failure
// and no machinery can leak into the words. 6.3/04 brings the per-step narration alongside
// it, and its sign-off gate reads this sentence too.

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
 * What the loop hands back.
 *
 * Deliberately two different shapes. The rows a question read are the raw material an answer
 * is written from, and a spent budget is the one ending that must not produce an answer, so
 * it hands back a count rather than the material. Nothing downstream has to remember the
 * rule, because nothing downstream is given the choice.
 */
export type QuestionLoopResult =
  | { readonly ending: "answered"; readonly steps: readonly QuestionStep[] }
  | { readonly ending: "budget_spent"; readonly stepsTaken: number };

/**
 * The sentence Aluna says when she ran out of reads.
 *
 * Product voice (ADR-0001): first person, addressed to the user, warm and plainspoken. It
 * carries no step count, no SQL, no table name, no column and no error string — decision 15
 * — and it makes a claim about her own looking rather than about the user's data, which is
 * the same honesty rule decision 17 applies to a zero result. Read at 6.3/04's sign-off.
 */
export const QUESTION_BUDGET_SPENT_SENTENCE =
  "I looked at this a few different ways and still couldn't get there. I'd rather tell you that than guess — try asking me another way?";

/**
 * What the platform says about an ending, or `null` when it has nothing of its own to say.
 *
 * `answered` is the null case on purpose: the words for what she *found* are written from
 * the steps in 6.4, and a placeholder sentence here would be the platform answering a
 * question it did not read.
 */
export function questionEndingNarration(ending: QuestionEnding): string | null {
  switch (ending) {
    case "answered":
      return null;
    case "budget_spent":
      return QUESTION_BUDGET_SPENT_SENTENCE;
  }
}

export interface QuestionLoopInput {
  /** What the user asked, in their own words. */
  readonly question: string;
  /**
   * Called with each step as it completes, so a caller can watch the loop without the result
   * having to carry the rows past a spent budget. 6.5/03 streams the narration through this
   * seam; today the developer-gated exercise watches through it.
   */
  readonly onStep?: (step: QuestionStep) => void;
}

/**
 * Run the model's chosen steps in sequence, feeding each result back to it, until it answers
 * or the budget is spent.
 *
 * Rejects only for what already ended the question in one turn — a cancellation, a closing
 * gate, a worker that will not answer. A failed statement and an empty result are steps like
 * any other and the loop carries on with them.
 */
export async function runQuestionLoop(
  deps: QuestionTurnDeps,
  input: QuestionLoopInput,
): Promise<QuestionLoopResult> {
  const steps: QuestionStep[] = [];

  const turn = (): Promise<QuestionTurn> =>
    runQuestionTurn(deps, { question: input.question, steps, budget: QUESTION_STEP_BUDGET });

  while (steps.length < QUESTION_STEP_BUDGET) {
    const next = await turn();
    if (next.kind === "answer") return { ending: "answered", steps };
    if (next.kind === "spent") return { ending: "budget_spent", stepsTaken: steps.length };
    steps.push(next.step);
    input.onStep?.(next.step);
  }

  // The budget counts reads, not turns, so the tenth read's result is worth one more decision.
  // Bounding turns instead would spend a read the model is never shown, and a question that
  // needed exactly ten of them could never be answered — it would fail holding the answer.
  // Nothing can extend the question from here: the prompt says there are no reads left, and
  // `runQuestionTurn` refuses to execute a read once the budget is gone, so a decision that
  // asks for one anyway comes back as `spent` rather than as an eleventh statement.
  const last = await turn();
  if (last.kind === "answer") return { ending: "answered", steps };
  return { ending: "budget_spent", stepsTaken: steps.length };
}
