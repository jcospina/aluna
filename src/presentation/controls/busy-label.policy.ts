import { describe, expect, test } from "bun:test";
import { readSource } from "../safety/source.test-support.ts";
import { ADDING_LABEL, SAVING_RECORD_LABEL } from "./busy-label.ts";

// The browser reads the pending sentence off the attribute the server wrote, so a reader that
// spells one out itself is a second copy of the words that drifts when the server's change.

const READERS = ["public/records/record-mutations.js", "public/desk/logos/logo-menu.js"] as const;

describe("the busy-label seam", () => {
  test("no reader restates a label the server authored", () => {
    for (const reader of READERS) {
      const source = readSource(reader);
      for (const label of ["Add", "Save", "Delete record", ADDING_LABEL, SAVING_RECORD_LABEL]) {
        expect(source, `${reader} restates ${label}`).not.toContain(`"${label}"`);
      }
    }
  });
});
