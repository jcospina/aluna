import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_FILE_BYTES, MAX_FILE_BYTES_ENV_VAR } from "../platform/files/file-cap.ts";
import { resolveServeOptions } from "./serve-options.ts";

describe("what the server is started with", () => {
  test("its body cap is the per-file cap, by default and when configured", () => {
    expect(resolveServeOptions({}).maxRequestBodySize).toBe(DEFAULT_MAX_FILE_BYTES);
    for (const configured of [2048, DEFAULT_MAX_FILE_BYTES * 2]) {
      const env = { [MAX_FILE_BYTES_ENV_VAR]: String(configured) };
      expect(resolveServeOptions(env).maxRequestBodySize).toBe(configured);
    }
  });

  test("a malformed file cap stops it before it is started", () => {
    expect(() => resolveServeOptions({ [MAX_FILE_BYTES_ENV_VAR]: "500MB" })).toThrow(
      MAX_FILE_BYTES_ENV_VAR,
    );
  });

  test("its port is PORT when that is a whole number, including 0", () => {
    const fallback = resolveServeOptions({}).port;
    expect(resolveServeOptions({ PORT: "0" }).port).toBe(0);
    expect(resolveServeOptions({ PORT: String(fallback + 1) }).port).toBe(fallback + 1);
    for (const PORT of ["", " ", "abc", "-1", "80.5", "0x10", "1e3", "65536", "70000"]) {
      expect({ PORT, port: resolveServeOptions({ PORT }).port }).toEqual({ PORT, port: fallback });
    }
  });
});
