// How the router obtains generated code, and how long it is allowed to run.
//
// Both halves belong together: loading a Handler and bounding it are the two places the
// platform hands control to the least-trusted code it runs, and the same `artifacts_path`
// identity governs each.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ItemRenderer } from "../../../presentation/index.ts";
import type { CapabilityHandler } from "../contract.ts";

/**
 * How the router turns a row's `artifacts_path` + an action into a runnable
 * handler. Injectable so the gate (2.5) and tests can substitute loading without
 * touching disk; the default loads the real version-keyed file.
 */
export type HandlerLoader = (artifactsPath: string, action: string) => Promise<CapabilityHandler>;

/**
 * How the router turns a row's `artifacts_path` into that capability's item renderer —
 * the composition input for its presentation adapter. One
 * renderer per capability, so this takes no action. Injectable for the same reasons as
 * {@link HandlerLoader}; the default loads the version-keyed file unit generation writes.
 */
export type ItemRendererLoader = (artifactsPath: string) => Promise<ItemRenderer>;

/**
 * The version-directory filename the item renderer is generated to and
 * loaded from here — the seam that lets the router build a capability's presentation
 * adapter without knowing how the renderer was written. A sibling of the handler files
 * under the same `artifacts_path`.
 */
export const ITEM_RENDERER_FILE = "item.ts";

/**
 * How long one generated Handler may run before the router abandons it.
 *
 * A Handler that never settles is not merely a slow request: it pins its read tokens
 * forever, so the incarnation's read gate can never drain and that capability can never
 * be deleted again. It also holds a record route's `BEGIN IMMEDIATE` transaction open,
 * blocking every other write on the shared connection. JavaScript cannot cancel the
 * orphaned promise, but abandoning it lets the route's `finally` release read ownership —
 * which aborts the token signal, so the orphan's next query or mutation port call fails
 * closed rather than writing after the rollback.
 *
 * Handlers do local SQLite work, so this is a stuck-code deadline, not a budget. It sits
 * *below* the read-gate drain deadline on purpose (`DEFAULT_READ_DRAIN_TIMEOUT_MS` in
 * `src/runtime/concurrency/read-gates.ts`): a route abandoned here hands its read tokens back before a
 * deletion gives up waiting for them, so a merely slow Handler can never fail a deletion
 * for a reason the user cannot see. The gap is closed from the drain side, never by
 * capping this one downward — reads are what the user is doing.
 *
 * The route's token scope is slightly wider than this deadline: reading the request body
 * happens inside the tokens and outside the deadline. That is not a hole, because a
 * record mutation takes its coordinator lease before it parses and deletion's own lease
 * is a non-queued try-acquire — so a deletion racing a slow upload is refused as busy at
 * the front half rather than left waiting at the drain.
 */
export const DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS = 10_000;

export class CapabilityHandlerTimeoutError extends Error {
  override readonly name = "CapabilityHandlerTimeoutError";
}

/**
 * The reader went away before its answer did.
 *
 * This is not a failure. It is the server half of the content region's release rule: the
 * browser aborts the request when the region's content is replaced or the region is put
 * away, and abandoning the route here is what lets its `finally` hand the read tokens
 * back — immediately, rather than at whatever the handler deadline happens to be. A
 * deletion drain waiting on those readers therefore waits for the person who navigated
 * away, not for a deadline they cannot see.
 */
export class CapabilityReadAbandonedError extends Error {
  override readonly name = "CapabilityReadAbandonedError";
}

/**
 * Resolve with the Handler, or reject when this route stops waiting on it. The Handler's
 * own promise is not cancellable — the point is that *this route* stops waiting, so its
 * read ownership can be released.
 *
 * Two things end the wait: the deadline, and `abandonOn` aborting. Reads pass the
 * request's own signal there, which Bun aborts when the client disconnects. Mutations
 * pass nothing: a write that a person walked away from still has to finish or roll back
 * on its own terms, and releasing read ownership under it would fail it closed midway.
 */
export async function withHandlerDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  id: string,
  action: string,
  abandonOn?: AbortSignal,
): Promise<T> {
  const bounded = Number.isFinite(timeoutMs) && timeoutMs > 0;
  if (!bounded && !abandonOn) return await work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbandon: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        if (bounded) {
          timer = setTimeout(() => {
            reject(
              new CapabilityHandlerTimeoutError(
                `Handler ${id}/${action} did not settle within ${timeoutMs}ms and was abandoned.`,
              ),
            );
          }, timeoutMs);
        }
        if (!abandonOn) return;
        const abandon = () =>
          reject(
            new CapabilityReadAbandonedError(
              `Handler ${id}/${action} was abandoned: the client closed the request.`,
            ),
          );
        if (abandonOn.aborted) {
          abandon();
          return;
        }
        onAbandon = abandon;
        abandonOn.addEventListener("abort", abandon, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbandon) abandonOn?.removeEventListener("abort", onAbandon);
    // An abandoned Handler may still reject later with nobody listening. Observe it so it
    // cannot surface as an unhandled rejection and take the process down.
    void work.catch(() => undefined);
  }
}

/**
 * The default loader: import the incarnation/version-keyed handler file and confirm it honors
 * the export half of the contract — a single default-exported function. A file URL
 * keeps the absolute path importable across platforms; dynamic import caches by
 * path, which is exactly right when `artifacts_path` is incarnation/version-namespaced.
 */
export const defaultLoadHandler: HandlerLoader = async (artifactsPath, action) => {
  const file = resolve(process.cwd(), artifactsPath, `${action}.ts`);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof loaded.default !== "function") {
    throw new TypeError(`Handler file ${file} has no default-exported function.`);
  }
  return loaded.default as CapabilityHandler;
};

/**
 * The default item-renderer loader: import the version-keyed {@link ITEM_RENDERER_FILE}
 * and confirm it default-exports a function (the record → inner-markup renderer). Mirrors
 * {@link defaultLoadHandler} — same file-URL import, same cache-by-path behavior, which is
 * right when `artifacts_path` is incarnation/version-namespaced. Rejects when the file is absent or
 * malformed. M3 requires this file for every committed capability.
 */
export const defaultLoadItemRenderer: ItemRendererLoader = async (artifactsPath) => {
  const file = resolve(process.cwd(), artifactsPath, ITEM_RENDERER_FILE);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof loaded.default !== "function") {
    throw new TypeError(`Item renderer file ${file} has no default-exported function.`);
  }
  return loaded.default as ItemRenderer;
};
