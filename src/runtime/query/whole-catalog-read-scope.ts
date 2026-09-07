// The main thread's side of one question: the whole active catalog, owned for as long as
// the question lasts and taken back afterwards (PLAN decision 2, ADR-0008).
//
// **The complete token set against one snapshot, or nothing** — `read-gates.ts` is used
// exactly as the router and the logo lifecycle use it, with the whole catalog as the
// requested set rather than one target and its declared dependencies. A question that
// half-owned the catalog would read one capability across the deletion of another, which
// is the race the gate exists to make impossible.
//
// The consequence of that atomicity is a real one, and it is recorded rather than
// engineered away, next to decision 13's: one capability held in `closing` by a deletion
// refuses *every* question for as long as its drain lasts, not only questions about it.
// The router is not exposed this way because it asks for one target and its dependencies;
// a question asks for everything. Making that a sentence Aluna says rather than a raw
// `ReadGateUnavailableError` is 6.4's and 6.6's.
//
// **This is ownership, not table admission.** `CapabilityQueryScope` in
// `src/runtime/data/tool.ts` is the other half of the word *scope* here: it bounds which
// tables one Action's statement may open, through `assertScopedQuery`'s enumeration of the
// tables an `EXPLAIN` says a statement actually reads. Decision 6 has that generalise to a
// whole-catalog scope, and 6.3/01 built the generalisation in
// `whole-catalog-query-scope.ts` — but it is the *turn* that takes it, not this scope. A
// caller that reads through `scope.read` without going through `assertWholeCatalogQuery`
// is owning the catalog and bounded to nothing but the worker's own file.
//
// **Ownership never enters the worker** (decision 11). The token set, the incarnation
// identities and the catalog all stay here; `query-worker.ts` is handed a statement and
// its parameters, and nothing else ever crosses that boundary.
//
// **Nothing is created.** No registry row, no logo, no version, no artifact, no cache, no
// persisted read dependency and no conversation thread — the same question asked twice
// opens two scopes and runs twice. The worker is started on the first statement rather
// than on the scope, so a question Aluna declines to run any SQL for never starts a
// thread. The one thing a scope does leave behind is process-local and the router leaves
// it too: `tryAcquire` synchronizes the coordinator's catalog, and a gate cell it creates
// there lives until the process restarts.
//
// **Release is unconditional**, and ordered: the worker is closed in this module's
// `finally` and the tokens are released in `withTokens`' own, so `close()` always runs
// before the gate is told there are no readers left. What is guaranteed here is that a
// failed statement, a thrown body and a question cancelled by a closing gate all leave the
// gate at zero readers rather than with a leaked token that would later fail somebody's
// deletion, and that no read starting after the scope is over reaches a worker at all.
//
// **Cancellation is one entry point, and it is a kill** (decision 10). A synchronous
// `bun:sqlite` statement can never observe an `AbortSignal`, so a running question cannot
// be asked to stop; `cancel()` ends the worker instead, and `query-worker.ts`'s `close()`
// is that kill — it rejects the read the body is awaiting on the spot and terminates the
// thread. Decision 10 names three triggers and only one has a raiser today: the closing
// gate's signal is wired to `cancel()` here, and 6.5/04 connects the user's two — a new
// question, a dismissed answer — to the same call rather than building a second path.
//
// **What the kill reclaims is the waiting, not the CPU.** `query-worker.ts` records that
// `terminate()` reclaims the thread only when the statement ends, so a killed statement
// keeps burning a core it no longer answers to. That is enough for what the drain needs:
// `DEFAULT_READ_DRAIN_TIMEOUT_MS` waits on the *token*, and the token is released when the
// body unwinds, and a rejected `await` is what starts it. What used to run a drain to its
// deadline was a main thread parked on a statement, never the statement's own cycles;
// removing the park is what turns that deadline from a hope into a mechanism.
//
// A cancel therefore releases nothing on its own. A body that catches the cancellation and
// then takes its time returning holds the whole catalog until it does, exactly as 6.2/02
// recorded of a body that never settles at all. One entry point ends the question; only
// the body's own unwinding ends the ownership.
//
// **Decision 13's residual risk, recorded rather than engineered away.** No wall-clock
// deadline is applied to a question anywhere on this path — slow is allowed (decision 9),
// and a cancel entry point is exactly where one would be smuggled back in — so a long
// query holds its token set for as long as it runs, and a deletion admitted during it
// cancels the question instead of waiting for it. That is the intended precedence: the
// deletion the user confirmed wins over the question they can ask again. The cost lands
// on the asker, who loses an answer mid-flight with no partial rows and nothing cached to
// resume from, and it is written down rather than softened — softening it means a
// deadline, and a deadline is the thing decision 9 refused.

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
   * This question is over: a closing gate ended its ownership, or `cancel()` ended the
   * question. Aborted with whichever came first as its reason, so a body doing something
   * other than a read still learns that it is working for nobody.
   */
  readonly signal: AbortSignal;
  /**
   * The rows one parameterized read produced. Refuses to start once ownership has ended or
   * the scope is over, refuses to hand back rows whose ownership ended while they were
   * being read, and carries the query worker's own refusals otherwise — one read at a
   * time, and nothing after the scope closes.
   */
  read(sql: string, parameters?: readonly QueryWorkerValue[]): Promise<readonly QueryWorkerRow[]>;
  /**
   * End this question now: `signal` aborts, the worker is terminated, and the read the body
   * is awaiting rejects. Idempotent, safe before the first statement and after the scope is
   * over, and the only cancel path there is. `reason` is what the question reports unless a
   * closing gate got there first, in which case the gate's refusal stands — the first cause
   * wins, and a second cancel changes nothing.
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
 * Run `body` owning the complete active catalog. Throws `ReadGateUnavailableError` without
 * acquiring anything when any incarnation in the captured snapshot cannot be owned, and
 * releases on every exit.
 */
