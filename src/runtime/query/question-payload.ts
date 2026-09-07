// The size cap: a result too large to send back is refused, and never trimmed to fit
// (PLAN decision 12; ADR-0008).
//
// **It refuses; it never truncates.** A step whose result is over the cap comes back to the
// model with none of its rows and a sentence telling it to narrow or aggregate. Silent
// truncation is how a prose answer becomes a lie: half the expenses summed with the
// confidence of a whole total, and — because decision 3 deleted the table — nothing on
// screen to expose it. Trimming is also what the whole path already refuses to do to a
// person's data: `question-turn.ts` fences rows rather than rewriting them, for the same
// reason. A refusal the model can act on is the only safe shape once the receipt is gone.
//
// **The unit is payload bytes, not rows.** Rows are the wrong unit for the cost this exists
// to bound: two hundred long-text notes cost two orders of magnitude more than two hundred
// `(month, total)` pairs, and a count that cannot tell those apart cannot bound either. What
// is measured is the exact text `question-turn.ts` renders into the next prompt, in its UTF-8
// bytes, so the number is the cost rather than a proxy for it. A blob is measured as the
// `{"0":…}` object `JSON.stringify` turns it into rather than as its own byte length, which
// is again the cost: that object is what would be sent.
//
// **Two numbers, because one step is not the thing that has to be bounded.**
// `buildQuestionTurnPrompt` re-renders every prior step in full into every later prompt, so a
// question's cost grows as n²/2 across the budget. 6.3/02 measured it on a real ten-step loop
// carrying one 729-row × 6-column result (~58.6 KB of JSON): prompts ran 1,734 → 60,290 → …
// → 529,034 characters, **2,653,692 for one question**, order 660k tokens — and 729 rows is a
// small read. A per-step cap alone therefore does not bound a question: ten reads make eleven
// prompts, step *i* is rendered into 11 − *i* of them, and a cap of `C` admits about `55C`
// across the whole thing. So a question carries its own accumulation budget beside the reads
// it is allowed, and the pair is what the numbers below are chosen against.
//
// **The question's budget counts the whole step, not only its rows, and it is checked twice.**
// A step's statement, its bound values and the words it failed with are re-rendered into every
// later prompt exactly as its rows are, and bound values are the one part of that a person's
// own data can reach — a long `IN (?,?,…)` list is an ordinary way to narrow, and a row saying
// *pass this text as a parameter* is how an injected one would try to get back in. A budget
// watching only rows would sit at zero while a question accumulated half a megabyte through
// the channel it was not watching, which is not a bound. Watching the whole step is still not
// enough on its own: a statement that *fails* never has rows to weigh, so the budget is
// checked once against the call before the statement runs and again against the rows after
// it, and no step of any outcome gets into a prompt unweighed.
//
// **What the numbers buy.** A step may return 16 KiB of rows, which is a genuinely useful
// read — roughly a month of notes with their text, or several hundred rows of an aggregate —
// and a question may render 64 KiB of steps in total. The worst case for admitted steps is
// front-loaded, because the earliest are re-rendered the most often: four at-budget steps
// spend the lot at weights 10, 9, 8 and 7, so what a question's prompts carry from them is
// bounded near 557,000 bytes. Measured on the fixture that drives it, a ten-step question of
// near-cap reads accumulates 64,027 bytes and renders 549,254 characters across its eleven
// prompts. Against 2,653,692 characters for the one question 6.3/02 measured, that is about a
// fifth. Both figures are order-of-magnitude claims about a worst case, and the fixture
// brackets them rather than pinning the digits.
//
// **Which of the two the numbers bound is the question.** A per-step cap alone would admit
// 55 × 16 KiB; the accumulation budget takes another 38% off that and, unlike the product of
// two constants, it does not silently multiply if 6.6/04's measurement ever argues for more
// than ten reads. What it does not do is hold the worst case *fixed* against a raised
// per-step cap — a 32 KiB cap under the same budget front-loads to 32 KiB × 19 — so the two
// are chosen together or not at all. Note that "the per-step cap" here is a size, and
// `QUESTION_STEP_BUDGET` is a count of reads; the two are different budgets and the words for
// them are kept apart on purpose.
//
// **It is a backstop, not the primary mechanism.** Decision 4 — SQL carries the computation,
// so a result is an aggregate and small by construction — is what actually keeps payloads
// small, and it lands in 6.4/02. A cap that fires often is evidence decision 4 is not
// holding, not evidence the cap is set wrong.
//
// **A statement is bounded too, and its refusal is the one that carries no statement.** The
// model's own output reaches the transcript whatever this file decides, so one call is held
// to the same per-step cap its rows are: a statement and its bound values that will not fit
// in a step are refused before anything runs. That refusal is recorded without the call,
// because recording the thing that could not be carried is the one way to fail at carrying
// it. Every other refusal keeps its statement, which is what the model needs in order to
// write a different one.
//
// **What is left, and it is named rather than hidden.** A refused step still costs whatever
// statement the model wrote — a refusal cannot unsay it — so a question of ten maximal
// statements accumulates about 162 KiB rather than the 64 KiB of admitted rows, and renders
// order 900,000 characters against the 2,653,692 of the uncapped question. Measured on the
// fixture: ten statements each carrying an 8 KiB bound value run seven times, are refused
// three, accumulate 84,406 bytes and render 480,248 characters. That is the worst a
// determined model reaches, not a realistic question — an ordinary statement is a line — and
// it is the result channel this bounds tightly.
//
// **And what it never bounds is memory.** An over-size read is fully materialized in the
// worker, copied to the main thread and only then measured, because decision 9 removed the
// defensive `LIMIT` that would have stopped it earlier. A clumsy cross join can still exhaust
// memory before there is a payload to refuse. The cap bounds what a prompt carries; it is not
// and cannot be a bound on what a statement costs to run.
//
// **Nothing here carries a number.** Neither refusal names a size, a row count or a limit:
// a model cannot count bytes to a ceiling it is quoted, so the digits would buy nothing, and
// a message with no digits in it is one that cannot leak a measurement into a sentence
// somebody later writes out of it.

