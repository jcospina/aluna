// The per-file cap (Module 7 PLAN decision 7): one number for every family, configurable. It
// imports one leaf and nothing else, because boot reads it for the server's global body cap before
// any file code exists to load.

import { parseWholeNumber } from "../whole-number.ts";

export const DEFAULT_MAX_FILE_BYTES = 500 * 1024 * 1024;

export const MAX_FILE_BYTES_ENV_VAR = "OMNI_MAX_FILE_BYTES";

/**
 * The configured cap in bytes. A value that is not a positive whole number throws naming the
 * variable, because a cap silently replaced by the default admits files the operator refused.
 */
export function resolveMaxFileBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[MAX_FILE_BYTES_ENV_VAR]?.trim();
  if (!raw) return DEFAULT_MAX_FILE_BYTES;
  const bytes = parseWholeNumber(raw);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(
      `${MAX_FILE_BYTES_ENV_VAR} must be a positive whole number of bytes, such as ` +
        `${DEFAULT_MAX_FILE_BYTES}; it is "${raw}".`,
    );
  }
  return bytes;
}
