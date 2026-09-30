// Where a whole-catalog read executes: a Worker thread, so a clumsy join cannot freeze the desk
// (ADR-0008, decisions 6 and 7). The one documented database file is attached `mode=ro` under a
// schema name no read can name, beside an empty in-memory `main` (Module 7 decision 37).
//
// The thread is handed that name and the temp views to read the catalog through, written on the
// main thread (`question-views.ts`). Every other table or view the file holds is shadowed by an
// empty view, and SQLite's own tables resolve to `main`'s empty ones, so an unqualified name reads
// a view or nothing. The table bound prepares every read on a connection where the schema does
// not exist, and a write it lets through fails `mode=ro` before anything is read.
//
// Read-only means *cannot write this database*, which is narrower than it reads: measured on Bun
// 1.3.12, `VACUUM INTO`, `CREATE TEMP TABLE` and `ATTACH DATABASE` each escaped it. `PRAGMA
// query_only` and the `NOT_A_READ` refusals below close all three. This thread holds no token.

import { Database } from "bun:sqlite";

/**
 * Every value SQLite carries through this thread. `bigint` is absent deliberately: `safeIntegers`
 * is off, so an integer past 2^53 arrives rounded and `bigint` would promise precision it lacks.
 */
export type QueryWorkerValue = string | number | boolean | null | Uint8Array;

/** One row of a whole-catalog read: aliased columns, never a record handle. */
export type QueryWorkerRow = Readonly<Record<string, QueryWorkerValue>>;

/** What the worker is told at birth: the schema to attach the file as, and the views over it. */
export interface QueryShadow {
  readonly schema: string;
  readonly views: readonly string[];
}

export type QueryWorkerRequest =
  | {
      readonly kind: "open";
      readonly id: number;
      readonly path: string;
      readonly shadow: QueryShadow;
    }
  | {
      readonly kind: "read";
      readonly id: number;
      readonly sql: string;
      readonly parameters: readonly QueryWorkerValue[];
    };

/**
 * Which half of the read failed: `statement` is what a differently written statement would fix,
 * `connection` is not. Drawn here because SQLite's result code cannot cross structured clone.
 */
export type QueryWorkerFault = "statement" | "connection";

export type QueryWorkerResponse =
  | { readonly kind: "opened"; readonly id: number }
  | { readonly kind: "rows"; readonly id: number; readonly rows: readonly QueryWorkerRow[] }
  | {
      readonly kind: "failed";
      readonly id: number;
      readonly message: string;
      readonly fault: QueryWorkerFault;
    };

/**
 * Statement forms that leave this connection's own file behind. Mirrors and extends the tail of
 * `RAW_MUTATION_SQL_PATTERN` rather than importing it — that module pulls in the TS compiler.
 * `ANALYZE` is added, because it writes `sqlite_stat1`; `TRUNCATE` is left out, having no
 * statement form in SQLite.
 */
const NOT_A_READ =
  /^\s*(?:ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE|SAVEPOINT|RELEASE|BEGIN|COMMIT|END|ROLLBACK)\b/i;

/** Quoted literals and comments, so a `;` or a keyword inside one is never mistaken for SQL.
 * Mirrored in `whole-catalog-query-scope.ts` for the reason above, and pinned against it. */
const SQL_LITERALS_AND_COMMENTS =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|--[^\n]*|\/\*[\s\S]*?\*\//g;

declare const self: Worker;

let connection: Database | undefined;

self.onmessage = (event: MessageEvent) => {
  const request = event.data as QueryWorkerRequest;
  try {
    self.postMessage(handle(request));
  } catch (error) {
    // A refused or failed statement is an answer, not a crash: it travels back as a message
    // so the main thread can reject that one read while the thread stays open for the next.
    self.postMessage({
      kind: "failed",
      id: request.id,
      // Not the shared `errorMessage`: this file is copied beside the bundle and run directly,
      // so a relative import would not resolve there (`scripts/build.ts`).
      message: error instanceof Error ? error.message : String(error),
      fault: faultOf(error),
    } satisfies QueryWorkerResponse);
  }
};

function handle(request: QueryWorkerRequest): QueryWorkerResponse {
  if (request.kind === "open") {
    connection = open(request.path, request.shadow);
    return { kind: "opened", id: request.id };
  }

  if (!connection) {
    throw new NoConnection("The query worker has no connection open.");
  }
  assertOneReadStatement(request.sql);

  // `prepare` rather than `query`: `query` caches the compiled statement, and a question's SQL is
  // asked once, so the cache could only grow. Finalizing keeps the thread's memory flat.
  const statement = connection.prepare<QueryWorkerRow, QueryWorkerValue[]>(request.sql);
  try {
    return { kind: "rows", id: request.id, rows: statement.all(...request.parameters) };
  } finally {
    statement.finalize();
  }
}