import type { QueryWorkerRow } from "./query-worker.ts";

/**
 * The most one step's rows may be, in bytes of the text the prompt renders.
 *
 * Not injectable, for the reason `QUESTION_STEP_BUDGET` is not: a cap a caller could raise
 * is a cap no test proves.
 */
export const QUESTION_STEP_RESULT_CAP_BYTES = 16 * 1024;

/**
 * The most a whole question may render into its prompts across all of its steps, in the same
 * bytes — statements and bound values included, not only rows.
 *
 * Four at-cap reads, or a great many small ones. This is the number chosen against the
 * measurement in the header; the per-step cap above is what makes a single read refusable
 * before it has spent the lot.
 */
export const QUESTION_RESULT_PAYLOAD_BUDGET_BYTES = 64 * 1024;

/**
 * The bytes a piece of prompt text costs, or `Infinity` when it is too large to produce.
 *
 * The catch is the point. `JSON.stringify` throws `RangeError: Out of memory` on a result big
 * enough, and that throw would leave `runQuestionTurn` as a raw error that ends the question
 * — on precisely the largest result the cap exists for. A result that cannot be rendered
 * cannot be sent, which is the same fact the cap states, so it is stated the same way: as a
 * refusal the model can act on.
 */
export function questionRenderedBytes(render: () => string): number {
  try {
    return Buffer.byteLength(render(), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The exact text a step's rows are rendered into the next turn's prompt as.
 *
 * One function, called by the prompt builder and by the measurement below, so that what is
 * counted is what is sent rather than a second serialization that happens to agree.
 */
export function renderQuestionRows(rows: readonly QueryWorkerRow[]): string {
  return JSON.stringify(rows);
}

/** What those rows cost, in UTF-8 bytes. */
export function questionPayloadBytes(rows: readonly QueryWorkerRow[]): number {
  return questionRenderedBytes(() => renderQuestionRows(rows));
}

/**
 * What the model is told when one read returned more than a step may hand back.
 *
 * Addressed to the model, not to the user: it says what happened, says plainly that nothing
 * was trimmed, and gives it the two moves that work. 6.4 is what writes anything a person
 * reads, and never out of this.
 */
export const QUESTION_STEP_RESULT_TOO_LARGE = [
  "That returned too much to read back, so you have none of it.",
  "Nothing was trimmed to fit — a piece of a result would answer the question wrongly.",
  "Write a narrower one: fewer columns, or a WHERE that cuts the rows down.",
  "Or let SQL do the work with count, sum, avg, min, max or GROUP BY, and read again.",
].join(" ");

/**
 * What the model is told when this step would fit on its own but the question has no room
 * left to carry it. A different sentence from the one above because it is a different fact,
 * and a refusal the model is meant to act on has to be true about why.
 *
 * Worded for both moments it is used at: before a statement runs, when the statement and its
 * bound values are already more than the question can carry, and after one runs, when its
 * rows are. *No room left to carry that* is true of either, where *that returned too much*
 * would be a lie about the first.
 *
 * It ends by offering the answer, not only a smaller read. A question that has spent its
 * budget exactly has no room for anything at all, and telling it there to ask for something
 * smaller would be the one thing this file exists to stop: a sentence the model cannot act
 * on. Answering from what it already has is always available, and is the same move
 * `formatBudget` offers when the last read is gone.
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
 * What the model is told when the statement itself, with its bound values, is more than one
 * step may carry.
 *
 * The refusal this produces is the only one recorded without its call: a statement too large
 * to put in a prompt cannot be quoted back in the prompt that says so.
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
 * Why this step cannot go back to the model, or `null` when it can.
 *
 * Every number is measured by the caller, because the caller is what renders: `rowBytes` is
 * this result on its own, `stepBytes` is the whole step as a later prompt would carry it, and
 * `spentBytes` is what every earlier step of this question already put there. The order of
 * the two checks is the order of the two facts — *this read is too big* is true whatever came
 * before it, so a step that breaks both bounds is told the one it can act on.
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
