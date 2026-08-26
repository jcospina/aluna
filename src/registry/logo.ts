// The logo's colour vocabulary: the eight **hue families** a spec's two colours may
// name, the shade ladder each family opens onto, and the durable lifecycle the registry
// keeps for the artwork ([ADR-0007](../../docs/adr/0007-capability-logo-contract.md)
// L2/L3/L9/L11; `modules/05-the-desk/PLAN.md` decisions 39 and 42).
//
// Three properties this module exists to hold:
//
//   - **Validation is still a word-list check.** The families and the shades are closed
//     lists, chosen saturated, in daylight, and light enough for the tile, so "is it in
//     the vocabulary", "is it saturated", "is it light enough", "no near-blacks", "no
//     pastels" and "no greys" all hold by construction. Nothing measures chroma or
//     lightness *at validation time*, because there is nothing a validator could find
//     that the lists have not already decided. Signal red is reserved for alerts and
//     destructive confirmation, so no family opens onto it and it cannot be named.
//   - **The model names a hue, the platform names the shade.** `ground` is the field the
//     drawing sits on and `companion` is the colour the object itself is drawn in; the
//     model authors each as a family, for aptness — the same reason it names a colour at
//     all — and they must differ. Which of that family's four shades a capability
//     actually wears is resolved from its incarnation seed by {@link resolveLogoShades},
//     which no caller may steer.
//   - **The seed is the only entropy in the path.** A spec-authoring model collapses to a
//     mode: asked for a colour for a notebook it answers the same colour every time, and
//     four consecutive live capabilities came out carrying `sky` while five probe builds
//     on a different neighbourhood of prompts came out carrying `sun` three times. Nothing
//     upstream can fix that, because each build is a stateless call that has never seen
//     another capability. Drawing the shade from the seed is what turns a collapsed
//     family choice back into visibly different tiles, which is why the ladder's rungs
//     differ in hue nuance and not only in lightness.
//
// This replaced two narrower vocabularies in turn. First a closed symmetric lookup that
// derived the companion from the ground (leaf/shade, teal/sky, sun/ochre, clay/violet),
// which kept the second colour from being a fourth authored fact but capped the whole
// product at **four distinct colour pairs** — five capabilities could not avoid a repeat.
// Then eight freely-paired anchors, 56 ordered pairs, which lifted the cap and left the
// mode: the pairs were reachable, the model just never reached for them. Eight families
// of four shades is 32 colours and 992 ordered pairs, and the seed is what actually
// walks around in them.
//
// L9 still permits two capabilities to look alike, and nothing here goes looking: no
// uniqueness rule is added and no capability's colour depends on any other's.

import { z } from "zod";

/**
 * The eight hue families a spec's `ground` and `companion` may name — the entire
 * authored colour vocabulary.
 *
 * These are **hue words, not scene nouns**, and that is deliberate. The previous
 * vocabulary was the palette's own token names, which put `sky` in a list the model was
 * asked to pick a *backdrop* from and `shade` in a list about colour; three of the first
 * four live capabilities took `sky` as their ground, and one of them was a house — an
 * object that sits under a sky. A family name that names a hue and nothing else cannot
 * be picked for what it depicts.
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
 * The ladder: the four shades each family opens onto, in no significant order.
 *
 * The rungs vary in **hue nuance as well as lightness**, which is the property that makes
 * a collapsed family choice survivable. Four capabilities that all authored
 * `cyan_blue` wear cyan, azure, aqua and cerulean rather than four barely-separable
 * tints of one blue, so the desk still reads as varied even when the model does not.
 *
 * Every rung is a daylight colour at high chroma. That is checked by measurement in
 * `logo.test.ts` rather than asserted here — a test over the platform's own literal
 * table, which is not the runtime chroma-and-lightness validator ADR-0007 deleted: no
 * model output is measured, and a spec still validates against a word list.
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
} as const satisfies Record<LogoHueFamily, readonly string[]>;

/** Every rung of every family, flattened — the closed list a stored shade validates against. */
export const LOGO_SHADES = Object.values(LOGO_FAMILY_SHADES).flat() as readonly LogoShade[];

export type LogoShade = (typeof LOGO_FAMILY_SHADES)[LogoHueFamily][number];
export const logoShadeSchema = z.enum(
  Object.values(LOGO_FAMILY_SHADES).flat() as [LogoShade, ...LogoShade[]],
);

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
 * Resolve one capability's two concrete colours from its two authored families and its
 * incarnation seed.
 *
 * The two draws are decorrelated on purpose: taking the same remainder for both would
 * lock every capability to the same rung of each of its families, which would put the
 * mode straight back — a build that authored `cyan_blue` twice over would always wear
 * the same cyan. The quotient is what the remainder has already thrown away, so the
 * second draw is independent of the first for a uniformly drawn seed.
 *
 * Pure, total and stable: the same seed and families always resolve to the same pair, so
 * a retried attempt draws the same picture the first one would have (L7), and nothing is
 * stored that the seed does not already record.
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
    companionRungs[Math.floor(seed / companionRungs.length) % companionRungs.length] as LogoShade,
  ];
}

/**
 * The exact two colours one generation request carries, ground first. The single source
 * for `controls.colors` and `controls.background_color`, so the ordering the contract
 * pins cannot be re-decided at the call site.
 *
 * Both are resolved shades. Nothing here derives, defaults or repairs: a spec whose two
 * families are equal never validates (`validateLogoColours`, `src/registry/spec.ts`), and
 * two different families share no rung, so a request can always carry two different
 * colours.
 */
export function logoRequestColors(
  ground: LogoShade,
  companion: LogoShade,
): readonly [LogoShade, LogoShade] {
  return [ground, companion];
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
