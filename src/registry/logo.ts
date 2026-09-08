// The logo's colour vocabulary: the eight hue families a spec's two colours may name, the shade
// ladder each family opens onto, and the durable lifecycle the registry keeps for the artwork
// (ADR-0007 L2/L3/L9/L11; `modules/05-the-desk/PLAN.md` decisions 39 and 42).
//
// The model names a hue and the platform names the shade. A spec authors `ground` and `companion`
// as families, which must differ, and which of a family's four rungs a capability wears is
// resolved from its incarnation seed by {@link resolveLogoShades}, which no caller may steer.
//
// That seed is the only entropy in the path: a spec-authoring model collapses to a mode — each
// build is a stateless call that has never seen another capability — so four consecutive live
// capabilities came out the same colour. Validation stays a word-list check over lists chosen
// saturated and light enough for the tile, and L9 still permits two capabilities to look alike.

import { z } from "zod";

/**
 * The eight hue families a spec's `ground` and `companion` may name. Hue words, not scene nouns:
 * `sky` in the list made it a backdrop, and three of the first four live capabilities took it.
 */
export const LOGO_HUE_FAMILIES = [
  "grass_green",
  "forest_green",
  "teal_green",
  "cyan_blue",
  "golden_yellow",
  "mustard_ochre",
  "coral_orange",
  "amethyst_violet",
] as const;

export const logoHueFamilySchema = z.enum(LOGO_HUE_FAMILIES);
export type LogoHueFamily = z.infer<typeof logoHueFamilySchema>;

/**
 * The four shades each family opens onto, varying in hue nuance as well as lightness so four
 * `cyan_blue` capabilities are not four tints of one blue. `logo.test.ts` measures each for chroma.
 */
export const LOGO_FAMILY_SHADES = {
  grass_green: ["grass", "emerald", "lime", "clover"],
  forest_green: ["forest", "pine", "fern", "juniper"],
  teal_green: ["teal", "turquoise", "viridian", "jade"],
  cyan_blue: ["cyan", "azure", "aqua", "cerulean"],
  golden_yellow: ["golden", "amber", "marigold", "lemon"],
  mustard_ochre: ["mustard", "ochre", "turmeric", "cinnamon"],
  coral_orange: ["coral", "tangerine", "persimmon", "apricot"],
  amethyst_violet: ["amethyst", "iris", "orchid", "plum"],
} as const satisfies Record<LogoHueFamily, readonly [string, string, string, string]>;

/** Every rung of every family, flattened. No shade is *stored* — a capability keeps its
 *  two families and its seed, and the pair is resolved from them on every read. */
export const LOGO_SHADES = Object.values(LOGO_FAMILY_SHADES).flat() as readonly LogoShade[];

export type LogoShade = (typeof LOGO_FAMILY_SHADES)[LogoHueFamily][number];

/**
 * The family one shade belongs to. Built once from the ladder rather than written out a
 * second time, so a rung can never claim two parents or none.
 */
const SHADE_FAMILY = new Map<LogoShade, LogoHueFamily>(
  LOGO_HUE_FAMILIES.flatMap((family) =>
    LOGO_FAMILY_SHADES[family].map((shade) => [shade as LogoShade, family] as const),
  ),
);

export function logoShadeFamily(shade: LogoShade): LogoHueFamily {
  const family = SHADE_FAMILY.get(shade);
  if (!family) throw new Error(`"${shade}" is not a shade of any logo hue family.`);
  return family;
}

/**
 * The two draws are decorrelated: one remainder for both would lock every capability to the same
 * rung of each family. Pure and stable, so a retried attempt draws the same picture (L7).
 */
export function resolveLogoShades(
  ground: LogoHueFamily,
  companion: LogoHueFamily,
  seed: number,
): readonly [LogoShade, LogoShade] {
  const groundRungs = LOGO_FAMILY_SHADES[ground];
  const companionRungs = LOGO_FAMILY_SHADES[companion];
  return [
    groundRungs[seed % groundRungs.length] as LogoShade,
    companionRungs[Math.floor(seed / groundRungs.length) % companionRungs.length] as LogoShade,
  ];
}

/**
 * The durable logo lifecycle. `absent` is the birth state and the retry sweep's only claimable one;
 * `generating` is the won claim, `present` is installed artwork, `abandoned` is terminal.
 */
export const LOGO_STATUSES = ["absent", "generating", "present", "abandoned"] as const;
export const logoStatusSchema = z.enum(LOGO_STATUSES);
export type LogoStatus = z.infer<typeof logoStatusSchema>;

export const LOGO_BIRTH_STATUS: LogoStatus = "absent";

/**
 * Three claimed attempts and then never (ADR-0007, decision 38); at ~$0.08 a call the expensive
 * failure is a retry loop. Enforced in the claim's own `WHERE`, or two loads both write three.
 */
export const LOGO_MAX_CLAIMED_ATTEMPTS = 3;

/**
 * Status and attempts travel together: a status without its spend is not a lifecycle, and reading
 * them apart lets a caller decide one from a stale view of the other.
 */
export const capabilityLogoStateSchema = z.strictObject({
  status: logoStatusSchema,
  attempts: z.number().int().min(0),
});
export type CapabilityLogoState = z.infer<typeof capabilityLogoStateSchema>;

/**
 * The provider's `random_seed` domain and the platform's one source of colour entropy. Stored per
 * incarnation: a name can be renamed and a position moves, re-describing artwork L7 forbids.
 */
export const MAX_LOGO_SEED = 2_147_483_647;
export const logoSeedSchema = z.number().int().min(1).max(MAX_LOGO_SEED);

/** Mint one incarnation's seed. Platform-owned; no spec ever authors it. */
export function createCapabilityLogoSeed(): number {
  const drawn = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return (drawn % MAX_LOGO_SEED) + 1;
}
