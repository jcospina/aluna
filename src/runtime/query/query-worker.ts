// The main thread's side of the query worker. Why the work is on a thread at all, and
// why the thread is given no ownership, are in `query-worker-thread.ts`.
//
// One read at a time, because that is all the thread can do. `bun:sqlite` is
// synchronous, so a second statement posted mid-read would only queue behind the first,
// and a caller believing it has two reads in flight is wrong about the one thing that
// matters here. The loop that will use this (epic 6.3) takes one step per turn, so the
// refusal costs nothing and keeps the contract legible.
//
// `close()` ends the worker's life, and the caller owns that lifetime: an unclosed worker
// keeps the process alive on its own.
//
// It does **not** stop a statement already running, and 6.2/03 did not inherit the belief
// that it does. Measured on Bun 1.3.12: after `terminate()` returned, the thread went on
// burning 2.98s of CPU over the next 3s of a runaway query, and a `process.exit` issued
// during one waited for the statement to finish. `terminate()` reclaims the thread when the
// statement ends; interrupting the statement itself needs `sqlite3_interrupt` through FFI
// against `Database.handle`.
//
// What `close()` does reclaim immediately is the *caller*: `end()` rejects every pending
// read on this side, synchronously, whatever the thread is still doing. That is
// the whole of decision 10's kill — `whole-catalog-read-scope.ts` cancels by closing, and
// the read gate's drain waits on the released token rather than on the statement's cycles.
// There is no second `terminate()` entry point here because there would be nothing in it
// this one does not already do.
//
// The packaging seam 6.2/01 left open is closed, because 6.3/01 is what opened it for real.
// Bun's bundler emits the specifier below exactly as written — dropping `.href` does not
// make it follow the worker either — so a bundled entry point looks for the thread *beside
// itself* rather than in `src/`. That was harmless while nothing the server reached
// imported this file; `/demo/question` reaches it now. `scripts/build.ts` therefore copies
// `query-worker-thread.ts` beside the bundle, which works because the thread imports
// `bun:sqlite` and nothing else and Bun runs the TypeScript file directly. `build.test.ts`
// asserts both halves: the copy is there, and the thread still has no relative import that
// the copy could not resolve.

import { DB_PATH } from "../../platform/persistence/db.ts";
import type {
  QueryWorkerRequest,
  QueryWorkerResponse,
  QueryWorkerRow,
  QueryWorkerValue,
} from "./query-worker-thread.ts";

export type { QueryWorkerRow, QueryWorkerValue };

export class QueryWorkerError extends Error {
  override readonly name: string = "QueryWorkerError";
}

/** The statement itself was refused, carrying its own message — a write reaches the caller
 * as *attempt to write a readonly database*, and a bad column as *no such column*. The
 * worker stays open, and a different statement is what fixes it. */
export class QueryWorkerStatementError extends QueryWorkerError {
  override readonly name = "QueryWorkerStatementError";
}

/** A read was asked for while another was still running. */
export class QueryWorkerBusyError extends QueryWorkerError {
  override readonly name = "QueryWorkerBusyError";
}

/** The thread is gone — closed by its owner, or dead — and no further read can run. */
export class QueryWorkerClosedError extends QueryWorkerError {
  override readonly name = "QueryWorkerClosedError";
}

/**
 * The database failed, not the statement: busy, locked, interrupted, an I/O error, a corrupt
 * image, no connection at all. Distinct from `QueryWorkerStatementError` because the two ask
 * for opposite things — a statement failure is something to rewrite, and this is not. A
 * caller that folded them together would hand a loop *try a better query* about a database
 * that is not answering, and the loop would keep trying until its budget was gone. The
 * thread draws the line, because SQLite's result code does not cross the message boundary.
 */
export class QueryWorkerConnectionError extends QueryWorkerError {
  override readonly name = "QueryWorkerConnectionError";
}

export interface QueryWorker {
  /**
   * The rows one parameterized read produced. Rejects with `QueryWorkerStatementError`
   * when SQLite refuses the statement, `QueryWorkerBusyError` while another read is
   * running, and `QueryWorkerClosedError` once the thread is gone.
   */
  read(sql: string, parameters?: readonly QueryWorkerValue[]): Promise<readonly QueryWorkerRow[]>;
  /**
   * End the thread and its connection. Pending and later reads reject with
   * `QueryWorkerClosedError` at once, which is also how a question is cancelled.
   * Idempotent: the thread is terminated once however many times this is called.
   */
  close(): void;
}

