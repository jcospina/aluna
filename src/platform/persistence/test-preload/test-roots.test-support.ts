// The platform's default roots and the settings that move them, for the test preload to point at
// scratch and for a test that spawns the server to hand back. Leaves only: the preload imports this
// before any test file, so nothing here may open a database or read a root.

import {
  ARTIFACTS_ROOT_ENV_VAR,
  DEFAULT_ARTIFACTS_ROOT,
} from "../../../builder/artifacts/artifacts-root.ts";
import {
  OBJECT_STORE_ROOT,
  OBJECT_STORE_ROOT_ENV_VAR,
} from "../../files/store/object-store-root.ts";
import { DB_PATH, DB_PATH_ENV_VAR } from "../db-path.ts";

/** Each root's setting, and where the root sits when that setting is unset. */
export const PLATFORM_ROOT_DEFAULTS = {
  [DB_PATH_ENV_VAR]: DB_PATH,
  [OBJECT_STORE_ROOT_ENV_VAR]: OBJECT_STORE_ROOT,
  [ARTIFACTS_ROOT_ENV_VAR]: DEFAULT_ARTIFACTS_ROOT,
} as const;

/**
 * `env` without the preload's scratch roots, so a server spawned with it resolves every root
 * against its own working directory, as it does outside the suite.
 */
export function withDefaultRoots(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const name of Object.keys(PLATFORM_ROOT_DEFAULTS)) delete copy[name];
  return copy;
}
