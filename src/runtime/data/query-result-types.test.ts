// What a Handler may declare a projected column to be: every pantry type but a file, the same list
// for the runtime that checks a descriptor and the checker that compiles a Handler against it.

import { describe, expect, test } from "bun:test";

import { handlerContractDeclarations } from "../../builder/generated-code-check.ts";
import { photoSpec } from "../../registry/fields/file.test-support.ts";
import { FILE_FIELD_TYPES } from "../../registry/index.ts";
import { QUERY_RESULT_TYPES } from "./query-result-types.ts";

describe("the declarable query-result types", () => {
  test("leave out every file type", () => {
    for (const type of FILE_FIELD_TYPES) {
      expect(QUERY_RESULT_TYPES as readonly string[]).not.toContain(type);
    }
  });

  test("are the union a generated Handler is compiled against", () => {
    const declared = /readonly type: ([^;]+);/.exec(handlerContractDeclarations(photoSpec()))?.[1];
    expect(declared).toBe(QUERY_RESULT_TYPES.map((type) => JSON.stringify(type)).join(" | "));
  });
});
