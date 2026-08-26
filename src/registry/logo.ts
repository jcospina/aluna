// The logo's colour vocabulary: the eight hue families a spec's two colours may name, the
// shade ladder each family opens onto, and the durable lifecycle the registry keeps for
// the artwork (ADR-0007 L2/L3/L9/L11; `modules/05-the-desk/PLAN.md` decisions 39 and 42).
//
// Two properties worth knowing before changing anything here:
//
//   - **The model names a hue, the platform names the shade.** A spec authors `ground` and
//     `companion` as families, for aptness, and they must differ. Which of the family's
//     four rungs a capability wears is resolved from its incarnation seed by
//     {@link resolveLogoShades}, which no caller may steer.
//   - **The seed is the only entropy in the path.** A spec-authoring model collapses to a
//     mode — each build is a stateless call that has never seen another capability — so
//     four consecutive live capabilities came out the same colour. Drawing the shade from
//     the seed is what turns a collapsed family choice back into visibly different tiles,
//     which is why the rungs differ in hue nuance and not only in lightness.
//
// Validation stays a word-list check: the lists are chosen saturated, in daylight and
// light enough for the tile, so nothing measures chroma or lightness at validation time.
// L9 still permits two capabilities to look alike, and nothing here goes looking.

import { z } from "zod";

/**
 * The eight hue families a spec's `ground` and `companion` may name — the entire authored
 * colour vocabulary. Hue words, not scene nouns: naming these after palette tokens put
 * `sky` in a list the model picked a *backdrop* from, and three of the first four live
 * capabilities took it.
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
 * The ladder: the four shades each family opens onto, in no significant order. Rungs vary
 * in hue nuance as well as lightness, so four capabilities that all authored `cyan_blue`
 * read as varied rather than as four tints of one blue. `logo.test.ts` measures every rung
 * for daylight chroma — a test over this literal table, not a runtime validator.
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
 * Resolve one capability's two concrete colours from its authored families and its seed.
 *
 * The two draws are decorrelated on purpose — the same remainder for both would lock every
 * capability to the same rung of each family, putting the mode straight back. The second
 * draw takes the quotient the first divided away, so it is independent for a uniform seed.
 *
 * Pure and stable: a retried attempt draws the same picture the first would have (L7).
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
 * The durable logo lifecycle. `absent` is the birth state and the retry sweep's
 * only claimable one; `generating` is the won claim; `present` means accepted
 * artwork is installed; `abandoned` is terminal.
 */
export const LOGO_STATUSES = ["absent", "generating", "present", "abandoned"] as const;
export const logoStatusSchema = z.enum(LOGO_STATUSES);
export type LogoStatus = z.infer<typeof logoStatusSchema>;

export const LOGO_BIRTH_STATUS: LogoStatus = "absent";

/**
 * Three claimed attempts and then never (ADR-0007, PLAN decision 38). It lives beside the
 * lifecycle rather than beside the sweep that spends them, because the only race-free
 * place to enforce it is the claim's own `WHERE` — the same conditional `UPDATE` that
 * wins the right to spend. A cap the caller checked first would be a read followed by a
 * write, and two desk loads arriving together would both read two and both write three.
 *
 * The guard that matters is the attempt cap rather than a spend ceiling: at ~$0.08 a call
 * the expensive failure is a retry loop, and a cap kills the loop where a budget only
 * bounds how long it runs.
 */
export const LOGO_MAX_CLAIMED_ATTEMPTS = 3;

/**
 * Status and attempts travel together: a status without its spend is not a
 * lifecycle, and reading them apart would let a caller decide one from a stale
 * view of the other.
 */
export const capabilityLogoStateSchema = z.strictObject({
  status: logoStatusSchema,
  attempts: z.number().int().min(0),
});
export type CapabilityLogoState = z.infer<typeof capabilityLogoStateSchema>;

/**
 * The provider's `random_seed` domain, and — since the shade ladder — the platform's one
 * source of colour entropy. Stored per incarnation rather than derived from a name or a
 * position on the desk: a name can be renamed and a position moves, and either would
 * silently re-describe artwork L7 forbids remaking.
 */
export const MAX_LOGO_SEED = 2_147_483_647;
export const logoSeedSchema = z.number().int().min(1).max(MAX_LOGO_SEED);

/** Mint one incarnation's seed. Platform-owned; no spec ever authors it. */
export function createCapabilityLogoSeed(): number {
  const drawn = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return (drawn % MAX_LOGO_SEED) + 1;
}
