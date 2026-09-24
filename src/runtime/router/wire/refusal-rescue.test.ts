// htmx will not swap a 4xx body unless the shell claims it, so `public/app.js` carries the list of
// refusal codes it rescues. A classic script can import nothing, so that list is written out —
// and this is what stops a new typed refusal from being written and never reaching a screen.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAPABILITY_RENAME_ERROR_CODE } from "../../../lifecycle/rename/presentation.ts";
import {
  CHOICE_DISABLED_ERROR_CODE,
  INVALID_CHOICE_ERROR_CODE,
  INVALID_FILE_REFERENCE_ERROR_CODE,
  MAX_LENGTH_EXCEEDED_ERROR_CODE,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../registry/index.ts";
import { RECORD_NOT_FOUND_ERROR_CODE } from "../../data/access/mutation.ts";
import {
  MUTATION_BUSY_ERROR_CODE,
  MUTATION_FAILED_ERROR_CODE,
  NOT_FOUND_ERROR_CODE,
  READ_UNAVAILABLE_ERROR_CODE,
} from "./failure-responses.ts";

describe("the shell's refusal rescue list", () => {
  test("is exactly the refusal codes the server can send", () => {
    const appScript = readFileSync(resolve("public/app.js"), "utf8");
    const start = appScript.indexOf("const isStructuredFormRefusal = [");
    expect(start).toBeGreaterThan(-1);
    const listed = appScript.slice(start, appScript.indexOf("]", start));
    const rescued = [...listed.matchAll(/"([a-z_]+)"/g)].map(([, code]) => code);

    expect(new Set(rescued)).toEqual(
      new Set([
        MISSING_REQUIRED_FIELDS_ERROR_CODE,
        INVALID_CHOICE_ERROR_CODE,
        CHOICE_DISABLED_ERROR_CODE,
        MAX_LENGTH_EXCEEDED_ERROR_CODE,
        INVALID_FILE_REFERENCE_ERROR_CODE,
        MUTATION_BUSY_ERROR_CODE,
        READ_UNAVAILABLE_ERROR_CODE,
        RECORD_NOT_FOUND_ERROR_CODE,
        MUTATION_FAILED_ERROR_CODE,
        CAPABILITY_RENAME_ERROR_CODE,
        NOT_FOUND_ERROR_CODE,
      ]),
    );
  });
});
