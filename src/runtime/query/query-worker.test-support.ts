// A worker's views for a suite about the worker or the scope alone. Not a test file itself, so bun
// never runs it; production always hands the catalog's views (`question-views.ts`).

import { sqlIdentifier } from "../../platform/persistence/sql-identifier.ts";
import type { QueryShadow } from "./query-worker.ts";
import { QUESTION_DESK_SCHEMA } from "./question-views.ts";

/** No views at all: every table the file holds reads as nothing. */
export const NO_SHADOW: QueryShadow = Object.freeze({ schema: QUESTION_DESK_SCHEMA, views: [] });

/** `tables` shown whole, every column as stored, for a suite whose subject is not the views. */
export function wholeTables(...tables: string[]): QueryShadow {
  const view = (table: string) =>
    `CREATE TEMP VIEW ${sqlIdentifier(table)} AS SELECT * FROM ${QUESTION_DESK_SCHEMA}.${sqlIdentifier(table)}`;
  return { schema: QUESTION_DESK_SCHEMA, views: tables.map(view) };
}
