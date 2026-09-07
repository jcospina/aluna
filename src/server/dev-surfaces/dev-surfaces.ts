// Whether this process serves the developer-facing surfaces.
//
// Two things are gated, and they are gated for the same reason rather than for the same
// shape. The first is the lifecycle payload every page carries for the developer panel.
// That payload is not a page the user opens — it is embedded in `GET /` and in every direct
// capability address — and it carries model ids, token counts, stage timings, catalog
// fingerprints and cleanup-failure strings holding absolute filesystem paths. All of it is
// escaped, so this is disclosure rather than XSS; none of it is a user's business, and
// none of it belongs in a production bundle.
//
// The second *is* a page somebody opens: `/demo/question`, module 6's one-turn exercise
// (`src/server/routes/query/demo-question.ts`). Module 5's `/demo/*` previews came down and
// this is the namespace being borrowed again, deliberately and temporarily —
// `6.5-the-answer-window/issues/05-the-scaffolding-comes-down.md` removes it once the real
// answer window exists. It shows the statement the model wrote and the rows that came back,
// which is machinery of exactly the kind this gate exists to keep out of a production
// bundle.
//
// Read per call, not once at import: a module-level constant would be frozen before any
// test could set `NODE_ENV`, leaving the guard permanently unprovable and free to be
// deleted under a green suite. `bun run build` defines NODE_ENV as "production", so this
// still folds to `false` in the bundle.
export function developerSurfacesEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}
