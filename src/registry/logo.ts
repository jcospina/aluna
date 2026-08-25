// The logo's closed vocabulary: the ground anchors a spec may name, the companion
// the shell derives from one, and the durable lifecycle the registry keeps for the
// artwork ([ADR-0007](../../docs/adr/0007-capability-logo-contract.md) L2/L3/L9/L11;
// `modules/05-the-desk/PLAN.md` decisions 39 and 42).
//
// Two properties this module exists to hold:
//
//   - **Ground validation is a word-list check.** The eight anchors were chosen
//     saturated, in the palette, and light enough for daylight, so "is it in the
//     palette", "is it saturated", "is it light enough", "no near-blacks", "no
//     pastels" and "no greys" all hold by construction. Nothing measures chroma or
//     lightness, because there is nothing a validator could find that the list has
//     not already decided. Signal red is reserved for alerts and destructive
//     confirmation, so it is not one of the eight and cannot be named.
//   - **The second colour is derived, never authored.** `logoRequestColors` is the
//     only place a request's colour pair comes from: the selected ground first, its
//     fixed companion second. A caller cannot vary it, a spec cannot author it, and
//     the registry does not store it, so no presentation choice hides in the
//     provider client.
//
// L9 permits two capabilities to look alike, so neither the ground nor the seed
// owes a uniqueness rule.

import { z } from "zod";

/**
 * The eight tint anchors a spec's `ground` may name. These are token *names* from
 * the High Meadow palette (`design/styles/tokens.css`); `logo.test.ts` cross-checks
 * them against `PALETTE_COLOR_TOKENS` so a renamed token fails the suite rather
 * than becoming a ground no stylesheet can resolve.
 */
export const LOGO_GROUND_ANCHORS = [
  "leaf",
  "shade",
  "teal",
  "sky",
  "sun",
  "ochre",
  "clay",
  "violet",
] as const;

export const logoGroundSchema = z.enum(LOGO_GROUND_ANCHORS);
export type LogoGround = z.infer<typeof logoGroundSchema>;

/**
 * The closed symmetric companion lookup. Four pairs cover all eight anchors, and
 * the symmetry is what makes the second colour a derivation rather than a fourth
 * authored fact.
 */
const LOGO_GROUND_COMPANION_PAIRS = [
  ["leaf", "shade"],
  ["teal", "sky"],
  ["sun", "ochre"],
  ["clay", "violet"],
] as const satisfies ReadonlyArray<readonly [LogoGround, LogoGround]>;

const COMPANION_BY_GROUND: ReadonlyMap<LogoGround, LogoGround> = new Map(
  LOGO_GROUND_COMPANION_PAIRS.flatMap(
    ([one, other]) =>
      [
        [one, other],
        [other, one],
      ] as const,
  ),
);

/** The fixed partner of one anchor. Total over the eight; unknown input throws. */
export function logoGroundCompanion(ground: LogoGround): LogoGround {
  const companion = COMPANION_BY_GROUND.get(ground);
  if (!companion) {
    throw new Error(`No companion is defined for logo ground "${ground}".`);
  }
  return companion;
}

/**
 * The exact two colours one generation request carries, ground first. The single
 * source for `controls.colors` and `controls.background_color` (5.5/02), so the
 * ordering the contract pins cannot be re-decided at the call site.
 */
export function logoRequestColors(ground: LogoGround): readonly [LogoGround, LogoGround] {
  return [ground, logoGroundCompanion(ground)];
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
 * The provider's `random_seed` domain. Stored per incarnation rather than derived
 * from a name or a position on the desk: a name can be renamed and a position
 * moves, and either would silently re-describe artwork L7 forbids remaking.
 */
export const MAX_LOGO_SEED = 2_147_483_647;
export const logoSeedSchema = z.number().int().min(1).max(MAX_LOGO_SEED);

/** Mint one incarnation's seed. Platform-owned; no spec ever authors it. */
export function createCapabilityLogoSeed(): number {
  const drawn = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return (drawn % MAX_LOGO_SEED) + 1;
}
