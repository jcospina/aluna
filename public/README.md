# public/ — static assets

Authored static assets served by the Hono server under the `/static/*` URL
prefix (see `src/server/app.ts`). A request to `/static/<path>` is served from
`public/<path>`.

Contents:

- `index.html` — the fixed shell (served at `/`, not under `/static`).
- `app.js` — authored shell glue (the Alpine `shell` component). Plain JS with
  `// @ts-check` + JSDoc, served verbatim — no build step.
- `css/` — `app.css`, the entry sheet, and the pieces it imports: temporary
  integration styles that keep the pre-Desk shell functional on the shipped
  High Meadow layer (see `design/design-system.md`).
- `core/` — what every other module leans on: the ids and routes the server and
  browser share, region scope, swap targets, and the ink system's start.
- `desk/` — the prompt bar, the address, doorways and leaving a run; `desk/window/`
  holds the three windows and their stack, `desk/logos/` the tiles, their menu,
  rename and deletion.
- `records/` — a capability's records region: opening a record, its mutations,
  search, the count sidecar and refreshes.
- `controls/` and `fields/` — the product's half of the drawn controls, and the
  field chrome around them (errors, long text, the character count).
- `vendor/` — pinned third-party libs, committed verbatim: HTMX (`htmx.min.js`,
  2.0.10), the HTMX SSE extension (`htmx-ext-sse.min.js`, 2.2.4 — drives the
  per-build SSE swaps, ADR-0002), and Alpine (`alpine.min.js`).

No folder holds more than ten files; `bun run lint` enforces it
(`scripts/lint/folder-size.ts`).

Unlike `capabilities/`, `storage/`, and `data/` — which hold runtime-generated
artifacts and are git-ignored — `public/` holds **authored** assets and is
tracked in version control.

High Meadow itself is served directly from `design/` under `/design/*`, including
the sole token layer, Fraunces/Outfit font files, and meadow wallpaper.