/**
 * SQLite's result codes for the statement rather than the connection. `SQLITE_READONLY` is among
 * them, since decision 6's own refusal of a write is something the model should see. Mirrored
 * from `whole-catalog-query-scope.ts`, which names each one, and pinned against it there: this
 * file is copied beside the bundle and run directly, so it may import nothing.
 */
const STATEMENT_RESULT_CODES: ReadonlySet<number> = new Set([1, 8, 18, 19, 20, 21, 23, 25]);

function faultOf(error: unknown): QueryWorkerFault {
  if (error instanceof RefusedStatement) return "statement";
  if (error instanceof NoConnection) return "connection";
  const errno = (error as { errno?: unknown } | null)?.errno;
  // Bun reports a `?`/value count mismatch as a plain `Error` with no code, and that is the
  // statement's problem. An unrecognised failure costs the model a step; ending costs the question.
  if (typeof errno !== "number") return "statement";
  return STATEMENT_RESULT_CODES.has(errno) ? "statement" : "connection";
}

/** One of this thread's own guard refusals: something a different statement would fix. */
class RefusedStatement extends Error {
  override readonly name = "RefusedStatement";
}

/** There is nothing to run the statement on. No statement fixes that. */
class NoConnection extends Error {
  override readonly name = "NoConnection";
}

/**
 * The SQLite runtime is pinned by the main thread before this one exists and inherited here;
 * `configureSqliteRuntime()` loads once per process and throws `SQLite already loaded` from here.
 */
function open(path: string, { schema, views }: QueryShadow): Database {
  const opened = new Database(":memory:");
  // The contention allowance the platform's own connections carry (db.ts): WAL keeps this reader
  // off the writer's back, and the wait absorbs the brief lock a checkpoint takes, ATTACH's too.
  opened.exec("PRAGMA busy_timeout = 5000;");
  // Bounds a temp table by RAM rather than free disk, should `query_only` ever admit one. Set
  // before the views, because changing it drops every temp object.
  opened.exec("PRAGMA temp_store = MEMORY;");
  const uri = `file:${path.split("/").map(encodeURIComponent).join("/")}?mode=ro`;
  opened.run("ATTACH DATABASE ? AS ?", [uri, schema]);
  for (const view of views) opened.exec(view);
  // No view can be named `sqlite_*`, so `main` gets empty ones of its own to resolve first.
  opened.exec("ANALYZE main;");
  opened.exec(
    "CREATE TABLE main.sequenced (n INTEGER PRIMARY KEY AUTOINCREMENT); DROP TABLE main.sequenced;",
  );
  for (const statement of statementsOver(opened, UNVIEWED, schema)) opened.exec(statement);
  // A view is compiled when it is read, so a column the table lacks fails here, at open.
  for (const statement of statementsOver(opened, COMPILED)) opened.prepare(statement).finalize();
  opened.exec("PRAGMA query_only = ON;");
  // `platform_search_normalize` is per-connection and unregistered here: a question filtering text
  // fails with *no such function*. On darwin, registering it is refused: this thread knows no
  // pinned library path, so the ABI the extension would compile against cannot be checked.
  return opened;
}

/** An empty view for every table or view in the file that has none. */
const UNVIEWED = `SELECT printf('CREATE TEMP VIEW "%w" AS SELECT NULL AS "nothing" WHERE 0', name) AS statement
  FROM pragma_table_list WHERE schema = ? AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
  AND lower(name) NOT IN (SELECT lower(name) FROM pragma_table_list WHERE schema = 'temp')`;

/** A read of every temp view, so each is compiled. */
const COMPILED = `SELECT printf('SELECT * FROM temp."%w" LIMIT 0', name) AS statement
  FROM pragma_table_list WHERE schema = 'temp' AND type = 'view'`;

function statementsOver(connection: Database, sql: string, ...parameters: string[]): string[] {
  const statement = connection.prepare<{ statement: string }, string[]>(sql);
  try {
    return statement.all(...parameters).map((row) => row.statement);
  } finally {
    statement.finalize();
  }
}

function assertOneReadStatement(sql: string): void {
  const body = sql.replace(SQL_LITERALS_AND_COMMENTS, " ");
  const refused = NOT_A_READ.exec(body);
  if (refused) {
    throw new RefusedStatement(
      `The query worker refuses ${refused[0].trim().toUpperCase()}: it reads.`,
    );
  }
  // SQLite compiles only the first statement of a multi-statement string and silently drops the
  // rest, so anything after the first would be validated by a later gate and never run.
  if (body.replace(/;\s*$/, "").includes(";")) {
    throw new RefusedStatement("The query worker runs one statement at a time.");
  }
}
