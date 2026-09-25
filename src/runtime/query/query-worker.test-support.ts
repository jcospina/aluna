// A worker with no views over its tables, for a suite about the worker or the scope alone. Not a
// test file itself, so bun never runs it; production always hands the catalog's shadow.

import type { QueryShadow } from "./query-worker.ts";

export const NO_SHADOW: QueryShadow = Object.freeze({
  tables: [],
  withheld: "",
  filePrefix: "",
  ledgerTable: "",
});
