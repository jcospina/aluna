// Where a whole-catalog read executes: a Worker thread holding its own `SQLITE_OPEN_READONLY`
// connection to the one documented database file. `bun:sqlite` is synchronous, so a clumsy join on
// the main thread would freeze the desk for its whole duration; the move is admissible because the
// safety seam survives it (ADR-0008, decisions 6 and 7).
//
// `SQLITE_OPEN_READONLY` means *cannot write this database*, which is narrower than it reads.
// Measured on Bun 1.3.12 against a read-only connection: `VACUUM INTO` wrote a complete copy of the
// catalog, `CREATE TEMP TABLE` spilled 293 MB to disk, and `ATTACH DATABASE` read any other SQLite
// file on the machine. `PRAGMA query_only` and the `NOT_A_READ` refusals below close all three.
//
// They bound the connection to its own file, not which tables — `assertWholeCatalogQuery` does
// that on the main thread. This thread holds no token: a path, a statement, its parameters.

import { Database } from "bun:sqlite";

/**
 * Every value SQLite carries through this thread. `bigint` is absent deliberately: `safeIntegers`
 * is off, so an integer past 2^53 arrives rounded and `bigint` would promise precision it lacks.
 */
export type QueryWorkerValue = string | number | boolean | null | Uint8Array;

/** One row of a whole-catalog read: aliased columns, never a record handle. */
export type QueryWorkerRow = Readonly<Record<string, QueryWorkerValue>>;

export type QueryWorkerRequest =
  | { readonly kind: "open"; readonly id: number; readonly path: string }
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
 * Statement forms that leave this connection's own file behind. Mirrors the tail of
 * `RAW_MUTATION_SQL_PATTERN` rather than importing it — that module pulls in the TS compiler.
 */
const NOT_A_READ = /^\s*(?:ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE)\b/i;

/** Quoted literals and comments, so a `;` or a keyword inside one is never mistaken for SQL. */
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
    connection = open(request.path);
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
 * them, since decision 6's own refusal of a write is something the model should see.
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
function open(path: string): Database {
  const opened = new Database(path, { readonly: true });
  // The contention allowance the platform's own connections carry (db.ts): WAL keeps this reader
  // off the writer's back, and the wait absorbs the brief lock a checkpoint takes.
  opened.exec("PRAGMA busy_timeout = 5000;");
  opened.exec("PRAGMA query_only = ON;");
  // Belt and braces under `query_only`, which already refuses a temp table outright: if
  // one is ever admitted again, it is bounded by RAM rather than by free disk.
  opened.exec("PRAGMA temp_store = MEMORY;");
  // `platform_search_normalize` is per-connection and unregistered here: a question filtering text
  // fails with *no such function*. On darwin, registering it is refused: this thread knows no
  // pinned library path, so the ABI the extension would compile against cannot be checked.
  return opened;
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
