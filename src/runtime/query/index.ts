// The ephemeral whole-catalog read path: the worker SQL runs in, the scope that owns the catalog
// for the length of one question, the one tool a question is offered, the size cap that refuses a
// result too large to send back, the bounded loop that repeats a turn until the model answers or
// its ten reads are spent, the sentences Aluna says while it runs, and the answer she writes at
// the end, out of what the loop's steps returned.
//
// What crosses this boundary is small on purpose, and the rule is positive rather than a list of
// exceptions: the loop and the scope it runs in, the sentences a person reads, the one number a
// caller measures, and the handful of names a suite outside this directory has to say out loud —
// the three prompt prefixes a fake provider recognizes a call by, the budget, and the worker.
// Everything else — the prompt rules, the schemas, the byte counters, the table bound, the plan
// reader, the error classes — is this directory's own, and is imported from its own file next
// door. A name that leaves here is one somebody outside could call; there is nothing out there
// that should be weighing a payload or admitting a statement.

export { createQueryWorker, type QueryWorker } from "./query-worker.ts";
export { QUESTION_ANSWER_PROMPT_PREFIX } from "./question-answer.ts";
export {
  QUESTION_STEP_BUDGET,
  type QuestionLoopResult,
  questionStepsTaken,
  runQuestionLoop,
} from "./question-loop.ts";
export {
  QUESTION_BUDGET_SPENT_SENTENCE,
  QUESTION_COULD_NOT_FINISH,
  QUESTION_NOTHING_FOUND,
  questionLabelNarration,
  questionNoHomeSentence,
  questionResultSentence,
  questionStepNarration,
} from "./question-narration.ts";
export { QUESTION_NO_HOME_PROMPT_PREFIX } from "./question-no-home.ts";
export type { QuestionStep } from "./question-step.ts";
export { type QuestionDecision, READ_ONLY_QUERY_TOOL } from "./question-tool.ts";
export {
  QUESTION_OPEN_WINDOW_HEADING,
  QUESTION_TURN_PROMPT_PREFIX,
} from "./question-turn-prompt.ts";
export {
  WholeCatalogReadCancelledError,
  withWholeCatalogReadScope,
} from "./whole-catalog-read-scope.ts";
