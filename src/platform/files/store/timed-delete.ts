// An object-store delete with a time limit, shared by the cleanup worker and deletion's files
// adapter: a store that hangs past the limit fails that delete, and the caller retries it later.

import type { ObjectStore } from "./object-store.ts";

/** Long enough for any local unlink; a store that hangs past it counts as a failed attempt. */
export const DEFAULT_FILE_DELETE_TIMEOUT_MS = 60_000;

/** Delete `key` from `store`, or reject once `limitMs` passes first. */
export async function deleteObjectWithin(
  store: Pick<ObjectStore, "delete">,
  key: string,
  limitMs = DEFAULT_FILE_DELETE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The delete took longer than ${limitMs} ms.`)),
      limitMs,
    );
    timer.unref?.();
  });
  try {
    await Promise.race([store.delete(key), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
