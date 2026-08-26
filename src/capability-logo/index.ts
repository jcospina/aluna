// The capability logo: one claimed generation per incarnation, stored beside the
// immutable version snapshots and served as a picture.
//
// [ADR-0007](../../docs/adr/0007-capability-logo-contract.md) owns the contract;
// `design/logo.html` owns the art. This module owns the delivery half: the request, the
// provider client, the atomic install, the claimed attempt, and the two routes a tile
// talks to.
//
// The barrel carries what the *app* wires, and nothing else. Everything inside this
// directory imports its siblings directly, and so does `artifact-reconciliation.ts`,
// which needs only the two artifact names. Re-exporting the whole surface would make
// every internal seam look like public API.

export { LogoGenerationError, type LogoGenerationProvider } from "./provider.ts";
export {
  type CapabilityLogoRouteDeps,
  registerCapabilityLogoRoutes,
} from "./routes.ts";
