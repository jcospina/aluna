import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_LIST_FILES,
  MAX_FILE_BYTES_ENV_VAR,
  MAX_LIST_FILES_ENV_VAR,
  resolveMaxFileBytes,
  resolveMaxListFiles,
} from "./file-cap.ts";

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

describe("the list's count", () => {
  test("is the default unless configured", () => {
    expect(resolveMaxListFiles({})).toBe(DEFAULT_MAX_LIST_FILES);
    expect(resolveMaxListFiles({ [MAX_LIST_FILES_ENV_VAR]: " " })).toBe(DEFAULT_MAX_LIST_FILES);
  });

  test("is the configured number of files", () => {
    expect(resolveMaxListFiles({ [MAX_LIST_FILES_ENV_VAR]: " 3 " })).toBe(3);
  });

  test("refuses a value that is not a positive whole number of files, naming the variable", () => {
    for (const raw of ["0", "-2", "2.5", "six", "1e2"]) {
      expect(() => resolveMaxListFiles({ [MAX_LIST_FILES_ENV_VAR]: raw })).toThrow(
        MAX_LIST_FILES_ENV_VAR,
      );
    }
  });
});
