// Whether this process serves the developer-facing surface.
//
// What is gated is the lifecycle payload every page carries for the developer panel: embedded in
// `GET /` and in every direct capability address, carrying model ids, token counts, stage timings,
// catalog fingerprints and cleanup-failure strings holding absolute filesystem paths. All of it is
// escaped, so this is disclosure rather than XSS.
//
// Read per call rather than once at import: a module-level constant would be frozen before a test
// could set `NODE_ENV`, leaving the guard unprovable and free to be deleted under a green suite.
// `bun run build` defines NODE_ENV as "production", so this still folds to `false` in the bundle.
export function developerSurfacesEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
