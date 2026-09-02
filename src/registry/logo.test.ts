// The logo's colour vocabulary: the hue families the word-list check validates, the shade
// ladder the platform resolves inside them, and the lifecycle values the registry stores.

import { describe, expect, test } from "bun:test";
import { PALETTE_COLOR_TOKENS } from "../presentation/tokens/design-tokens.ts";
import {
  capabilityLogoStateSchema,
  createCapabilityLogoSeed,
  LOGO_BIRTH_STATUS,
  LOGO_FAMILY_SHADES,
  LOGO_HUE_FAMILIES,
  LOGO_SHADES,
  LOGO_STATUSES,
  logoHueFamilySchema,
  logoSeedSchema,
  logoShadeFamily,
  MAX_LOGO_SEED,
  resolveLogoShades,
} from "./logo.ts";

describe("the eight hue families", () => {
  test("colour validation is a word-list check against exactly eight hues", () => {
    expect(LOGO_HUE_FAMILIES).toEqual([
      "grass_green",
      "forest_green",
      "teal_green",
      "cyan_blue",
      "golden_yellow",
      "mustard_ochre",
      "coral_orange",
      "amethyst_violet",
    ]);
    for (const family of LOGO_HUE_FAMILIES) {
      expect(logoHueFamilySchema.safeParse(family).success).toBe(true);
    }
  });

  test("a hue outside the eight fails", () => {
    for (const outside of ["ground", "surface", "ink", "blue", "Grass_green", "grass_green ", ""]) {
      expect(logoHueFamilySchema.safeParse(outside).success).toBe(false);
    }
  });

  // Three of the first four live capabilities took `sky` as their ground, and one of them
  // was a house — an object that sits under a sky. A family name that names a hue and
  // nothing else cannot be picked for what it depicts, which is why the vocabulary the
  // model reads is no longer the palette's token names.
  test("no family name is a scene noun the model could pick for what it depicts", () => {
    const scenery = /\b(sky|shade|sun|horizon|ground|floor|wall|sea|ocean|leaf|clay)\b/;
    for (const family of LOGO_HUE_FAMILIES) {
      expect(family, `"${family}" names a thing, not a hue`).not.toMatch(scenery);
    }
    expect(LOGO_HUE_FAMILIES as readonly string[]).not.toContain("sky");
  });

  test("signal red is reserved and is not offered", () => {
    // It exists in the palette — it is withheld from the logo on purpose, not missing.
    expect(PALETTE_COLOR_TOKENS.has("signal")).toBe(true);
    expect(LOGO_SHADES).not.toContain("signal");
    expect(logoHueFamilySchema.safeParse("signal").success).toBe(false);
  });
});

describe("the shade ladder", () => {
  test("every family opens onto four shades, and every shade has exactly one family", () => {
    expect(LOGO_SHADES).toHaveLength(32);
    expect(new Set(LOGO_SHADES).size).toBe(32);
    for (const family of LOGO_HUE_FAMILIES) {
      expect(LOGO_FAMILY_SHADES[family]).toHaveLength(4);
      for (const shade of LOGO_FAMILY_SHADES[family]) {
        expect(logoShadeFamily(shade)).toBe(family);
      }
    }
  });

  test("a family name is not itself a rung, and neither is a retired palette token", () => {
    for (const outside of ["sky", "sun", "leaf", "grass_green", "Grass", ""]) {
      expect(LOGO_SHADES).not.toContain(outside);
    }
  });
});

