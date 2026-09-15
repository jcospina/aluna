// Which failures a turn hands back to the model as a step, and which end the question.
//
// Declared here rather than as a chain inside the turn, so the person adding a fifth refusal to
// this path finds the set by its name. The distinction is not about severity: it is about whether
// a differently written statement would fix it. A statement the model can rewrite costs it one of
// its ten reads; a database that is not answering costs the question, because *rewrite your SQL*
// at a dead connection burns the whole budget on nothing.
//
// `QueryWorkerConnectionError` is deliberately outside, and so is everything unrecognised.

import { CapabilityDataValidationError } from "../data/index.ts";
import { QueryWorkerStatementError } from "./query-worker.ts";
import {
  EmptyCatalogQueryError,
  WholeCatalogQueryStatementError,
} from "./whole-catalog-query-scope.ts";

/** Every failure that is the statement's rather than the connection's, by the type carrying it. */
const THE_STATEMENT_S: readonly (new (...args: never[]) => Error)[] = [
  QueryWorkerStatementError,
  WholeCatalogQueryStatementError,
  CapabilityDataValidationError,
  EmptyCatalogQueryError,
];

/**
 * What a failed step says to the model, or `undefined` for a failure that ends the question
 * rather than becoming one of its steps.
 */
export function questionStatementFault(error: unknown): string | undefined {
  const fault = THE_STATEMENT_S.some((kind) => error instanceof kind);
  return fault && error instanceof Error ? error.message : undefined;
}
