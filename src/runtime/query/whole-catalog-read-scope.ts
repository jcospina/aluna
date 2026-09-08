// The main thread's side of one question: the whole active catalog, owned for as long as the
// question lasts and taken back afterwards (PLAN decision 2, ADR-0008). The complete token set
// against one snapshot, or nothing — a question that half-owned the catalog would read one
// capability across the deletion of another. The recorded cost: one capability held in `closing`
// by a deletion refuses every question for the length of its drain, not only questions about it.
//
// This is ownership, not table admission; `whole-catalog-query-scope.ts` is the other half, and
// the turn is what takes it. Ownership never enters the worker (decision 11), and nothing is
// created — no row, no version, no artifact, no cache, no persisted read dependency.
//
// Decision 13's residual risk: no wall-clock deadline applies to a question anywhere on this
// path, so a deletion admitted during a long query cancels it rather than waiting.

import { dbReadonly, type PlatformDatabase } from "../../platform/persistence/db.ts";
import {
  type ActiveCatalogReader,
  type ActiveRegistryCatalog,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import {
  type CapabilityIncarnation,
  capabilityIncarnation,
  type ReadGateCoordinator,
} from "../concurrency/read-gates.ts";
import { assertReadOwnership } from "../data/index.ts";
import {
  createQueryWorker,
  type QueryWorker,
  QueryWorkerClosedError,
  type QueryWorkerRow,
  type QueryWorkerValue,
} from "./query-worker.ts";

/** A question ended through the scope's own cancel entry point rather than by the gate. */
export class WholeCatalogReadCancelledError extends Error {
  override readonly name = "WholeCatalogReadCancelledError";
}

export interface WholeCatalogReadScope {
  /** The one immutable active registry view this question is answered against. */
  readonly catalog: ActiveRegistryCatalog;
  /** Exactly the incarnations the gate granted, in its canonical order. */
  readonly incarnations: readonly CapabilityIncarnation[];
  /**
   * This question is over: a closing gate ended its ownership, or `cancel()` did. Aborted with
   * whichever came first, so a body between reads still learns it is working for nobody.
   */
  readonly signal: AbortSignal;
  /**
   * The rows one parameterized read produced. Refuses to start once ownership has ended, and to
   * hand back rows whose ownership ended mid-read; otherwise it carries the worker's refusals.
   */
  read(sql: string, parameters?: readonly QueryWorkerValue[]): Promise<readonly QueryWorkerRow[]>;
  /**
   * End this question now: `signal` aborts, the worker is terminated, and the awaited read
   * rejects. Idempotent, the only cancel path, and `reason` loses to a closing gate that led.
   */
  cancel(reason?: Error): void;
}

export interface WholeCatalogReadScopeDeps {
  readonly readGates: ReadGateCoordinator;
  /**
   * Where the catalog snapshot is read. The worker opens its own connection, to this same
   * file, so a scope handed a scratch connection does not answer from the product's.
   */
  readonly database?: PlatformDatabase["readonly"];
  readonly readActiveCatalog?: ActiveCatalogReader;
  readonly createWorker?: () => QueryWorker;
}

/**
 * Run `body` owning the complete active catalog, or throw `ReadGateUnavailableError` having
 * acquired nothing. Release is ordered: the worker closes here, the tokens in `withTokens`.
 */
export async function withWholeCatalogReadScope<T>(
  deps: WholeCatalogReadScopeDeps,
  body: (scope: WholeCatalogReadScope) => T | Promise<T>,
): Promise<T> {
  const readActiveCatalog = deps.readActiveCatalog ?? readActiveRegistryCatalog;
  const database = deps.database ?? dbReadonly;
  // The worker opens the file this catalog was read from, not `DB_PATH`: another connection would
  // answer about one desk's registry against another desk's rows. It starts on the first statement.
  const createWorker = deps.createWorker ?? (() => createQueryWorker(database.filename));
  const catalog = readActiveCatalog(database);
  const incarnations = catalog.capabilities.map(capabilityIncarnation);

  return await deps.readGates.withTokens(
    { catalog: incarnations, incarnations },
    async (tokens) => {
      // What the body watches: a body between statements — a loop waiting on a model — can only
      // see a `cancel()` if it has a signal to see it on.
      const cancelled = new AbortController();
      const questionOver = AbortSignal.any([tokens.signal, cancelled.signal]);

      let worker: QueryWorker | undefined;
      let over = false;
      let cancellation: Error | undefined;
      let workerClosed = false;

      /**
       * One close per worker that accepts one. The flag is set *after* the call, so a `close()`
       * that threw is tried again by the `finally` rather than leaving an unreclaimed thread.
       */
      function closeWorker(): void {
        if (!worker || workerClosed) return;
        try {
          worker.close();
          workerClosed = true;
        } catch {
          // A thread that will not end is not what the caller needs to hear about instead
          // of whatever it was already being told.
        }
      }

      // A kill (decision 10): a synchronous `bun:sqlite` statement can never observe a signal, so
      // this reclaims the waiting and not the core the killed statement goes on burning.
      function cancel(reason?: Error): void {
        cancellation ??=
          reason ?? new WholeCatalogReadCancelledError("The question was cancelled.");
        if (!cancelled.signal.aborted) cancelled.abort(cancellation);
        closeWorker();
      }

      /** True before a statement may start, and still true before its rows may be handed back. */
      function assertQuestionLive(): void {
        assertReadOwnership(questionOver);
        // The belt: a refusal leaning only on the signal would, if the signal ever stopped
        // carrying a cancellation, let a read reach a closed worker and wait on it for ever.
        if (cancellation) throw cancellation;
      }

      /**
       * What a failed read reports. A cancel closes the worker underneath the read, so *the worker
       * is closed* is beside the point; a statement SQLite refused keeps its own message.
       */
      function readFailure(error: unknown): unknown {
        if (!(error instanceof QueryWorkerClosedError)) return error;
        return cancellation ?? error;
      }

      // The gate aborts on release too, a microtask after the `finally` below closes the worker,
      // so the listener comes off there rather than reporting an ordinary ending as a cancel.
      const cancelOnClosingGate = () => {
        cancel(tokens.signal.reason instanceof Error ? tokens.signal.reason : undefined);
      };
      tokens.signal.addEventListener("abort", cancelOnClosingGate, { once: true });

      // `over` is not a second spelling of the abort signal: ownership ends a microtask after this
      // closes the worker, and a read in that gap would start a fresh worker nothing ever closes.
      async function run(
        sql: string,
        parameters: readonly QueryWorkerValue[],
      ): Promise<readonly QueryWorkerRow[]> {
        assertQuestionLive();
        if (over) {
          throw new QueryWorkerClosedError("The whole-catalog read scope is over.");
        }
        worker ??= createWorker();
        try {
          const rows = await worker.read(sql, parameters);
          // A statement that finished in the gap between a cancel and its own rejection
          // still ran for a question nobody is waiting on any more.
          assertQuestionLive();
          return rows;
        } catch (error) {
          throw readFailure(error);
        }
      }

      try {
        return await body(
          Object.freeze({
            catalog,
            incarnations: tokens.incarnations,
            signal: questionOver,
            read(sql: string, parameters: readonly QueryWorkerValue[] = []) {
              const rows = run(sql, parameters);
              // Closing the worker rejects a read the body walked away from, which would
              // otherwise surface as an unhandled rejection and take the process down.
              rows.catch(() => {});
              return rows;
            },
            cancel,
          }),
        );
      } finally {
        over = true;
        tokens.signal.removeEventListener("abort", cancelOnClosingGate);
        closeWorker();
      }
    },
  );
}