describe("resolving one capability's two colours", () => {
  test("both come from the families the spec named", () => {
    const cases = LOGO_HUE_FAMILIES.flatMap((ground) =>
      LOGO_HUE_FAMILIES.filter((companion) => companion !== ground).flatMap((companion) =>
        [1, 2, 3, 4, 17, 4096, MAX_LOGO_SEED].map((seed) => [ground, companion, seed] as const),
      ),
    );

    for (const [ground, companion, seed] of cases) {
      const [groundShade, companionShade] = resolveLogoShades(ground, companion, seed);
      expect(logoShadeFamily(groundShade)).toBe(ground);
      expect(logoShadeFamily(companionShade)).toBe(companion);
      expect(groundShade).not.toBe(companionShade);
    }
  });

  test("is pure and total — the same seed always draws the same pair", () => {
    for (const seed of [1, 99, 100_003, MAX_LOGO_SEED]) {
      expect(resolveLogoShades("cyan_blue", "mustard_ochre", seed)).toEqual(
        resolveLogoShades("cyan_blue", "mustard_ochre", seed),
      );
    }
  });

  // The whole point of the ladder. A spec model collapses to a mode — four consecutive
  // live capabilities came out carrying `sky` — so the family a capability names is not a
  // source of variety. The seed is, and it has to reach every rung.
  test("consecutive seeds walk the whole family, so a collapsed hue is still four colours", () => {
    const drawn = new Set(
      [0, 1, 2, 3].map(
        (offset) => resolveLogoShades("cyan_blue", "mustard_ochre", 100 + offset)[0],
      ),
    );
    expect(drawn).toEqual(new Set(LOGO_FAMILY_SHADES.cyan_blue));
  });

  // Taking the same remainder for both would lock every capability to the same rung of
  // each of its two families, which puts the mode straight back one level down.
  test("the two draws are decorrelated, not the same rung twice", () => {
    const sameRung = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].filter((seed) => {
      const [ground, companion] = resolveLogoShades("cyan_blue", "coral_orange", seed);
      return (
        LOGO_FAMILY_SHADES.cyan_blue.indexOf(ground as never) ===
        LOGO_FAMILY_SHADES.coral_orange.indexOf(companion as never)
      );
    });
    // A locked pair would be all sixteen; independent draws land together about a quarter
    // of the time.
    expect(sameRung.length).toBeLessThanOrEqual(6);
  });

  // The closed lookup this replaced paired leaf/shade, teal/sky, sun/ochre and
  // clay/violet — four distinct pairs for the whole product. Eight freely-paired anchors
  // lifted that to 56 and the model still collapsed onto one of them. Eight families of
  // four is 896 cross-family ordered pairs, and which one comes up is not the model's.
  test("open over 896 ordered pairs of shades from two different families", () => {
    const pairs = new Set<string>();
    for (const ground of LOGO_SHADES) {
      for (const companion of LOGO_SHADES) {
        if (logoShadeFamily(ground) === logoShadeFamily(companion)) continue;
        pairs.add(JSON.stringify([ground, companion]));
      }
    }

    expect(pairs.size).toBe(896);
    // Both directions of every pair are reachable: which colour is the field and which
    // is the object are two different drawings, and the model chooses.
    expect(pairs.has(JSON.stringify(["cyan", "teal"]))).toBe(true);
    expect(pairs.has(JSON.stringify(["teal", "cyan"]))).toBe(true);
  });
});

describe("the logo lifecycle", () => {
  test("carries exactly the four statuses, born absent", () => {
    expect(LOGO_STATUSES).toEqual(["absent", "generating", "present", "abandoned"]);
    expect(LOGO_BIRTH_STATUS).toBe("absent");
  });

  test("status and attempts travel together, and nothing else rides along", () => {
    expect(capabilityLogoStateSchema.safeParse({ status: "present", attempts: 1 }).success).toBe(
      true,
    );
    expect(capabilityLogoStateSchema.safeParse({ status: "present" }).success).toBe(false);
    expect(capabilityLogoStateSchema.safeParse({ attempts: 1 }).success).toBe(false);
    expect(capabilityLogoStateSchema.safeParse({ status: "queued", attempts: 0 }).success).toBe(
      false,
    );
    expect(capabilityLogoStateSchema.safeParse({ status: "absent", attempts: -1 }).success).toBe(
      false,
    );
    expect(capabilityLogoStateSchema.safeParse({ status: "absent", attempts: 1.5 }).success).toBe(
      false,
    );
    expect(
      capabilityLogoStateSchema.safeParse({ status: "absent", attempts: 0, url: "x" }).success,
    ).toBe(false);
  });
});

describe("the seed", () => {
  test("is a positive integer inside the provider's domain", () => {
    expect(logoSeedSchema.safeParse(0).success).toBe(false);
    expect(logoSeedSchema.safeParse(-1).success).toBe(false);
    expect(logoSeedSchema.safeParse(1.5).success).toBe(false);
    expect(logoSeedSchema.safeParse(MAX_LOGO_SEED + 1).success).toBe(false);
    expect(logoSeedSchema.safeParse(1).success).toBe(true);
    expect(logoSeedSchema.safeParse(MAX_LOGO_SEED).success).toBe(true);
  });

  test("minting always produces a valid seed, and does not derive one from a name", () => {
    const drawn = new Set<number>();
    for (let index = 0; index < 200; index += 1) {
      const seed = createCapabilityLogoSeed();
      expect(logoSeedSchema.safeParse(seed).success).toBe(true);
      drawn.add(seed);
    }
    // Nothing about the capability feeds this, so 200 draws are effectively never one
    // value — a derived seed would collapse to a handful.
    expect(drawn.size).toBeGreaterThan(190);
  });
});