interface PendingRequest {
  readonly expects: QueryWorkerResponse["kind"];
  readonly resolve: (rows: readonly QueryWorkerRow[]) => void;
  readonly reject: (reason: Error) => void;
}

/**
 * Start a query worker against `path`, defaulting to the one documented database file.
 * Exported with the path as a parameter for the same reason `openDatabase` is: tests
 * drive it against a throwaway file, while the platform runs it against DB_PATH.
 */
export function createQueryWorker(path: string = DB_PATH): QueryWorker {
  const worker = new Worker(new URL("./query-worker-thread.ts", import.meta.url).href);
  const pending = new Map<number, PendingRequest>();
  let nextRequestId = 1;
  let reading = false;
  let ended: QueryWorkerClosedError | undefined;
  let terminated = false;

  function post(
    request: QueryWorkerRequest,
    expects: QueryWorkerResponse["kind"],
  ): Promise<readonly QueryWorkerRow[]> {
    if (ended) return Promise.reject(ended);
    return new Promise((resolve, reject) => {
      pending.set(request.id, { expects, resolve, reject });
      try {
        worker.postMessage(request);
      } catch (error) {
        // A value structured-clone cannot carry never reaches the thread, so nothing will
        // ever answer this id.
        pending.delete(request.id);
        reject(error instanceof Error ? error : new QueryWorkerError(String(error)));
      }
    });
  }

  function end(reason: QueryWorkerClosedError): void {
    ended ??= reason;
    for (const waiting of pending.values()) waiting.reject(ended);
    pending.clear();
  }

  /** What a `failed` reply becomes, once it is known which read was waiting for it. */
  function rejection(
    waiting: PendingRequest,
    response: Extract<QueryWorkerResponse, { kind: "failed" }>,
  ): QueryWorkerError {
    // An open that failed leaves no connection to run anything on, so it ends the worker
    // rather than reporting a statement the caller could rephrase.
    if (waiting.expects === "opened") {
      const closed = new QueryWorkerClosedError(
        `The query worker could not open: ${response.message}`,
      );
      ended ??= closed;
      return closed;
    }
    return response.fault === "connection"
      ? new QueryWorkerConnectionError(response.message)
      : new QueryWorkerStatementError(response.message);
  }

  function settle(waiting: PendingRequest, response: QueryWorkerResponse): void {
    if (response.kind === waiting.expects) {
      waiting.resolve(response.kind === "rows" ? response.rows : []);
      return;
    }
    // A reply of the wrong kind would otherwise resolve a read as zero rows, which is the
    // one answer a query worker must never invent.
    if (response.kind !== "failed") {
      waiting.reject(new QueryWorkerError(`The query worker answered with "${response.kind}".`));
      return;
    }
    waiting.reject(rejection(waiting, response));
  }

  worker.onmessage = (event: MessageEvent) => {
    const response = event.data as QueryWorkerResponse;
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    settle(waiting, response);
  };

  // A throw at the thread's module scope arrives here and nowhere else. Without this
  // every read would wait forever on a thread that is already dead.
  worker.onerror = (event: ErrorEvent) => {
    end(new QueryWorkerClosedError(`The query worker stopped: ${event.message || "unknown"}`));
  };

  const opened = post({ kind: "open", id: nextRequestId++, path }, "opened");
  // An open that fails with no read outstanding would otherwise surface as an unhandled
  // rejection and take the process down with it. `read` still sees the same failure.
  opened.catch(() => {});

  return {
    async read(sql, parameters = []) {
      if (ended) throw ended;
      if (reading) throw new QueryWorkerBusyError("The query worker runs one read at a time.");
      reading = true;
      try {
        await opened;
        return await post({ kind: "read", id: nextRequestId++, sql, parameters }, "rows");
      } finally {
        reading = false;
      }
    },

    close() {
      end(new QueryWorkerClosedError("The query worker is closed."));
      // A second `terminate()` goes to a thread that may still be inside its statement, and
      // a cancelled question closes through here twice by construction — once to kill the
      // read, once from the scope's `finally`. Ending the bookkeeping is what stays
      // repeatable; killing the thread happens once.
      if (terminated) return;
      terminated = true;
      worker.terminate();
    },
  };
}
