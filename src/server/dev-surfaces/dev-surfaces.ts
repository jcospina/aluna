// Whether this process serves the developer-facing surfaces.
//
// One thing is left to gate. The `/demo/*` preview routes came down with module 5, so what
// remains is the lifecycle payload every page carries for the developer panel. That
// payload is not a page the user opens — it is embedded in `GET /` and in every direct
// capability address — and it carries model ids, token counts, stage timings, catalog
// fingerprints and cleanup-failure strings holding absolute filesystem paths. All of it is
// escaped, so this is disclosure rather than XSS; none of it is a user's business, and
// none of it belongs in a production bundle.
//
// Read per call, not once at import: a module-level constant would be frozen before any
// test could set `NODE_ENV`, leaving the guard permanently unprovable and free to be
// deleted under a green suite. `bun run build` defines NODE_ENV as "production", so this
// still folds to `false` in the bundle.
export function developerSurfacesEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
