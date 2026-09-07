// The ephemeral whole-catalog read path: the worker SQL runs in, the scope that owns the
// catalog for the length of one question, and the one tool a question is offered.

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
  QUESTION_TOOLS,
  type QuestionParameter,
  type QuestionTool,
  type QuestionToolCall,
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
  type QuestionTurnDeps,
  type QuestionTurnInput,
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
