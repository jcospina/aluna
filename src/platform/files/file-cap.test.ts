import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_FILE_BYTES, MAX_FILE_BYTES_ENV_VAR, resolveMaxFileBytes } from "./file-cap.ts";

describe("the per-file cap", () => {
  test("is the default unless configured", () => {
    expect(resolveMaxFileBytes({})).toBe(DEFAULT_MAX_FILE_BYTES);
    expect(resolveMaxFileBytes({ [MAX_FILE_BYTES_ENV_VAR]: "  " })).toBe(DEFAULT_MAX_FILE_BYTES);
  });

  test("is the configured number of bytes", () => {
    expect(resolveMaxFileBytes({ [MAX_FILE_BYTES_ENV_VAR]: " 2048 " })).toBe(2048);
  });

  test("refuses to boot on a value that is not a positive whole number of bytes", () => {
    for (const raw of ["0", "-1", "1.5", "1e9", "500MB", "0x10", "99999999999999999999"]) {
      expect(() => resolveMaxFileBytes({ [MAX_FILE_BYTES_ENV_VAR]: raw })).toThrow(
        MAX_FILE_BYTES_ENV_VAR,
      );
    }
  });
});
