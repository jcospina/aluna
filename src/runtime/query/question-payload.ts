// The size cap: a result too large to send back is refused, never trimmed to fit (PLAN decision
// 12, amended by 6.3/03; ADR-0008). Trimming is how a prose answer becomes a lie — half the
// expenses summed with the confidence of a whole total, and decision 3 deleted the table that
// would have exposed it. A refusal costs one read and comes back as words the model can act on.
//
// Two budgets, because one step is not what has to be bounded: every prompt re-renders every prior
// step, so a per-step cap of C admits roughly 55C across ten reads. The question-wide budget weighs
// whole steps — statements and bound values re-render as often as rows do — and is checked before
// a statement runs as well as after, since a failed statement still costs every later prompt.
//
// Neither bounds memory: the worker materializes an over-size read in full and copies it to the
// main thread before anything measures it.

import type { QueryWorkerRow } from "./query-worker.ts";

/**
 * The most one step's rows may be, in bytes of the text the prompt renders. Not injectable, for
 * the reason `QUESTION_STEP_BUDGET` is not: a cap a caller can raise is a cap no test proves.
 */
export const QUESTION_STEP_RESULT_CAP_BYTES = 16 * 1024;

/**
 * The most a whole question may render into its prompts, statements and bound values included.
 * Deliberately less than ten times the per-step cap, so ten reads cannot multiply it out.
 */
export const QUESTION_RESULT_PAYLOAD_BUDGET_BYTES = 64 * 1024;

/**
 * The bytes a piece of prompt text costs, or `Infinity` when it is too large to produce.
 * `JSON.stringify` throws `RangeError: Out of memory` on precisely the result the cap exists for.
 */
export function questionRenderedBytes(render: () => string): number {
  try {
    return Buffer.byteLength(render(), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The exact text a step's rows reach the next prompt as. The prompt builder and the
 * measurement below share it, so what is counted is what is sent.
 */
export function renderQuestionRows(rows: readonly QueryWorkerRow[]): string {
  return JSON.stringify(rows);
}

/** What those rows cost, in UTF-8 bytes. */
export function questionPayloadBytes(rows: readonly QueryWorkerRow[]): number {
  return questionRenderedBytes(() => renderQuestionRows(rows));
}

/**
 * What the model is told when one read returned more than a step may hand back; 6.4 writes what a
 * person reads. No refusal names a size: a digit here is one somebody later puts in a sentence.
 */
export const QUESTION_STEP_RESULT_TOO_LARGE = [
  "That returned too much to read back, so you have none of it.",
  "Nothing was trimmed to fit — a piece of a result would answer the question wrongly.",
  "Write a narrower one: fewer columns, or a WHERE that cuts the rows down.",
  "Or let SQL do the work with count, sum, avg, min, max or GROUP BY, and read again.",
].join(" ");

/**
 * What the model is told when this step would fit alone but the question has no room left, worded
 * for both moments it fires. It offers the answer too: a spent budget has room for nothing.
 */
export const QUESTION_PAYLOAD_BUDGET_SPENT = [
  "This question has no room left to carry that, so you have none of it.",
  "Nothing was trimmed to fit.",
  "What you have already read is still yours.",
  "Aggregate it in SQL with count, sum, avg, min, max or GROUP BY, or narrow it hard —",
  "fewer bound values, a shorter statement, a smaller result.",
  "And if there is nothing smaller left to ask for, answer from what you have.",
].join(" ");

/**
 * What the model is told when the statement and its bound values are more than one step may carry.
 * The only refusal recorded without its call: it cannot be quoted in the prompt that says so.
 */
export const QUESTION_STATEMENT_TOO_LARGE = [
  "That statement and its bound values are more than one step can carry, so it was not run.",
  "Nothing was trimmed to fit.",
  "Write a shorter one — fewer bound values, and a WHERE that names them instead of listing",
  "them — or let SQL do the work with count, sum, avg, min, max or GROUP BY, and read again.",
].join(" ");

/** Whether a statement is more than one step may carry, before it is run or recorded. */
export function questionStatementRefusal(callBytes: number): string | null {
  return callBytes > QUESTION_STEP_RESULT_CAP_BYTES ? QUESTION_STATEMENT_TOO_LARGE : null;
}

/**
 * Why this step cannot go back to the model, or `null` when it can. The caller measures because
 * the caller renders; too big on its own is checked first, being true whatever came before.
 */
export function questionPayloadRefusal(
  rowBytes: number,
  stepBytes: number,
  spentBytes: number,
): string | null {
  if (rowBytes > QUESTION_STEP_RESULT_CAP_BYTES) return QUESTION_STEP_RESULT_TOO_LARGE;
  if (spentBytes + stepBytes > QUESTION_RESULT_PAYLOAD_BUDGET_BYTES) {
    return QUESTION_PAYLOAD_BUDGET_SPENT;
  }
  return null;
}
