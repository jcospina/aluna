import { describe, expect, test } from "bun:test";
import { seedFrom } from "#design/lib/random.js";
import { INK_SEED_ATTR, inkSeedAttr, recordInkSeed } from "./ink-seed.ts";
import { renderItemWrapper } from "./list-container.ts";

// Where a drawn record's hand comes from: the record's own id, decided server-side. The other
// half, the ink system reading it back off the element, is in `ink-system.test.ts`.

describe("a record's hand is a function of its id alone", () => {
  test("the seed is the design system's own, so one algorithm draws the whole surface", () => {
    // `seedFrom` is what `design/scripts/desk/prompt-bar.js` already seeds with. The platform
    // reaches for the same function rather than restating FNV-1a on the server side.
    for (const id of ["9690f207-1269-4695-8981-7e49f9d1ee85", "1", "a", "récord-ç"]) {
      expect(recordInkSeed(id)).toBe(seedFrom(id));
    }

    // Pinned against fixed values as well as each other: types catch a change to what `seedFrom`
    // accepts, never to what it computes. Change the fold and every hand on the surface changes.
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
    // The fallback is the ink system's own mount-order seed, so such a row is still drawn and
    // merely loses its hand across a swap. A constant would give every idless row one hand.
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

    // The same record rendered into a different position, next to different neighbours, comes out
    // in the same hand. A seed derived from where the element sits is what the design forbids.
    const reordered = [{ id: "z" }, record, { id: "y" }]
      .map((each) => renderItemWrapper("<p>x</p>", each))
      .join("");
    expect(reordered).toContain(attr);
    expect(reordered.indexOf(attr)).toBeGreaterThan(0);
  });
});
