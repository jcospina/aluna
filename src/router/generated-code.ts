// How the router obtains generated code, and how long it is allowed to run.
//
// Both halves belong together: loading a Handler and bounding it are the two places the
// platform hands control to the least-trusted code it runs, and the same `artifacts_path`
// identity governs each.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ItemRenderer } from "../presentation/index.ts";
import type { CapabilityHandler } from "./contract.ts";

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
 * above the read-gate drain deadline on purpose: a deletion racing a genuinely stuck
 * Handler may be refused once and then succeed on the retry its copy invites — which is
 * the honest outcome, as opposed to a refusal that could never come true.
 */
export const DEFAULT_CAPABILITY_HANDLER_TIMEOUT_MS = 10_000;

export class CapabilityHandlerTimeoutError extends Error {
  override readonly name = "CapabilityHandlerTimeoutError";
}

/**
 * Resolve with the Handler, or reject at the deadline. The Handler's own promise is not
 * cancellable — the point is that *this route* stops waiting on it.
 */
export async function withHandlerDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  id: string,
  action: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return await work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new CapabilityHandlerTimeoutError(
              `Handler ${id}/${action} did not settle within ${timeoutMs}ms and was abandoned.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
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
