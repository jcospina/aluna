// The ephemeral whole-catalog read path: the worker SQL runs in, the scope that owns the
// catalog for the length of one question, the one tool a question is offered, the size cap
// that refuses a result too large to send back, and the bounded loop that repeats a turn
// until the model answers or its ten reads are spent.

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
export {
  QUESTION_BUDGET_SPENT_SENTENCE,
  QUESTION_STEP_BUDGET,
  type QuestionEnding,
  type QuestionLoopInput,
  type QuestionLoopResult,
  questionEndingNarration,
  runQuestionLoop,
} from "./question-loop.ts";
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
export {
  QUESTION_DECISIONS,
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
  EmptyCatalogQueryError,
  scopedCapabilitySpecs,
  WholeCatalogQueryStatementError,
  wholeCatalogQueryScope,
} from "./whole-catalog-query-scope.ts";
export {
  WholeCatalogReadCancelledError,
  type WholeCatalogReadScope,
  type WholeCatalogReadScopeDeps,
  withWholeCatalogReadScope,
} from "./whole-catalog-read-scope.ts";
