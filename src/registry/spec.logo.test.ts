// The four model-authored logo keys on the spec, and the two runtime values the
// registry row adds. Field/action shape lives in `spec.test.ts` and
// `spec.behavior.test.ts`; the vocabulary itself is pinned in `logo.test.ts`.

import { describe, expect, test } from "bun:test";
import { LOGO_HUE_FAMILIES } from "./logo.ts";
import { validSpec } from "./spec.test-support.ts";
import {
  capabilityRegistryWriteSchema,
  capabilityRowSchema,
  capabilitySpecFromRow,
  capabilitySpecSchema,
  MAX_CAPABILITY_NOUN_LENGTH,
  MAX_LOGO_SUBJECT_LENGTH,
} from "./spec.ts";

const INCARNATION_ID = "11111111-1111-4111-8111-111111111111";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    ...validSpec(),
    incarnation_id: INCARNATION_ID,
    version: 1,
    artifacts_path: `capabilities/notes/${INCARNATION_ID}/v1/`,
    seed: 184206,
    logo: { status: "absent" as const, attempts: 0 },
    display_label_override: null,
    ...overrides,
  };
}

describe("the authored logo keys", () => {
  test("a spec carrying subject, ground, companion and noun validates", () => {
    const spec = capabilitySpecSchema.parse(validSpec());
    expect(spec.subject).toBe("an open notebook");
    expect(spec.ground).toBe("grass_green");
    expect(spec.companion).toBe("coral_orange");
    expect(spec.noun).toBe("note");
  });

  test("all four are required — none is optional and none has a default", () => {
    for (const key of ["subject", "ground", "companion", "noun"] as const) {
      const spec: Record<string, unknown> = { ...validSpec() };
      delete spec[key];
      const result = capabilitySpecSchema.safeParse(spec);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain(key);
    }
  });

  test("every one of the eight hue families is admissible as either colour", () => {
    for (const ground of LOGO_HUE_FAMILIES) {
      const companion = ground === "coral_orange" ? "grass_green" : "coral_orange";
      expect(capabilitySpecSchema.safeParse(validSpec({ ground, companion })).success).toBe(true);
      expect(
        capabilitySpecSchema.safeParse(validSpec({ ground: companion, companion: ground })).success,
      ).toBe(true);
    }
  });

  // The whole point of the change: the second colour is no longer one fixed partner per
  // ground. Every ordered pair of two different anchors is a spec the model may author —
  // 56 of them, where the closed lookup admitted four.
  test("any two different anchors pair, in either order", () => {
    let admitted = 0;
    for (const ground of LOGO_HUE_FAMILIES) {
      for (const companion of LOGO_HUE_FAMILIES) {
        if (ground === companion) continue;
        expect(capabilitySpecSchema.safeParse(validSpec({ ground, companion })).success).toBe(true);
        admitted += 1;
      }
    }
    expect(admitted).toBe(56);
  });

  // Only the whole object can see this; a per-field enum cannot. A spec naming one
  // colour twice would ask for an object drawn in the colour of the field it sits on.
  test("a companion equal to the ground is refused, by name", () => {
    for (const anchor of LOGO_HUE_FAMILIES) {
      const result = capabilitySpecSchema.safeParse(
        validSpec({ ground: anchor, companion: anchor }),
      );
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("companion must differ from ground");
    }
  });

  test("a companion outside the eight fails validation, and so does signal red", () => {
    for (const companion of ["signal", "blue", "surface", "Clay", ""]) {
      const result = capabilitySpecSchema.safeParse({ ...validSpec(), companion });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("companion");
    }
  });

  // The same refinement guards the row and the write, not only the authored spec — a
  // hand-edited database cannot smuggle one colour in twice either.
  test("the row and the write shape refuse it too", () => {
    expect(
      capabilityRowSchema.safeParse(
        validRow({ ground: "golden_yellow", companion: "golden_yellow" }),
      ).success,
    ).toBe(false);
    const { logo: _logo, ...write } = validRow({
      ground: "golden_yellow",
      companion: "golden_yellow",
    });
    expect(capabilityRegistryWriteSchema.safeParse(write).success).toBe(false);
  });

  test("a ground outside the eight fails validation, and so does signal red", () => {
    for (const ground of ["signal", "blue", "surface", "Leaf", ""]) {
      const result = capabilitySpecSchema.safeParse({ ...validSpec(), ground });
      expect(result.success).toBe(false);
      // The issue is on the ground's own path — "ground" also appears in the
      // companion refinement's message, so matching the word alone would not
      // discriminate between the two rules.
      expect(result.error?.issues.some((issue) => issue.path[0] === "ground")).toBe(true);
    }
  });

  test("subject is one short non-blank line", () => {
    expect(capabilitySpecSchema.safeParse(validSpec({ subject: "" })).success).toBe(false);
    expect(capabilitySpecSchema.safeParse(validSpec({ subject: "   " })).success).toBe(false);
    expect(
      capabilitySpecSchema.safeParse(validSpec({ subject: "a lamp\nand a desk" })).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse(
        validSpec({ subject: "x".repeat(MAX_LOGO_SUBJECT_LENGTH + 1) }),
      ).success,
    ).toBe(false);
    expect(
      capabilitySpecSchema.safeParse(validSpec({ subject: "x".repeat(MAX_LOGO_SUBJECT_LENGTH) }))
        .success,
    ).toBe(true);
  });

  test("noun is one short non-blank line", () => {
    expect(capabilitySpecSchema.safeParse(validSpec({ noun: "" })).success).toBe(false);
    expect(capabilitySpecSchema.safeParse(validSpec({ noun: "note\nbook" })).success).toBe(false);
    expect(
      capabilitySpecSchema.safeParse(
        validSpec({ noun: "x".repeat(MAX_CAPABILITY_NOUN_LENGTH + 1) }),
      ).success,
    ).toBe(false);
  });
});

