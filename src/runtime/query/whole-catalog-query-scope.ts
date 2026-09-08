// Which tables one question's statement may open (PLAN decision 6).
//
// This is the other half of the word *scope* on this path, and it is not ownership.
// `whole-catalog-read-scope.ts` owns the read tokens for the length of a question; this bounds
// the tables one statement may read, by enumerating what an `EXPLAIN` says it opens rather than
// by matching strings. It is a table bound, never the safety seam: a mutation passes straight
// through and fails at `SQLITE_OPEN_READONLY`, so removing this module costs only the table bound.
//
// What is reused is `assertScopedQuery`, not `CapabilityQueryPort.all()`, which executes on the
// main-thread `Database` epic 6.2 moved away from. So the worker's connection has no
// `platform_search_normalize` — `query-worker-thread.ts` says what that costs — and nothing
// projects a result descriptor, so columns come back as SQLite typed them.

import { SQLiteError } from "bun:sqlite";

import type { PlatformDatabase } from "../../platform/persistence/db.ts";
import {
  type ActiveRegistryCatalog,
  type CapabilitySpec,
  capabilitySpecFromRow,
} from "../../registry/index.ts";
import type { CapabilityIncarnation } from "../concurrency/read-gates.ts";
import {
  assertScopedQuery,
  CapabilityDataValidationError,
  type CapabilityQueryParameter,
  type CapabilityQueryScope,
} from "../data/index.ts";

/** A question asked of a desk that holds nothing to read. */
export class EmptyCatalogQueryError extends Error {
  override readonly name = "EmptyCatalogQueryError";
}

/**
 * Something about the statement itself is wrong — malformed, naming a column or table that does
 * not exist, a `?` count that does not match. Its own type so the turn returns it to the model.
 */
export class WholeCatalogQueryStatementError extends Error {
  override readonly name = "WholeCatalogQueryStatementError";
}

/**
 * SQLite's result codes for *the statement*, as opposed to the connection carrying it. Everything
 * absent is the connection's fault, and *rewrite your SQL* about one burns a loop's whole budget.
 */
const STATEMENT_RESULT_CODES: ReadonlySet<number> = new Set([
  1, // SQLITE_ERROR
  8, // SQLITE_READONLY
  18, // SQLITE_TOOBIG
  19, // SQLITE_CONSTRAINT
  20, // SQLITE_MISMATCH
  21, // SQLITE_MISUSE
  23, // SQLITE_AUTH
  25, // SQLITE_RANGE
]);

/** Whether this SQLite failure is about the statement the model wrote. */
export function isStatementFault(errno: unknown): boolean {
  return typeof errno === "number" && STATEMENT_RESULT_CODES.has(errno);
}

/**
 * The forms decision 6 requires to reach the SQLite seam, named so a mutation fails structurally.
 * Everything else is refused unless one clean read, or the bound would be one block comment wide.
 */
const REACHES_THE_SQLITE_SEAM = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;

/**
 * Quoted literals and comments, so a keyword inside one is never mistaken for SQL. Mirrored from
 * `query-worker-thread.ts`, whose import would pull its body here; used only for the pass-through.
 */
const SQL_LITERALS_AND_COMMENTS =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|--[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * The specs the gate granted, in the gate's canonical order — by `incarnations` rather than the
 * catalog's array, so the nominated target is stable across a snapshot read.
 */
export function scopedCapabilitySpecs(
  catalog: ActiveRegistryCatalog,
  incarnations: readonly CapabilityIncarnation[],
): readonly CapabilitySpec[] {
  const rows = new Map(catalog.capabilities.map((row) => [row.incarnation_id, row]));
  return incarnations
    .map(({ incarnationId }) => rows.get(incarnationId))
    .filter((row) => row !== undefined)
    .map(capabilitySpecFromRow);
}

/** The whole-catalog `CapabilityQueryScope`, or `undefined` when the granted set is empty. */
export function wholeCatalogQueryScope(
  specs: readonly CapabilitySpec[],
): CapabilityQueryScope | undefined {
  const [target, ...dependencies] = specs;
  if (!target) return undefined;
  // No `signal`: only `createCapabilityQueryPort` reads the one `CapabilityQueryScope` carries,
  // so threading it here would read as an ownership check that does not happen.
  return { target, dependencies };
}

/**
 * Refuse a read reaching outside this question's snapshot, and admit one across every capability
 * inside it. Everything it throws, the turn returns to the model as an ordinary failed step.
 */
export function assertWholeCatalogQuery(
  database: PlatformDatabase["readonly"],
  specs: readonly CapabilitySpec[],
  sql: string,
  parameters: readonly CapabilityQueryParameter[],
): void {
  if (REACHES_THE_SQLITE_SEAM.test(sql.replace(SQL_LITERALS_AND_COMMENTS, " "))) return;
  const scope = wholeCatalogQueryScope(specs);
  if (!scope) {
    throw new EmptyCatalogQueryError(
      "There is nothing to read: this question's scope holds no collections.",
    );
  }
  assertStatementIsWellFormed(database, sql, parameters);
  // `allowTargetId` because a question may count records and group by one; `wholeCatalog` because
  // the nominated target is an artefact of the scope's shape rather than a chosen capability.
  try {
    assertScopedQuery(database, scope, sql, parameters, {
      allowTargetId: true,
      wholeCatalog: true,
    });
  } catch (error) {
    throw asStatementFault(error);
  }
}

/**
 * Refuse a statement SQLite will not parse, and a `?` count that does not match: Bun reports arity
 * as a plain `Error`, so it ended the question. Finalized, or it pins shared `dbReadonly`'s read.
 */
function assertStatementIsWellFormed(
  database: PlatformDatabase["readonly"],
  sql: string,
  parameters: readonly CapabilityQueryParameter[],
): void {
  let expected: number;
  try {
    const statement = database.prepare(`EXPLAIN ${sql}`);
    expected = (statement as unknown as { paramsCount: number }).paramsCount;
    statement.finalize();
  } catch (error) {
    throw asStatementFault(error);
  }
  if (expected !== parameters.length) {
    throw new WholeCatalogQueryStatementError(
      `The statement has ${expected} ? placeholder${expected === 1 ? "" : "s"} but ${parameters.length} parameter${parameters.length === 1 ? "" : "s"} were given.`,
    );
  }
}

/**
 * A failure the model should read, or the original — which ends the question. A `SQLiteError` is
 * the statement's only if its result code says so; anything else is a fault in this code.
 */
function asStatementFault(error: unknown): unknown {
  if (error instanceof CapabilityDataValidationError) return error;
  if (error instanceof SQLiteError && isStatementFault(error.errno)) {
    return new WholeCatalogQueryStatementError(error.message);
  }
  return error;
}
