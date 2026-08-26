// The two names a logo puts inside a capability's artifact tree.
//
// They live in a module of their own, importing nothing, because **two subsystems have
// to agree on them**: the installer writes them, and `artifact-reconciliation.ts` — which
// enumerates the incarnation directory at boot and at the head of every build — has to
// recognize them as legitimate rather than as unknown state. Holding the strings in one
// place is the whole point: when they were spelled twice, reconciliation did not know
// about the logo and a capability that grew a face made the platform unbootable.

/** The accepted artwork, at the incarnation root beside the immutable `vN/` directories. */
export const CAPABILITY_LOGO_FILENAME = "logo.svg";

/** One claimed attempt's staging bytes, inside the incarnation's `.staging` directory. */
export function capabilityLogoStagingName(attempt: number): string {
  return `logo-attempt-${attempt}.svg`;
}

/** What {@link capabilityLogoStagingName} produces, for the reader that has to admit it. */
export const CAPABILITY_LOGO_STAGING_PATTERN = /^logo-attempt-[1-9][0-9]*\.svg$/;
