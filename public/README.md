# public/ — static assets

Authored static assets served by the Hono server under the `/static/*` URL
prefix (see `src/app.ts`). A request to `/static/<file>` is served from
`public/<file>`.

This is where the fixed shell's CSS/JS lives (added in later Epic 1.2 issues).
Unlike `capabilities/`, `storage/`, and `data/` — which hold runtime-generated
artifacts and are git-ignored — `public/` holds **authored** assets and is
tracked in version control.
