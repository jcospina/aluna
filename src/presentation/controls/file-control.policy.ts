import { describe, expect, test } from "bun:test";
import { codeOf } from "../safety/source.test-support.ts";

/** A save never carries bytes: an upload travels ahead of it (decision 8), so no form is multipart. */
describe("file fields in the form renderer", () => {
  test("never make a form carry a file's bytes", () => {
    for (const path of [
      "src/presentation/fields/field-renderer.ts",
      "src/presentation/controls/file-control.ts",
    ]) {
      for (const trace of ["multipart/form-data", "enctype", 'type="file"', "FileList"]) {
        expect(codeOf(path), `${path} names ${trace}`).not.toContain(trace);
      }
    }
  });
});
