// Where the object store keeps its bytes: configurable, as the file cap is (Module 7 PLAN, epic
// 7.1). A leaf, so the app, boot and `bun run reset` read the one setting without opening a store.

import { OBJECT_STORE_ROOT } from "../persistence/table-names.ts";

export const OBJECT_STORE_ROOT_ENV_VAR = "OMNI_OBJECT_STORE_ROOT";

/** Under the root: uploads still streaming, or admitted and waiting on their ledger row. */
export const STAGING_DIRECTORY = ".incoming";

/** The configured root, a relative one read from the working directory; `storage` when unset. */
export function resolveObjectStoreRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env[OBJECT_STORE_ROOT_ENV_VAR]?.trim() || OBJECT_STORE_ROOT;
}
