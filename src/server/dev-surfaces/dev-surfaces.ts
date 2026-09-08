// Whether this process serves the developer-facing surfaces.
//
// Two things are gated. The lifecycle payload every page carries for the developer panel is not a
// page anyone opens: it is embedded in `GET /` and in every direct capability address, and carries
// model ids, token counts, stage timings, catalog fingerprints and cleanup-failure strings holding
// absolute filesystem paths. All of it is escaped, so this is disclosure rather than XSS.
//
// The second is a page somebody opens: `/demo/question`, module 6's query-loop exercise, borrowing
// the `/demo` namespace until 6.5/05 removes it.
//
// Read per call rather than once at import: a module-level constant would be frozen before a test
// could set `NODE_ENV`, leaving the guard unprovable and free to be deleted under a green suite.
// `bun run build` defines NODE_ENV as "production", so this still folds to `false` in the bundle.
export function developerSurfacesEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
