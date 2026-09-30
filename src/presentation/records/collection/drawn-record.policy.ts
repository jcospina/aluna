import { describe, expect, test } from "bun:test";

import { readSource as read } from "../../safety/source.test-support.ts";
import { INK_SEED_ATTR } from "./ink-seed.ts";
import { ITEM_TRIGGER_CLASS } from "./list-container.ts";

// Where a drawn record's hand comes from is run in `drawn-record.test.ts`. This holds the two
// ends of it in place: the shipped card is drawn at all, and only the platform's wrapper seeds it.

describe("a record's hand stays the platform's", () => {
  test("the card is in the drawn set, which is what makes the seed mean anything", () => {
    // The DOM tests in `ink-system.test.ts` call `drawAlso` themselves, so they never prove the
    // shipped card reaches it. Membership is asserted here, against the file that ships it.
    expect(read("public/core/ink.js")).toContain(`".${ITEM_TRIGGER_CLASS}"`);
  });

  test("nothing outside the platform's own wrapper is asked for one", () => {
    // The generation pipeline never learns the ink system exists: no spec key, no registry
    // column, and neither prompt names the system, the seed attribute or the runtime's classes.
    const coupling = [INK_SEED_ATTR, "inkSeed", "ink system", "is-ink", "mountInk", "ink.js"];
    for (const path of [
      "src/registry/spec/spec.ts",
      "src/builder/units/generation/unit-prompts.ts",
      "src/builder/units/generation/few-shot/few-shot-gallery.ts",
    ]) {
      const source = read(path);
      for (const term of coupling) expect(source, `${path} names ${term}`).not.toContain(term);
    }
  });
});
