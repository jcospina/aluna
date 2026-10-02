// The pending-only route (Module 7 PLAN decisions 19 and 32): a form hands back the keys it let go
// of that no save claimed. One platform write moves each key still `pending` to
// `cleanup_enqueued`, and the worker it wakes after that commit removes the bytes. A key a save,
// the sweep or a deletion took first is left as it is and counts as success, so a discard racing
// a save can never leave a saved record without its file. The body is JSON `{ "keys": [...] }`.

import type { Context, Hono } from "hono";
import { FILE_DISCARD_PATH } from "#shell/core/shell-dom.js";
import { enqueuePendingFiles, isFileKey } from "../../../platform/files/store/ledger.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { MutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import { NO_STORE } from "../../http/cache-headers.ts";
import { guardWritingRoute } from "../../http/index.ts";

export interface FileDiscardDeps {
  readonly databases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  /** Told once a discard that moved a key has committed. */
  readonly wakeFileCleanup: () => void;
}

/** The keys a discard names, each once, or undefined for a body that is not a list of keys. */
async function readKeys(c: Context): Promise<string[] | undefined> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return undefined;
  }
  const keys = typeof body === "object" && body !== null ? Reflect.get(body, "keys") : undefined;
  if (!Array.isArray(keys) || !keys.every(isFileKey)) return undefined;
  return [...new Set(keys)];
}

async function discard(c: Context, deps: FileDiscardDeps): Promise<Response> {
  const keys = await readKeys(c);
  if (!keys) return c.body(null, 400, NO_STORE);
  if (keys.length === 0) return c.body(null, 204, NO_STORE);
  const moved = await deps.mutationCoordinator.withPlatformWrite(() =>
    enqueuePendingFiles(deps.databases.readwrite, keys),
  );
  if (moved > 0) deps.wakeFileCleanup();
  return c.body(null, 204, NO_STORE);
}

export function registerFileDiscardRoute(app: Hono, deps: FileDiscardDeps): void {
  app.post(FILE_DISCARD_PATH, guardWritingRoute(), (c) => discard(c, deps));
}
