// Where a whole-catalog read executes: a Worker thread, so a clumsy join cannot freeze the desk
// (ADR-0008, decisions 6 and 7). The one documented database file is attached `mode=ro` under a
// schema name only this thread knows, beside an empty in-memory `main` (Module 7 decision 37).
//
// Each table in the question's catalog is read through a temp view named like it, listing the
// columns the catalog knows: a file column without its key, and text or a file's name showing
// the withheld phrase where it may hold a ledger key or a file's address (`mayHoldAnAddress`). An unqualified name reads the
// view and `main.` finds nothing. The table bound prepares every read on a connection where that
// schema does not exist, and a write it lets through fails `mode=ro` before anything is read.
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

/** How a column reaches a statement: as stored, as a file without its key, or as withholdable text or list. */
export type QueryColumnReading = "value" | "file" | "text" | "list";

/** One capability table as a question reads it: every column its catalog entry knows, and how. */
export interface QueryShadowTable {
  readonly table: string;
  readonly columns: readonly { readonly name: string; readonly reading: QueryColumnReading }[];
}

/** What the worker is told at birth. It imports nothing, so the platform's words come with it. */
export interface QueryShadow {
  readonly tables: readonly QueryShadowTable[];
  readonly withheld: string;
  readonly filePrefix: string;
  readonly ledgerTable: string;
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
function open(path: string, shadow: QueryShadow): Database {
  const opened = new Database(":memory:");
  // The contention allowance the platform's own connections carry (db.ts): WAL keeps this reader
  // off the writer's back, and the wait absorbs the brief lock a checkpoint takes — ATTACH included.
  opened.exec("PRAGMA busy_timeout = 5000;");
  // Bounds a temp table by RAM rather than free disk, should `query_only` ever admit one. Set
  // before the views, because changing it drops every temp object.
  opened.exec("PRAGMA temp_store = MEMORY;");
  const uri = `file:${path.split("/").map(encodeURIComponent).join("/")}?mode=ro`;
  opened.run(`ATTACH DATABASE ? AS ${DESK_SCHEMA}`, [uri]);
  for (const table of shadow.tables) {
    const columns = table.columns.map(({ name, reading }) => columnAs(name, reading, shadow));
    opened.exec(
      `CREATE TEMP VIEW ${quoted(table.table)} AS SELECT ${columns.join(", ")} FROM ${DESK_SCHEMA}.${quoted(table.table)} AS source`,
    );
    // A view is compiled when it is read, so a column the table lacks fails here, at open.
    opened.prepare(`SELECT * FROM temp.${quoted(table.table)} LIMIT 0`).finalize();
  }
  opened.exec("PRAGMA query_only = ON;");
  // `platform_search_normalize` is per-connection and unregistered here: a question filtering text
  // fails with *no such function*. On darwin, registering it is refused: this thread knows no
  // pinned library path, so the ABI the extension would compile against cannot be checked.
  return opened;
}

/** No read can name this: the table bound prepares every read where no schema is called it. */
const DESK_SCHEMA = "question_desk";

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
const globbed = (text: string) => text.replace(/[*?[]/g, "[$&]");
const HEX = "[0-9a-fA-F]";
const HEX_RUN = `'*${"[0-9a-f]".repeat(32)}*'`;
/** What a copied key is most often written with between its digits, dropped before matching. */
const SEPARATORS = [..."-_:./\\,;|+=#&?!'\"`()[]{}<>", " ", "\t", "\n", "\r", "\u00a0"];
/** A window's text is cut into chunks this long, overlapping by 31, so no substr walks far. */
const CHUNK = 1024;

/** SQL for a key's 32 digits in a row read as the ledger's hyphenated key. */
function dashed(digits: string): string {
  const part = (from: number, length: number) => `substr(${digits}, ${from}, ${length})`;
  return [part(1, 8), part(9, 4), part(13, 4), part(17, 4), part(21, 12)].join(" || '-' || ");
}

/**
 * Whether `text` may hold a file's address: a NUL, past which SQLite's text functions read
 * nothing; a `/files/` path; or, the listed separators dropped, a ledger key, looked up through
 * the ledger's index at each 32-digit window of the chunks holding a run of hex digits.
 */
function mayHoldAnAddress(text: string, shadow: QueryShadow): string {
  const digits = `lower(${SEPARATORS.reduce((inner, separator) => `replace(${inner}, ${literal(separator)}, '')`, text)})`;
  const ledger = `${DESK_SCHEMA}.${quoted(shadow.ledgerTable)}`;
  const span = CHUNK + 31;
  const chunks = `chunk(c, rest) AS (SELECT substr(${digits}, 1, ${span}), substr(${digits}, ${CHUNK + 1}) UNION ALL SELECT substr(rest, 1, ${span}), substr(rest, ${CHUNK + 1}) FROM chunk WHERE length(rest) > 31)`;
  const windows = `at(p, c) AS (SELECT 1, c FROM chunk WHERE c GLOB ${HEX_RUN} UNION ALL SELECT p + 1, c FROM at WHERE p + 32 <= length(c))`;
  const inLedger = `EXISTS (WITH RECURSIVE ${chunks}, ${windows} SELECT 1 FROM at JOIN ${ledger} AS ledger ON ledger."key" = ${dashed("substr(at.c, at.p, 32)")})`;
  return [
    `instr(CAST(${text} AS BLOB), x'00') > 0`,
    `${text} GLOB ${literal(`*${globbed(shadow.filePrefix)}${HEX.repeat(8)}*`)}`,
    `(EXISTS (SELECT 1 FROM ${ledger}) AND ${digits} GLOB ${HEX_RUN} AND ${inLedger})`,
  ].join(" OR ");
}

/**
 * A view column: a file as the four fields a question may read, each withheld where it may hold
 * an address; or text, or a list's JSON, withheld the same way. Every name is qualified, since
 * SQLite reads a double-quoted name no column has as a string instead, and text is cast back to
 * TEXT, since a CASE has no affinity and a number bound against it would match nothing.
 */
function columnAs(name: string, reading: QueryColumnReading, shadow: QueryShadow): string {
  const column = `source.${quoted(name)}`;
  const as = `AS ${quoted(name)}`;
  const withheld = literal(shadow.withheld);
  const unless = (value: string) =>
    `CASE WHEN ${mayHoldAnAddress(value, shadow)} THEN ${withheld} ELSE ${value} END`;
  if (reading === "value") return `${column} ${as}`;
  if (reading === "file") {
    const fields = ["kind", "mime", "size", "name"].map(
      (field) => `'${field}', ${unless(`json_extract(${column}, '$.${field}')`)}`,
    );
    const whole = `json_valid(${column}) AND json_type(${column}) = 'object' AND json_type(json_remove(${column}, '$.key'), '$.key') IS NULL`;
    return `CASE WHEN ${whole} THEN json_object(${fields.join(", ")}) END ${as}`;
  }
  const hidden = reading === "list" ? `json_array(${withheld})` : withheld;
  return `CAST(CASE WHEN ${mayHoldAnAddress(column, shadow)} THEN ${hidden} ELSE ${column} END AS TEXT) ${as}`;
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
