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
// whole-catalog scope with the loop in 6.3/01; until then a capability created after the
// snapshot is unowned and absent from `catalog`, and nothing stops SQL from reading its
// table.
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
// before the gate is told there are no readers left. Closed is not the same as gone —
// `query-worker.ts` records that `terminate()` reclaims the thread only when the statement
// ends, so a statement still in flight outlives the release and 6.2/03 inherits that fact
// rather than the hope. What is guaranteed here is that a failed statement, a thrown body
// and a question cancelled by a closing gate all leave the gate at zero readers rather
// than with a leaked token that would later fail somebody's deletion, and that no read
// starting after the scope is over reaches a worker at all.

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

export interface WholeCatalogReadScope {
  /** The one immutable active registry view this question is answered against. */
  readonly catalog: ActiveRegistryCatalog;
  /** Exactly the incarnations the gate granted, in its canonical order. */
  readonly incarnations: readonly CapabilityIncarnation[];
  /** Closing any owned incarnation ends this scope's ownership cooperatively. */
  readonly signal: AbortSignal;
  /**
   * The rows one parameterized read produced. Refuses to start once ownership has ended or
   * the scope is over, refuses to hand back rows whose ownership ended while they were
   * being read, and carries the query worker's own refusals otherwise — one read at a
   * time, and nothing after the scope closes.
   */
  read(sql: string, parameters?: readonly QueryWorkerValue[]): Promise<readonly QueryWorkerRow[]>;
}

export interface WholeCatalogReadScopeDeps {
  readonly readGates: ReadGateCoordinator;
  /** Where the catalog snapshot is read; the worker opens its own connection. */
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
  const createWorker = deps.createWorker ?? createQueryWorker;
  const catalog = readActiveCatalog(deps.database ?? dbReadonly);
  const incarnations = catalog.capabilities.map(capabilityIncarnation);

  return await deps.readGates.withTokens(
    { catalog: incarnations, incarnations },
    async (tokens) => {
      let worker: QueryWorker | undefined;
      let over = false;

      // `over` is not a second spelling of the abort signal. Ownership ends in `withTokens`'
      // own `finally`, one microtask after this one closes the worker, and a read landing in
      // that gap would pass the signal check and start a *fresh* worker nothing would ever
      // close — running SQL for a scope the gate already counts as drained.
      async function run(
        sql: string,
        parameters: readonly QueryWorkerValue[],
      ): Promise<readonly QueryWorkerRow[]> {
        assertReadOwnership(tokens.signal);
        if (over) {
          throw new QueryWorkerClosedError("The whole-catalog read scope is over.");
        }
        worker ??= createWorker();
        const rows = await worker.read(sql, parameters);
        assertReadOwnership(tokens.signal);
        return rows;
      }

      try {
        return await body(
          Object.freeze({
            catalog,
            incarnations: tokens.incarnations,
            signal: tokens.signal,
            read(sql: string, parameters: readonly QueryWorkerValue[] = []) {
              const rows = run(sql, parameters);
              // Closing the worker rejects a read the body started and walked away from,
              // which would otherwise surface as an unhandled rejection and take the process
              // down. A second subscriber that ignores the failure hides nothing from the
              // caller's own await.
              rows.catch(() => {});
              return rows;
            },
          }),
        );
      } finally {
        over = true;
        try {
          worker?.close();
        } catch {
          // A thread that will not end is not what the caller needs to hear about while its
          // own failure is on its way out of this `finally`.
        }
      }
    },
  );
}
