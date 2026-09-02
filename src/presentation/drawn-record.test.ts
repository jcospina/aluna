import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { seedFrom } from "#design/lib/random.js";
import { INK_SEED_ATTR, inkSeedAttr, recordInkSeed } from "./ink-seed.ts";
import { ITEM_TRIGGER_CLASS, renderItemWrapper } from "./list-container.ts";

// Where a drawn record's hand comes from: the record's own id, decided server-side and
// written into the markup the platform already owns. The other half — the ink system
// reading it back off the element and drawing with it — is in `ink-system.test.ts`,
// which owns the one fake DOM the runtime may be bound to.

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("a record's hand is a function of its id alone", () => {
  test("the seed is the design system's own, so one algorithm draws the whole surface", () => {
    // `seedFrom` is what `design/scripts/prompt-bar.js` already seeds with. The platform
    // reaches for the same function rather than restating FNV-1a on the server side.
    for (const id of ["9690f207-1269-4695-8981-7e49f9d1ee85", "1", "a", "récord-ç"]) {
      expect(recordInkSeed(id)).toBe(seedFrom(id));
    }

    // Pinned against fixed values as well as against each other. Types cannot catch a
    // change to what `seedFrom` *computes* — only to what it accepts. These numbers are
    // what does: change the fold and every hand on the surface changes with it.
    expect(seedFrom("dune")).toBe(71843);
    expect(seedFrom("")).toBe(36261);
    expect(recordInkSeed("9690f207-1269-4695-8981-7e49f9d1ee85")).toBe(74080);
  });

  test("equal for two renders of the same record, and different between records", () => {
    const id = "9690f207-1269-4695-8981-7e49f9d1ee85";
    expect(recordInkSeed(id)).toBe(recordInkSeed(id));

    const ids = Array.from({ length: 400 }, (_, i) => `record-${i}`);
    const seeds = new Set(ids.map((each) => recordInkSeed(each)));
    // Not a promise of injectivity — the seed range is finite — but a collision rate this
    // low is what keeps two cards side by side from sharing a hand.
    expect(seeds.size).toBeGreaterThan(395);
  });

  test("a record with no id keeps no hand rather than sharing one", () => {
    // The fallback is the ink system's own mount-order seed, so such a row is still drawn
    // and merely does not hold its hand across a swap. A constant would be worse: every
    // idless row on the surface would come out in the same hand.
    for (const missing of [null, undefined, ""]) {
      expect(recordInkSeed(missing)).toBeNull();
      expect(inkSeedAttr(missing)).toBe("");
    }
  });

  test("the wrapper carries it, and where the card sits is not part of it", () => {
    const record = { id: "abc-123", title: "Dune" };
    const first = renderItemWrapper("<p>x</p>", record);
    const attr = ` ${INK_SEED_ATTR}="${seedFrom("abc-123")}"`;
    expect(first).toContain(attr);

    // The same record rendered into a different position in a different list, next to
    // different neighbours, comes out in the same hand. A seed derived from where the
    // element sits is exactly what the design system forbids.
    const reordered = [{ id: "z" }, record, { id: "y" }]
      .map((each) => renderItemWrapper("<p>x</p>", each))
      .join("");
    expect(reordered).toContain(attr);
    expect(reordered.indexOf(attr)).toBeGreaterThan(0);
  });

  test("the card is in the drawn set, which is what makes the seed mean anything", () => {
    // The DOM tests in `ink-system.test.ts` call `drawAlso` themselves, so they prove the
    // runtime honours a pre-assigned seed without proving the shipped card ever reaches it.
    // Membership is asserted here, against the file that ships it.
    expect(read("public/ink.js")).toContain(`".${ITEM_TRIGGER_CLASS}"`);
  });

  test("nothing outside the platform's own wrapper is asked for one", () => {
    // The generation pipeline never learns the ink system exists. The spec has no key for
    // a hand, the registry stores none, and neither prompt names the system, the seed
    // attribute, or the classes the runtime writes — so a generated renderer has nothing
    // to reach for even if it tried.
    const coupling = [INK_SEED_ATTR, "inkSeed", "ink system", "is-ink", "mountInk", "ink.js"];
    for (const path of [
      "src/registry/spec/spec.ts",
      "src/builder/units/generation/unit-prompts.ts",
      "src/builder/units/generation/few-shot-gallery.ts",
    ]) {
      const source = read(path);
      for (const term of coupling) expect(source, `${path} names ${term}`).not.toContain(term);
    }
  });
});
