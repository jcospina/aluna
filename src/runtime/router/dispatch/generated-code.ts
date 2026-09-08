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
 * How the router turns a row's `artifacts_path` and an action into a runnable handler.
 * Injectable so the gate (2.5) and tests can substitute loading without touching disk.
 */
export type HandlerLoader = (artifactsPath: string, action: string) => Promise<CapabilityHandler>;

/**
 * A row's `artifacts_path` to that capability's item renderer, the composition input for its
 * presentation adapter. One per capability, so no action; injectable like {@link HandlerLoader}.
 */
export type ItemRendererLoader = (artifactsPath: string) => Promise<ItemRenderer>;

/**
 * The version-directory filename the item renderer is generated to and loaded from, a sibling
 * of the handler files under the same `artifacts_path`.
 */
export const ITEM_RENDERER_FILE = "item.ts";

/**
 * How long a generated Handler may run before the router abandons it. Unbounded it would pin its
 * read tokens forever and nothing could delete the capability; set below the read-gate drain.
 */
export const DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS = 10_000;

export class CapabilityHandlerTimeoutError extends Error {
  override readonly name = "CapabilityHandlerTimeoutError";
}

/**
 * The reader went away before its answer did — not a failure. The browser aborts when the content
 * region is replaced or put away, and abandoning here hands the read tokens back immediately.
 */
export class CapabilityReadAbandonedError extends Error {
  override readonly name = "CapabilityReadAbandonedError";
}

/**
 * Resolve with the Handler, or reject when the deadline or `abandonOn` ends this route's wait; the
 * Handler's promise is not cancellable. Mutations pass no signal so a write can still roll back.
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
 * The default loader: import the incarnation/version-keyed handler file and confirm it
 * default-exports a function. A file URL is portable, and import caches by that unique path.
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
 * The default item-renderer loader: import the version-keyed {@link ITEM_RENDERER_FILE} and
 * confirm it default-exports a function. Mirrors {@link defaultLoadHandler}; M3 requires the file.
 */
export const defaultLoadItemRenderer: ItemRendererLoader = async (artifactsPath) => {
  const file = resolve(process.cwd(), artifactsPath, ITEM_RENDERER_FILE);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof loaded.default !== "function") {
    throw new TypeError(`Item renderer file ${file} has no default-exported function.`);
  }
  return loaded.default as ItemRenderer;
};
