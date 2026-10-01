// The per-file cap and the list's count (Module 7 PLAN decision 7): one number for every family,
// and one for how many files a `file[]` holds, both configurable. It imports one leaf and nothing
// else, because boot reads the byte cap for the server's global body cap before any file code
// exists to load.

import { parseWholeNumber } from "../whole-number.ts";

export const DEFAULT_MAX_FILE_BYTES = 500 * 1024 * 1024;

export const MAX_FILE_BYTES_ENV_VAR = "OMNI_MAX_FILE_BYTES";

export const DEFAULT_MAX_LIST_FILES = 20;

export const MAX_LIST_FILES_ENV_VAR = "OMNI_MAX_LIST_FILES";

/**
 * The configured cap in bytes. A value that is not a positive whole number throws naming the
 * variable, because a cap silently replaced by the default admits files the operator refused.
 */
export function resolveMaxFileBytes(env: NodeJS.ProcessEnv = process.env): number {
  return resolvePositive(env, MAX_FILE_BYTES_ENV_VAR, DEFAULT_MAX_FILE_BYTES, "bytes");
}

/** How many files one `file[]` may hold, refused as the byte cap is when it is not a count. */
export function resolveMaxListFiles(env: NodeJS.ProcessEnv = process.env): number {
  return resolvePositive(env, MAX_LIST_FILES_ENV_VAR, DEFAULT_MAX_LIST_FILES, "files");
}

function resolvePositive(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  unit: string,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = parseWholeNumber(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be a positive whole number of ${unit}, such as ${fallback}; it is "${raw}".`,
    );
  }
  return value;
}
