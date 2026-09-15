// What one step of a question is, and what one turn decided — the shapes every other module on
// this path passes around.
//
// A leaf that imports no value at all, so the prompt builder, the payload counters, the plan
// reader, the loop and the answer can each hold a step without importing one another. The cycle
// the turn and the plan reader used to close is a structure now rather than a comment.

import type { QueryWorkerRow } from "./query-worker.ts";
import type { QuestionToolCall } from "./question-tool.ts";

/** What a statement's plan says it would hand back having matched nothing at all. */
export type QuestionStepPlan =
  /** It aggregates nothing, so it hands back a row only for a row it matched. */
  | { readonly empty: "no rows" }
  /** It aggregates, and these are the answers of its figures that are not `NULL` over nothing. */
  | { readonly empty: "one row"; readonly answers: readonly (string | number)[] }
  /** Nothing the platform can read a result against, so it makes no promise about a zero. */
  | { readonly empty: "unreadable" };

/** The plan of a statement that never reached one, and of a read the bound refused outright. */
export const NO_PLAN: QuestionStepPlan = Object.freeze({ empty: "unreadable" });

/** The rows one step produced, or why it produced none. */
export type QuestionStepResult =
  | { readonly outcome: "rows"; readonly rows: readonly QueryWorkerRow[] }
  | { readonly outcome: "failed"; readonly message: string };

/**
 * One tool call and what came back, or `null` for a decision this turn could not take: one that
 * would not parse, or one whose statement was too large to carry into a prompt (decision 12).
 */
export interface QuestionStep {
  readonly call: QuestionToolCall | null;
  readonly result: QuestionStepResult;
  /**
   * Which collections the statement names, by the label the person gave them — what 6.4/03's
   * restatement says she read. Enumerated off the `EXPLAIN` the table bound already runs, never
   * off the SQL's words, and empty for a statement the bound refused before it opened anything.
   */
  readonly collections: readonly string[];
  /**
   * What the statement would have handed back having matched nothing (6.4/04), read off the same
   * `EXPLAIN` as `collections` so no step's classification is the model's.
   */
  readonly plan: QuestionStepPlan;
}

/** Everything a step carries about its statement rather than about its result. */
export type StatementFacts = Pick<QuestionStep, "collections" | "plan">;

/** What a step says about a statement the bound refused before it read a plan at all. */
export const NO_STATEMENT_FACTS: StatementFacts = Object.freeze({ collections: [], plan: NO_PLAN });

/**
 * What one turn decided. `answer` means the steps so far are enough; `no_home` that nothing here
 * could hold what was asked about (decision 20); `spent` is a read asked for with none left, so
 * the decision is taken and the statement is not run.
 */
export type QuestionTurn =
  | { readonly kind: "step"; readonly step: QuestionStep }
  | { readonly kind: "answer" }
  | { readonly kind: "no_home" }
  | { readonly kind: "spent" };