describe("the platform-owned runtime values", () => {
  test("a spec cannot author the seed or the logo lifecycle", () => {
    expect(capabilitySpecSchema.safeParse({ ...validSpec(), seed: 1 }).success).toBe(false);
    expect(
      capabilitySpecSchema.safeParse({
        ...validSpec(),
        logo: { status: "present", attempts: 1 },
      }).success,
    ).toBe(false);
  });

  test("a row round-trips its seed and lifecycle deep-equal", () => {
    const row = validRow({ logo: { status: "present" as const, attempts: 2 } });
    expect(capabilityRowSchema.parse(row)).toEqual(row);
  });

  test("a row without a seed or a lifecycle fails — no compatibility default fills one in", () => {
    for (const key of ["seed", "logo"] as const) {
      const row: Record<string, unknown> = validRow();
      delete row[key];
      expect(capabilityRowSchema.safeParse(row).success).toBe(false);
    }
  });

  test("the write shape carries the seed but has no room for a lifecycle at all", () => {
    const write = { ...validRow() } as Record<string, unknown>;
    delete write.logo;
    // The rename override is row-only for the same reason the lifecycle is, and is
    // dropped at the same boundary: a write may not carry either.
    delete write.display_label_override;
    expect(capabilityRegistryWriteSchema.safeParse(write).success).toBe(true);
    // A write that tried to name a status is refused rather than quietly ignored here;
    // the store drops the key explicitly at its own boundary.
    expect(capabilityRegistryWriteSchema.safeParse(validRow()).success).toBe(false);
  });

  test("the authored view of a row is the spec, without the platform's runtime values", () => {
    const spec = capabilitySpecFromRow(capabilityRowSchema.parse(validRow()));
    expect(spec).toEqual(capabilitySpecSchema.parse(validSpec()));
    expect(spec).not.toHaveProperty("seed");
    expect(spec).not.toHaveProperty("logo");
  });
});
