// The ephemeral whole-catalog read path: the worker SQL runs in, the scope that owns the
// catalog for the length of one question, the one tool a question is offered, the size cap
// that refuses a result too large to send back, the bounded loop that repeats a turn until the
// model answers or its ten reads are spent, the sentences Aluna says while it runs, and the
// answer she writes at the end, out of what the loop's steps returned.

export {
  createQueryWorker,
  type QueryWorker,
  QueryWorkerBusyError,
  QueryWorkerClosedError,
  QueryWorkerConnectionError,
  QueryWorkerError,
  type QueryWorkerRow,
  QueryWorkerStatementError,
  type QueryWorkerValue,
} from "./query-worker.ts";
// The answer's rules are not re-exported, for the reason `QUESTION_STEP_LABEL_HINTS` is not: they
// are what the *model* is told. The prefix is, because a fake provider outside recognizes the call,
// and so is the shape, because such a provider has to produce one.
export {
  QUESTION_ANSWER_NOTHING_MATCHED,
  QUESTION_ANSWER_PROMPT_PREFIX,
  type QuestionAnswerWritten,
  questionAnswerSchema,
} from "./question-answer.ts";
export {
  QUESTION_STEP_BUDGET,
  type QuestionEnding,
  type QuestionLoopInput,
  type QuestionLoopResult,
  runQuestionLoop,
} from "./question-loop.ts";
export {
  QUESTION_BUDGET_SPENT_SENTENCE,
  QUESTION_COULD_NOT_FINISH,
  QUESTION_NO_HOME_FOR_THAT,
  QUESTION_NOTHING_FOUND,
  QUESTION_NOTHING_FOUND_ANYWHERE,
  QUESTION_NOTHING_WORKED,
  questionEndingNarration,
  questionLabelNarration,
  questionNoHomeSentence,
  questionNothingFoundSentence,
  questionResultSentence,
  questionStepNarration,
} from "./question-narration.ts";
// The gap's rules, its schema, its catalog checks and the call that runs them are not re-exported,
// for the reason the answer's rules are not. The prefix is, because a fake provider outside
// recognizes the call. `questionSubjectInTheirWords` is not: its callers are next door.
export { QUESTION_NO_HOME_PROMPT_PREFIX } from "./question-no-home.ts";
// The plan reader, `questionFoundNothing` and `questionOpenedACollection` are not re-exported:
// their callers are next door in this directory, and this barrel is what `src/server/` reaches for.
export { type QuestionStepPlan, questionStepMatchedRows } from "./question-nothing-found.ts";
export {
  QUESTION_PAYLOAD_BUDGET_SPENT,
  QUESTION_RESULT_PAYLOAD_BUDGET_BYTES,
  QUESTION_STATEMENT_TOO_LARGE,
  QUESTION_STEP_RESULT_CAP_BYTES,
  QUESTION_STEP_RESULT_TOO_LARGE,
  questionPayloadBytes,
  questionPayloadRefusal,
  questionRenderedBytes,
  questionStatementRefusal,
  renderQuestionRows,
} from "./question-payload.ts";
// `QUESTION_STEP_LABEL_HINTS` is deliberately not re-exported: it is what the *model* is told
// a label means, and this barrel is what `src/server/` reaches for.
export {
  QUESTION_DECISIONS,
  QUESTION_STEP_LABELS,
  QUESTION_TOOLS,
  type QuestionDecision,
  type QuestionNextStep,
  type QuestionParameter,
  type QuestionTool,
  type QuestionToolCall,
  questionDecisionSchema,
  questionParameterSchema,
  questionToolCallSchema,
  READ_ONLY_QUERY_TOOL,
  theOnlyQuestionTool,
} from "./question-tool.ts";
export {
  buildQuestionTurnPrompt,
  QUESTION_OPEN_WINDOW_HEADING,
  QUESTION_OPEN_WINDOW_RULES,
  QUESTION_TURN_PROMPT_PREFIX,
  type QuestionPromptContext,
  type QuestionStep,
  type QuestionStepResult,
  type QuestionTurn,
  type QuestionTurnDeps,
  type QuestionTurnInput,
  questionPayloadSpent,
  questionStepBytes,
  runQuestionTurn,
} from "./question-turn.ts";
export {
  assertWholeCatalogQuery,
  capabilityQuerySpec,
  EmptyCatalogQueryError,
  scopedCapabilitySpecs,
  type WholeCatalogQueryPlan,
  WholeCatalogQueryStatementError,
  wholeCatalogQueryScope,
} from "./whole-catalog-query-scope.ts";
export {
  WholeCatalogReadCancelledError,
  type WholeCatalogReadScope,
  type WholeCatalogReadScopeDeps,
  withWholeCatalogReadScope,
} from "./whole-catalog-read-scope.ts";
