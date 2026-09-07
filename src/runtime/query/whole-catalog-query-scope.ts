// Which tables one question's statement may open (PLAN decision 6).
//
// This is the *other* half of the word **scope** on this path, and it is not ownership.
// `whole-catalog-read-scope.ts` owns the read tokens for the length of a question;
// `CapabilityQueryScope` bounds the tables a single statement may read, and decision 6 says
// the existing machinery generalises without change: `assertScopedQuery` enumerates the
// tables an `EXPLAIN` says a statement actually opens rather than matching strings, so "a
// whole-catalog scope is simply one whose dependencies are every other active incarnation".
// That is what this module builds, and it is what `query-worker-thread.ts` recorded as the
// loop's to wire up — the worker bounds the statement to its own *file*, and nothing there
// bounds it to the catalog's *tables*.
//
// **It is a table bound, never the safety seam.** A mutation is not looked at here at all:
// `INSERT`/`UPDATE`/`DELETE`/`REPLACE` pass straight through and fail where decision 6 says
// they must, at `SQLITE_OPEN_READONLY` inside the worker, with SQLite's own *attempt to
// write a readonly database*. Nothing added here may take that refusal over — a classifier
// standing in front of a structural seam is a seam that can be reasoned around replacing
// one that cannot, and the issue this module is built for says so in as many words.
//
// Everything the bound *does* look at, it fails closed on. That asymmetry is deliberate and
// it is the only safe direction: a statement this module cannot recognise as one clean read
// is refused rather than waved through, because the worker's own refusals are about its
// *file* and have nothing to say about which of the catalog's tables a read may open. The
// two rules together are what make removing this module cost only the table bound.
//
// **DDL is bounded here rather than at the seam, and that is the safe direction.** Only
// `INSERT`/`UPDATE`/`DELETE`/`REPLACE` are passed through, so a bare `DROP TABLE` or
// `CREATE TABLE` is refused by the bound instead of by `SQLITE_OPEN_READONLY`. Widening the
// pass-through to every non-read looks tidier and is not safe: `(SELECT id FROM
// capability_registry)` returns rows and begins with neither keyword, so a bound that
// decided what to skip by leading keyword would be exactly one paren wide. Both refusals
// reach the model as an ordinary failed step, no DDL statement can return a row to a caller
// on a `query_only` connection, and removing this module still leaves every write failing
// in the worker — so what the narrower pass-through costs is which refusal fires first, and
// what fail-closed buys is that there is one at all.
//
// **This reuses `assertScopedQuery`, not `CapabilityQueryPort.all()`.** Decision 6 names
// `all()` as the half of the port a question reuses, and epic 6.2 made that impossible in
// the letter: `all()` executes on a main-thread `Database`, and execution moved into a
// Worker. What is reused is the part decision 6 was actually pointing at — the scope shape
// and its `EXPLAIN` enumeration — and the part it was ruling out stays ruled out: a question
// returns rows, never `records()`' rehydrated handles. Two things ride on the divergence and
// are worth knowing before debugging one of them. The worker's connection has no
// `platform_search_normalize` (6.2/01 measured why registering it there segfaults), so a
// statement filtering text the way a generated search does fails with *no such function*.
// And nothing projects a declared result descriptor, so a question's columns come back as
// SQLite typed them rather than as a `CapabilityQueryResultColumn` said they would.
//
// **The `EXPLAIN` runs on the main thread, and that is affordable.** It prepares the
// statement and lists its opcodes; it never steps it, so its cost is the size of the
// program rather than the size of the data — which is the cost epic 6.2 moved off this
// thread. `explainOpcodes` finalizes, so it leaves no statement pinning the shared
// connection's read snapshot.
//
// **The nominated target is the first incarnation the gate granted, and it is a formality.**
// `CapabilityQueryScope` has one target because a Handler has one; a question has none. Left
// alone, that shape would have carried `assertScopedQuery`'s column protection onto that one
// arbitrary capability and no other — `extra`, and every field the user had retired, readable
// on all the rest. The `wholeCatalog` option widens the protection to `[target,
// ...dependencies]` and refuses a virtual table outright, so which incarnation the gate
// happens to name first changes nothing a question can read. The Handler path keeps exactly
// the bound it had; the option is off by default.

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
 * Something about the statement itself is wrong — it is malformed, it names a column or a
 * table that does not exist, or its `?` count does not match the values it carries. Carried
 * as its own type so the turn returns it to the model rather than ending the question:
 * taking the table bound is not a second opinion about whether the statement is valid, it
 * is the same statement failing one step earlier than it would have in the worker.
 */
export class WholeCatalogQueryStatementError extends Error {
  override readonly name = "WholeCatalogQueryStatementError";
}

