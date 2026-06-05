# public/ — static assets

Authored static assets served by the Hono server under the `/static/*` URL
prefix (see `src/app.ts`). A request to `/static/<file>` is served from
`public/<file>`.

Contents:

- `index.html` — the fixed shell (served at `/`, not under `/static`).
- `app.css` — the shell's authored styles: semantic tokens + Paper & Ink style
  (see `docs/design-system.md`).
- `app.js` — authored shell glue (the Alpine `shell` component). Plain JS with
  `// @ts-check` + JSDoc, served verbatim — no build step.
- `fonts/` — vendored Outfit variable woff2 + its OFL license.
- `vendor/` — pinned third-party libs (HTMX, Alpine), committed verbatim.

Unlike `capabilities/`, `storage/`, and `data/` — which hold runtime-generated
artifacts and are git-ignored — `public/` holds **authored** assets and is
tracked in version control.
