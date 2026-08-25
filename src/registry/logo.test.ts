// The logo's closed vocabulary: the word list ground validation is, the companion
// derivation, and the lifecycle values the registry stores.

import { describe, expect, test } from "bun:test";
import { PALETTE_COLOR_TOKENS } from "../presentation/design-tokens.ts";
import {
  capabilityLogoStateSchema,
  createCapabilityLogoSeed,
  LOGO_BIRTH_STATUS,
  LOGO_GROUND_ANCHORS,
  LOGO_STATUSES,
  type LogoGround,
  logoGroundCompanion,
  logoGroundSchema,
  logoRequestColors,
  logoSeedSchema,
  MAX_LOGO_SEED,
} from "./logo.ts";

describe("the eight tint anchors", () => {
  test("ground validation is a word-list check against exactly eight names", () => {
    expect(LOGO_GROUND_ANCHORS).toEqual([
      "leaf",
      "shade",
      "teal",
      "sky",
      "sun",
      "ochre",
      "clay",
      "violet",
    ]);
    for (const anchor of LOGO_GROUND_ANCHORS) {
      expect(logoGroundSchema.safeParse(anchor).success).toBe(true);
    }
  });

  test("a ground outside the eight fails", () => {
    for (const outside of ["ground", "surface", "ink", "blue", "Leaf", "leaf ", ""]) {
      expect(logoGroundSchema.safeParse(outside).success).toBe(false);
    }
  });

  test("signal red is reserved and is not offered", () => {
    // It exists in the palette — it is withheld from the logo on purpose, not missing.
    expect(PALETTE_COLOR_TOKENS.has("signal")).toBe(true);
    expect(LOGO_GROUND_ANCHORS as readonly string[]).not.toContain("signal");
    expect(logoGroundSchema.safeParse("signal").success).toBe(false);
  });

  test("every anchor is a real High Meadow palette token", () => {
    // Cross-checked so a token renamed in the stylesheet fails here rather than
    // becoming a ground that resolves to nothing at render time.
    for (const anchor of LOGO_GROUND_ANCHORS) {
      expect(PALETTE_COLOR_TOKENS.has(anchor)).toBe(true);
    }
  });
});

describe("the companion lookup", () => {
  test("is closed over the eight and symmetric", () => {
    for (const anchor of LOGO_GROUND_ANCHORS) {
      const companion = logoGroundCompanion(anchor);
      expect(LOGO_GROUND_ANCHORS as readonly string[]).toContain(companion);
      expect(companion).not.toBe(anchor);
      expect(logoGroundCompanion(companion)).toBe(anchor);
    }
  });

  test("pairs leaf/shade, teal/sky, sun/ochre and clay/violet", () => {
    expect(logoGroundCompanion("leaf")).toBe("shade");
    expect(logoGroundCompanion("teal")).toBe("sky");
    expect(logoGroundCompanion("sun")).toBe("ochre");
    expect(logoGroundCompanion("clay")).toBe("violet");
  });

  test("a request's two colours are the selected ground first, then its companion", () => {
    // The whole of the request's colour decision: no caller argument, no second
    // authored key, and the order the contract pins.
    expect(logoRequestColors("sky")).toEqual(["sky", "teal"]);
    expect(logoRequestColors("ochre")).toEqual(["ochre", "sun"]);
    for (const anchor of LOGO_GROUND_ANCHORS) {
      expect(logoRequestColors(anchor)).toEqual([anchor, logoGroundCompanion(anchor)]);
    }
  });

  test("an unknown ground throws rather than inventing a partner", () => {
    expect(() => logoGroundCompanion("signal" as LogoGround)).toThrow(/No companion/);
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