/**
 * SQLite's result codes for *the statement*, as opposed to the connection carrying it.
 *
 * `SQLITE_ERROR` (a parse failure, an unknown column or table) and `SQLITE_READONLY` — the
 * seam's own refusal of a write — are the two that matter here; the rest round out the set
 * of codes that say the statement was wrong rather than that the database was. Everything
 * absent is a fault of the connection: busy, locked, out of memory, interrupted, an I/O
 * error, a corrupt image, a file that is not a database. Those must never be dressed up as
 * *rewrite your SQL*, because a loop told that about a corrupt database rewrites its query
 * until its budget runs out, against something no query was ever going to fix.
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
 * The statement forms decision 6 requires to reach the SQLite seam.
 *
 * `assertScopedQuery` returns early for exactly these, and this module names them rather
 * than leaning on that: a mutation must fail at `SQLITE_OPEN_READONLY` inside the worker,
 * with SQLite's own *attempt to write a readonly database*, so that safety here is
 * structural and never a classifier's. Everything else — a `CREATE`, a statement behind a
 * comment, a form SQLite does not recognise — goes through the bound below and is refused
 * if it is not one clean read. Failing *closed* on the unrecognised case is the whole
 * point: a bound that skipped what it did not recognise would let a `SELECT` behind a
 * leading block comment past — the worker runs it happily, because it is an ordinary read
 * of the worker's own file — and the catalog bound would be one comment wide.
 *
 * This is not a second seam. Remove every line of this module and a mutation still fails
 * in the worker; what would be lost is only the table bound.
 */
const REACHES_THE_SQLITE_SEAM = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;

/**
 * Quoted literals and comments, so a keyword inside one is never mistaken for SQL. Mirrors
 * `SQL_LITERALS_AND_COMMENTS` in `query-worker-thread.ts` rather than importing it: that
 * module installs a `self.onmessage` handler at its own module scope, so importing a value
 * from it would pull the worker's body onto the main thread.
 *
 * It is applied only to decide the pass-through above. A commented mutation must still
 * reach the seam — the whole claim is that safety does not depend on anything here reading
 * SQL correctly, and a mutation refused by *this* module because it wore a comment is a
 * mutation the seam never got to refuse. It is deliberately not applied to the bound
 * itself, which goes on failing closed on anything that does not look like one clean read.
 */
const SQL_LITERALS_AND_COMMENTS =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|--[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * The specs the gate granted, in the gate's canonical order.
 *
 * Ordered by `incarnations` rather than by the catalog's own array so the nominated target
 * is the one the gate names first, which is stable across a snapshot read. A capability in
 * the catalog that the gate did not grant is not in scope and is not read — though
 * `withWholeCatalogReadScope` grants the complete set or nothing, so today the two agree.
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

/**
 * The whole-catalog `CapabilityQueryScope`, or `undefined` when the granted set is empty.
 */
export function wholeCatalogQueryScope(
  specs: readonly CapabilitySpec[],
): CapabilityQueryScope | undefined {
  const [target, ...dependencies] = specs;
  if (!target) return undefined;
  // No `signal`. `CapabilityQueryScope` carries one and `assertScopedQuery` never reads it —
  // only `createCapabilityQueryPort` does — so threading the question's signal in here would
  // read as an ownership check that does not happen. The check that does happen is
  // `assertQuestionLive` in `whole-catalog-read-scope.ts`, on both sides of the read.
  return { target, dependencies };
}

/**
 * Refuse a read that reaches outside this question's snapshot, and admit one that reads
 * across every capability inside it. Everything it throws is something the turn returns to
 * the model as an ordinary failed step: `CapabilityDataValidationError` from the shared
 * check, `WholeCatalogQueryStatementError` for a statement SQLite would not prepare, and
 * `EmptyCatalogQueryError` when there is nothing in scope to read at all.
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
  // `allowTargetId` because a question is not a Handler: it may count records and group by
  // one, and the record handle a Handler is protected into using has no meaning here — a
  // question returns rows, never records (decision 6, `all()` and never `records()`).
  // `wholeCatalog` because the nominated target is an artefact of the scope's shape, not a
  // capability this question cares about more than the others.
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
 * Let SQLite refuse a statement it will not parse, and refuse a `?` count that does not
 * match the values beside it, before the bound goes looking for the tables it opens.
 *
 * The arity half is the one that had to be written by hand. Binding the wrong number of
 * values is the single likeliest mistake a model makes with a parameterized tool, and Bun
 * reports it as a plain `Error` — not a `SQLiteError` — so it travelled straight past every
 * classification below and ended the question outright. Counting `paramsCount` turns it
 * into a sentence the model can act on, in both directions: too few values, and too many,
 * which SQLite is otherwise content to ignore.
 *
 * Finalized for the reason `explainOpcodes` is: an unreset statement holds open the
 * implicit read transaction the next one opens, and `dbReadonly` is shared by every
 * concurrent read on the main thread.
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
 * A failure the model should read, or the original — which ends the question.
 *
 * A `CapabilityDataValidationError` is the bound's own refusal and is already addressed to
 * whoever wrote the statement. A `SQLiteError` is only the statement's if its result code
 * says so; a busy, corrupt or unreachable database is not something a better query fixes.
 * Anything else is a fault in this code and is left alone.
 */
function asStatementFault(error: unknown): unknown {
  if (error instanceof CapabilityDataValidationError) return error;
  if (error instanceof SQLiteError && isStatementFault(error.errno)) {
    return new WholeCatalogQueryStatementError(error.message);
  }
  return error;
}
