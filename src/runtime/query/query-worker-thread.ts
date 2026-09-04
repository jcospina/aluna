// Where a whole-catalog read actually executes: a Worker thread holding its own
// SQLITE_OPEN_READONLY connection to the one documented database file.
//
// `bun:sqlite` is synchronous and `src/platform/persistence/db.ts` opens on the main
// thread, so a clumsy join across three capabilities would block the event loop for
// its whole duration — no request served, no stream advancing, the desk frozen —
// while returning a single row that no result-size bound could ever catch. Moving
// execution off the main thread is admissible only because the safety seam survives
// the move (ADR-0008, decisions 6 and 7).
//
// **`SQLITE_OPEN_READONLY` alone is not that seam.** It means "cannot write *this*
// database", which is narrower than it reads. Measured on Bun 1.3.12 against a read-only
// connection: `VACUUM INTO '<path>'` wrote a complete copy of the catalog to an arbitrary
// file, `CREATE TEMP TABLE` spilled 293 MB to disk, and `ATTACH DATABASE` opened and read
// any other SQLite file on the machine. A question's SQL is model-written, so each of
// those is one statement away. Three things close the gap, and all three are needed:
//
//   - `PRAGMA query_only` — refuses `VACUUM INTO` and the temp-table spill.
//   - refusing `PRAGMA` from a caller — without it, `PRAGMA query_only = OFF` reopens
//     everything the line above just closed.
//   - refusing `ATTACH`/`DETACH` — which `query_only` does *not* stop, and which is how a
//     statement reads a file the read gate never admitted.
//
// This bounds the connection to its own file. It is not decision 6's authorizer, which
// bounds *which capability tables* a statement may touch and needs `sqlite3_set_authorizer`
// through FFI (`bun:sqlite` exposes no authorizer API, only `Database.handle`); that is
// the loop's, in 6.3/01.
//
// The thread holds no ownership. It never receives a read token, never learns which
// incarnations it is reading and never decides whether a read is *allowed* — all of that
// stays on the main thread beside the read gate. The request shapes below are the whole
// of what crosses the boundary: a path, a statement, and that statement's parameters.
//
// The SQLite runtime is deliberately not configured here. `configureSqliteRuntime()` pins
// Bun to an extension-capable libsqlite3, and that native library loads once per process
// rather than once per thread: calling it from this side throws `SQLite already loaded`.
// The main thread always pins it before this thread exists and this connection inherits
// it. The `sqlite_version()` parity test asserts that the *library* carried over (on macOS
// it has teeth: Bun ships 3.51.0, the pinned Homebrew build is 3.53.1).
//
// `platform_search_normalize` does **not** carry over, and cannot be installed here yet.
// It is a per-connection registration, so this connection lacks it, and a question that
// filters text the way a generated search filters it will fail with *no such function*
// until 6.3 needs one. Registering it here segfaults the process, reproducibly: the guard
// in `assertExtensionAbiMatchesRuntime` keys off `sqliteLibraryPath`, which
// `configureSqliteRuntime` assigns *after* `setCustomSQLite` — and `setCustomSQLite`
// throws `SQLite already loaded` on this thread. The path therefore stays unset here
// whatever this thread does, the ABI check silently skips itself, and the extension
// compiles against the system headers while Homebrew's library is loaded. That is the
// exact mismatch that file's own comment warns takes the process down. Giving the thread
// the pinned path without re-pinning it is the fix, and it belongs with the epic that
// needs the function.

import { Database } from "bun:sqlite";

/**
 * Every value SQLite carries into or out of a statement through this thread. `bigint` is
 * absent deliberately: `safeIntegers` is off, so an integer past 2^53 arrives already
 * rounded and typing it as `bigint` would promise a precision no value here has.
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

export type QueryWorkerResponse =
  | { readonly kind: "opened"; readonly id: number }
  | { readonly kind: "rows"; readonly id: number; readonly rows: readonly QueryWorkerRow[] }
  | { readonly kind: "failed"; readonly id: number; readonly message: string };

/**
 * Statement forms that leave this connection's own file behind, whatever else they do.
 * The list mirrors the tail of `RAW_MUTATION_SQL_PATTERN` in
 * `src/builder/units/safety/handler-source-safety.ts`, which already refuses exactly these
 * in generated handler source — mirrored rather than imported because that module pulls in
 * the TypeScript compiler, which has no business on this thread.
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
      message: error instanceof Error ? error.message : String(error),
    } satisfies QueryWorkerResponse);
  }
};

function handle(request: QueryWorkerRequest): QueryWorkerResponse {
  if (request.kind === "open") {
    connection = open(request.path);
    return { kind: "opened", id: request.id };
  }

  if (!connection) {
    throw new Error("The query worker has no connection open.");
  }
  assertOneReadStatement(request.sql);

  // `prepare` rather than `query`: `query` caches the compiled statement on the
  // connection, and a question's SQL is written once and never asked again, so that
  // cache could only grow. Finalizing keeps the thread's memory flat across a loop.
  const statement = connection.prepare<QueryWorkerRow, QueryWorkerValue[]>(request.sql);
  try {
    return { kind: "rows", id: request.id, rows: statement.all(...request.parameters) };
  } finally {
    statement.finalize();
  }
}

function open(path: string): Database {
  const opened = new Database(path, { readonly: true });
  // The same contention allowance the platform's own connections carry (db.ts): WAL keeps
  // this reader off the writer's back, and the timeout absorbs the brief lock a checkpoint
  // takes instead of surfacing a spurious SQLITE_BUSY.
  opened.exec("PRAGMA busy_timeout = 5000;");
  opened.exec("PRAGMA query_only = ON;");
  // Belt and braces under `query_only`, which already refuses a temp table outright: if
  // one is ever admitted again, it is bounded by RAM rather than by free disk.
  opened.exec("PRAGMA temp_store = MEMORY;");
  return opened;
}

function assertOneReadStatement(sql: string): void {
  const body = sql.replace(SQL_LITERALS_AND_COMMENTS, " ");
  const refused = NOT_A_READ.exec(body);
  if (refused) {
    throw new Error(`The query worker refuses ${refused[0].trim().toUpperCase()}: it reads.`);
  }
  // SQLite compiles only the first statement of a multi-statement string and drops the
  // rest silently, so anything after the first would be validated by a later gate and
  // never run. Refusing is the only honest answer.
  if (body.replace(/;\s*$/, "").includes(";")) {
    throw new Error("The query worker runs one statement at a time.");
  }
}