export async function withWholeCatalogReadScope<T>(
  deps: WholeCatalogReadScopeDeps,
  body: (scope: WholeCatalogReadScope) => T | Promise<T>,
): Promise<T> {
  const readActiveCatalog = deps.readActiveCatalog ?? readActiveRegistryCatalog;
  const database = deps.database ?? dbReadonly;
  // The worker opens the file this catalog was read from, not `DB_PATH`. They are the same
  // singleton in the product, and they stop being the same the moment anything hands the
  // scope another connection — a question would then be answered about one desk's registry
  // against another desk's rows, silently and with confident numbers. `createQueryWorker`
  // still defaults to `DB_PATH` for a caller with no connection in hand.
  const createWorker = deps.createWorker ?? (() => createQueryWorker(database.filename));
  const catalog = readActiveCatalog(database);
  const incarnations = catalog.capabilities.map(capabilityIncarnation);

  return await deps.readGates.withTokens(
    { catalog: incarnations, incarnations },
    async (tokens) => {
      // What the body watches. The gate's signal ends the question and so does `cancel()`,
      // and a body that is between statements — a loop waiting on a model, an answer being
      // written — can only see the second one if it has a signal to see it on.
      const cancelled = new AbortController();
      const questionOver = AbortSignal.any([tokens.signal, cancelled.signal]);

      let worker: QueryWorker | undefined;
      let over = false;
      let cancellation: Error | undefined;
      let workerClosed = false;

      /**
       * One close per worker that accepts one. The flag is set *after* the call, so a
       * `close()` that threw is tried again by the `finally` rather than leaving a thread
       * nobody will ever reclaim.
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

      function cancel(reason?: Error): void {
        cancellation ??=
          reason ?? new WholeCatalogReadCancelledError("The question was cancelled.");
        if (!cancelled.signal.aborted) cancelled.abort(cancellation);
        closeWorker();
      }

      /** True before a statement may start, and still true before its rows may be handed back. */
      function assertQuestionLive(): void {
        assertReadOwnership(questionOver);
        // The signal already carries every cancellation, so this line is belt and braces —
        // and it is the belt: a refusal that leaned only on the signal would, if the signal
        // ever stopped carrying one, let a read reach a closed worker and wait on a promise
        // nothing will ever settle. Refusing is the failure this end should have.
        if (cancellation) throw cancellation;
      }

      /**
       * What a failed read reports. A cancel closes the worker underneath the read, so *the
       * worker is closed* is true and beside the point; a statement SQLite refused on its own
       * merits keeps its own message, which is the one 6.3's loop needs to read.
       */
      function readFailure(error: unknown): unknown {
        if (!(error instanceof QueryWorkerClosedError)) return error;
        return cancellation ?? error;
      }

      // The gate aborts on release too, one microtask after the `finally` below has already
      // closed the worker, so the listener is taken off there rather than left to report an
      // ordinary ending as a cancellation.
      const cancelOnClosingGate = () => {
        cancel(tokens.signal.reason instanceof Error ? tokens.signal.reason : undefined);
      };
      tokens.signal.addEventListener("abort", cancelOnClosingGate, { once: true });

      // `over` is not a second spelling of the abort signal. Ownership ends in `withTokens`'
      // own `finally`, one microtask after this one closes the worker, and a read landing in
      // that gap would pass the signal check and start a *fresh* worker nothing would ever
      // close — running SQL for a scope the gate already counts as drained. A cancel that
      // arrived before the first statement leaves the same hole, and `cancellation` closes it.
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
              // Closing the worker rejects a read the body started and walked away from,
              // which would otherwise surface as an unhandled rejection and take the process
              // down. A second subscriber that ignores the failure hides nothing from the
              // caller's own await.
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
