import { expect, test } from "bun:test";

import { codeOf } from "../safety/source.test-support.ts";
import { REQUIRED_FIELD_SENTENCE } from "./field-chrome.ts";

// What the field-error module leaves to others; `field-errors.test.ts` runs the module.

test("the required sentence has one author, and the client is not it", () => {
  // It reads the words off the form the server rendered; a second literal would be a second
  // source for one sentence.
  expect(codeOf("public/field-errors.js")).not.toContain(REQUIRED_FIELD_SENTENCE);
});
